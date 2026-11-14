window.WL = window.WL || {};
(function (WL) {
  'use strict';

  var K = {
    config: 'wl.config.v1',
    progress: 'wl.progress.v1.',   // + bookId
    log: 'wl.log.v1',
    streak: 'wl.streak.v1'
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
    if (!log[k]) log[k] = { nw: 0, rv: 0, ok: 0, bad: 0, ms: 0 };
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
      if (rec && (rec.nw + rec.rv) > 0) {
        n++;
      } else if (i > 0) {
        break;
      }
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function exportAll() {
    var out = { v: 1, exportedAt: Date.now(), config: getConfig(), books: {}, log: getLog() };
    (WL.books || []).forEach(function (b) {
      out.books[b.id] = getProgress(b.id);
    });
    return out;
  }

  function importAll(data) {
    if (!data || !data.books) throw new Error('文件格式不对');
    if (data.config) writeJSON(K.config, data.config);
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
    exportAll: exportAll,
    importAll: importAll,
    resetBook: resetBook,
    resetAll: resetAll,
    usage: usage,
    available: available,
    origin: origin
  };
})(window.WL);
