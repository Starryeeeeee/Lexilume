window.WL = window.WL || {};
(function (WL) {
  'use strict';

  var K = {
    config: 'wl.config.v1',
    progress: 'wl.progress.v1.',   // + bookId
    log: 'wl.log.v1',
    streak: 'wl.streak.v1',
    books: 'wl.books.v1',          // 用户自建词书（内置词书在代码里，不存这里）
    session: 'wl.session.v1',      // 未完成会话的快照（断点续学）
    daily: 'wl.daily.v1'           // 已导入的时文词表文件名
  };

  var DEFAULT_CONFIG = {
    cfgVersion: 3,
    book: 'gk',
    newLimit: 20,
    reviewLimit: 60,
    sound: true,
    shuffleNew: false,
    activeTypes: ['en2cn', 'cn2en']
  };

  var cache = {};
  var dirty = {};

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      console.error('存储写入失败', e);
      return false;
    }
  }

  function getConfig() {
    if (!cache.config) {
      var c = Object.assign({}, DEFAULT_CONFIG, readJSON(K.config, {}));
      if ((c.cfgVersion || 1) < 3) {
        // v3：启用「看义选词」，与基底题型构成默认题型组
        c.cfgVersion = 3;
        c.activeTypes = ['en2cn', 'cn2en'];
        writeJSON(K.config, c);
      }
      if (!c.activeTypes || !c.activeTypes.length) c.activeTypes = ['en2cn'];
      if (c.activeTypes.indexOf('en2cn') < 0) c.activeTypes.unshift('en2cn');
      cache.config = c;
    }
    return cache.config;
  }

  function setConfig(patch) {
    var c = getConfig();
    Object.assign(c, patch);
    cache.config = c;
    writeJSON(K.config, c);
    return c;
  }

  function getProgress(bookId) {
    if (!cache[bookId]) {
      cache[bookId] = readJSON(K.progress + bookId, {});
    }
    return cache[bookId];
  }

  function putProgress(bookId, wordId, state) {
    var p = getProgress(bookId);
    p[wordId] = state;
    dirty[bookId] = true;
  }

  function flush() {
    for (var bookId in dirty) {
      writeJSON(K.progress + bookId, cache[bookId]);
    }
    dirty = {};
  }

  function getLog() {
    return readJSON(K.log, {});
  }

  function todayKey(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function bumpLog(field, n) {
    var log = getLog();
    var k = todayKey();
    if (!log[k]) log[k] = { nw: 0, rv: 0, ok: 0, bad: 0, ms: 0, pr: 0, fzg: 0, fz: 0 };
    log[k][field] = (log[k][field] || 0) + (n == null ? 1 : n);
    writeJSON(K.log, log);
    return log[k];
  }

  function getToday() {
    var log = getLog();
    return log[todayKey()] || { nw: 0, rv: 0, ok: 0, bad: 0, ms: 0 };
  }

  function streakDays() {
    var log = getLog();
    var n = 0;
    var d = new Date();
    for (var i = 0; i < 400; i++) {
      var k = todayKey(d);
      var rec = log[k];
      // 被连胜保护冻结的天也算作连续（那天是靠保护撑过去的）
      if (rec && ((rec.nw + rec.rv + (rec.pr || 0)) > 0 || rec.fz)) {
        n++;
      } else if (i > 0) {
        break;
      }
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  /* ---------- 连胜保护 ----------
     日志字段：fzg=当天获得一枚，fz=当天的连续天数靠一枚保护撑过去。
     库存 = Σfzg − Σfz，随日志同步，两台机器按天取 max 合并，天然一致。
     上限 2 枚（Duolingo 同款上限）；每完成当日目标（新学配额 + 清空到期）得一枚。 */

  var FREEZE_CAP = 2;

  function freezeInventory(log) {
    log = log || getLog();
    var n = 0;
    Object.keys(log).forEach(function (k) {
      n += (log[k].fzg || 0) - (log[k].fz || 0);
    });
    return n;
  }

  // 当日目标完成后调用；每天最多发一枚，库存封顶
  function grantFreezeIfEligible() {
    var log = getLog();
    var k = todayKey();
    var rec = log[k];
    if (rec && rec.fzg) return false;
    if (freezeInventory(log) >= FREEZE_CAP) return false;
    if (!log[k]) log[k] = { nw: 0, rv: 0, ok: 0, bad: 0, ms: 0, pr: 0, fzg: 0, fz: 0 };
    log[k].fzg = 1;
    writeJSON(K.log, log);
    return true;
  }

  // 补卡：从昨天向前，把缺失的连续天用库存逐一冻结，库存用尽即 streak 真正断掉
  // 返回本次消耗的张数
  function applyStreakFreezes() {
    var log = getLog();
    var inv = freezeInventory(log);
    if (inv <= 0) return 0;
    var used = 0;
    var d = new Date();
    d.setDate(d.getDate() - 1);
    for (var i = 0; i < 60; i++) {
      var k = todayKey(d);
      var rec = log[k];
      if (rec && ((rec.nw + rec.rv + (rec.pr || 0)) > 0)) break;   // 活动日：连续成立到这里
      if (rec && rec.fz) { d.setDate(d.getDate() - 1); continue; } // 已冻结的天：继续往前查
      if (inv <= 0) break;                                          // 缺失天且无库存：真断了
      log[k] = { nw: 0, rv: 0, ok: 0, bad: 0, ms: 0, pr: 0, fzg: 0, fz: 1 };
      inv--;
      used++;
      d.setDate(d.getDate() - 1);
    }
    if (used) writeJSON(K.log, log);
    return used;
  }

  function exportAll() {
    var out = { v: 1, exportedAt: Date.now(), config: getConfig(), books: {}, log: getLog(), userBooks: getUserBooks() };
    (WL.books || []).forEach(function (b) {
      out.books[b.id] = getProgress(b.id);
    });
    return out;
  }

  function importAll(data) {
    if (!data || !data.books) throw new Error('文件格式不对');
    if (data.config) writeJSON(K.config, data.config);
    if (data.userBooks && Array.isArray(data.userBooks)) saveUserBooks(data.userBooks);
    Object.keys(data.books).forEach(function (id) {
      writeJSON(K.progress + id, data.books[id]);
      cache[id] = null;
    });
    if (data.log) writeJSON(K.log, data.log);
    cache = {};
    dirty = {};
  }

  function resetBook(bookId) {
    localStorage.removeItem(K.progress + bookId);
    cache[bookId] = null;
  }

  function resetAll() {
    Object.keys(K).forEach(function (k) {
      if (k === 'progress') {
        Object.keys(localStorage).forEach(function (key) {
          if (key.indexOf(K.progress) === 0) localStorage.removeItem(key);
        });
      } else {
        localStorage.removeItem(K[k]);
      }
    });
    cache = {};
    dirty = {};
  }

  /* 用户自建词书的持久化：导入、重命名、删除时调用；内置词书不走这里 */
  function getUserBooks() {
    return readJSON(K.books, []);
  }

  function saveUserBooks(list) {
    writeJSON(K.books, list);
  }

  function upsertUserBook(book) {
    var list = getUserBooks().filter(function (b) { return b.id !== book.id; });
    list.push(book);
    saveUserBooks(list);
  }

  function removeUserBook(bookId) {
    saveUserBooks(getUserBooks().filter(function (b) { return b.id !== bookId; }));
  }

  function isUserBook(bookId) {
    return getUserBooks().some(function (b) { return b.id === bookId; });
  }

  /* 未完成会话的快照：每次渲染时保存，重启后可断点续学 */
  function saveSession(snapshot) {
    writeJSON(K.session, snapshot);
  }

  function getSession() {
    return readJSON(K.session, null);
  }

  function removeSession() {
    try { localStorage.removeItem(K.session); } catch (e) { /* 忽略 */ }
  }

  /* 时文词表导入记录：文件名维度的去重 */
  function getDailyImported() {
    return readJSON(K.daily, []);
  }

  function isDailyImported(name) {
    return getDailyImported().indexOf(name) >= 0;
  }

  function markDailyImported(name) {
    var list = getDailyImported();
    if (list.indexOf(name) < 0) {
      list.push(name);
      writeJSON(K.daily, list);
    }
  }

  function usage() {
    var total = 0;
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('wl.') === 0) total += (localStorage.getItem(k) || '').length;
      });
    } catch (e) { return -1; }
    return total;
  }

  var availCache = null;

  // 真正写一次再读回来，比只判断 localStorage 是否存在可靠
  function available() {
    if (availCache !== null) return availCache;
    try {
      var k = '__wl_probe__';
      localStorage.setItem(k, '1');
      availCache = localStorage.getItem(k) === '1';
      localStorage.removeItem(k);
    } catch (e) {
      availCache = false;
    }
    return availCache;
  }

  function origin() {
    try { return location.origin || location.protocol; } catch (e) { return '未知'; }
  }

  WL.store = {
    getConfig: getConfig,
    setConfig: setConfig,
    getProgress: getProgress,
    putProgress: putProgress,
    flush: flush,
    bumpLog: bumpLog,
    getLog: getLog,
    getToday: getToday,
    todayKey: todayKey,
    streakDays: streakDays,
    freezeInventory: freezeInventory,
    grantFreezeIfEligible: grantFreezeIfEligible,
    applyStreakFreezes: applyStreakFreezes,
    exportAll: exportAll,
    importAll: importAll,
    resetBook: resetBook,
    resetAll: resetAll,
    getUserBooks: getUserBooks,
    saveUserBooks: saveUserBooks,
    upsertUserBook: upsertUserBook,
    removeUserBook: removeUserBook,
    isUserBook: isUserBook,
    saveSession: saveSession,
    getSession: getSession,
    removeSession: removeSession,
    getDailyImported: getDailyImported,
    isDailyImported: isDailyImported,
    markDailyImported: markDailyImported,
    usage: usage,
    available: available,
    origin: origin
  };
})(window.WL);
