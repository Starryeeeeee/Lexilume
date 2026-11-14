window.WL = window.WL || {};
(function (WL) {
  'use strict';

  var KEY = 'wl.sync.v1';
  var API = 'https://api.github.com';
  var PUSH_DELAY = 25000;

  var conf = null;
  var busy = false;
  var timer = null;
  var lastResult = null;

  function load() {
    if (conf) return conf;
    try {
      conf = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch (e) {
      conf = {};
    }
    conf.owner = conf.owner || 'Starryeeeeee';
    conf.repo = conf.repo || 'Lexilume';
    conf.branch = conf.branch || 'main';
    conf.path = conf.path || 'progress.json';
    return conf;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(conf)); } catch (e) { /* 忽略 */ }
  }

  function get() { return load(); }

  function setConf(patch) {
    var c = load();
    Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
    c.lastError = '';
    save();
    return c;
  }

  function configured() {
    var c = load();
    return !!(c.token && c.owner && c.repo);
  }

  function state() {
    var c = load();
    return {
      configured: configured(),
      busy: busy,
      owner: c.owner,
      repo: c.repo,
      branch: c.branch,
      path: c.path,
      hasToken: !!c.token,
      lastSync: c.lastSync || 0,
      lastError: c.lastError || '',
      result: lastResult
    };
  }

  /* ---------- base64（按 UTF-8 走，避免中文乱码） ---------- */

  function b64enc(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64dec(s) {
    var bin = atob(String(s).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- 合并 ---------- */

  function stamp(st) {
    if (!st || !st.ch) return 0;
    var r = st.ch.r ? (st.ch.r.last || 0) : 0;
    var p = st.ch.p ? (st.ch.p.last || 0) : 0;
    return r > p ? r : p;
  }

  // 每个词取最后一次复习更晚的那份，两边的进度都不会丢
  function mergeProgress(a, b) {
    var out = {};
    var seen = {};
    a = a || {}; b = b || {};
    Object.keys(a).forEach(function (k) { seen[k] = 1; });
    Object.keys(b).forEach(function (k) { seen[k] = 1; });
    Object.keys(seen).forEach(function (k) {
      var x = a[k], y = b[k];
      if (!x) { out[k] = y; return; }
      if (!y) { out[k] = x; return; }
      out[k] = stamp(x) >= stamp(y) ? x : y;
    });
    return out;
  }

  // 日志按天取各字段较大值，避免同一份数据来回同步被重复累加
  function mergeLog(a, b) {
    var out = {};
    var seen = {};
    a = a || {}; b = b || {};
    Object.keys(a).forEach(function (k) { seen[k] = 1; });
    Object.keys(b).forEach(function (k) { seen[k] = 1; });
    Object.keys(seen).forEach(function (k) {
      var x = a[k] || {}, y = b[k] || {};
      out[k] = {
        nw: Math.max(x.nw || 0, y.nw || 0),
        rv: Math.max(x.rv || 0, y.rv || 0),
        ok: Math.max(x.ok || 0, y.ok || 0),
        bad: Math.max(x.bad || 0, y.bad || 0),
        ms: Math.max(x.ms || 0, y.ms || 0)
      };
    });
    return out;
  }

  function mergeData(local, remote) {
    var books = {};
    var ids = {};
    var lb = (local && local.books) || {};
    var rb = (remote && remote.books) || {};
    Object.keys(lb).forEach(function (k) { ids[k] = 1; });
    Object.keys(rb).forEach(function (k) { ids[k] = 1; });
    Object.keys(ids).forEach(function (id) {
      books[id] = mergeProgress(lb[id], rb[id]);
    });
    return { books: books, log: mergeLog(local && local.log, remote && remote.log) };
  }

  /* ---------- 网络 ---------- */

  // 仅用于比较：键排序后序列化，键序差异不当作内容变化
  function stableStringify(x) {
    if (x === null || typeof x !== 'object') return JSON.stringify(x);
    if (Array.isArray(x)) return '[' + x.map(stableStringify).join(',') + ']';
    var ks = Object.keys(x).sort();
    return '{' + ks.map(function (k) {
      return JSON.stringify(k) + ':' + stableStringify(x[k]);
    }).join(',') + '}';
  }

  function headers() {
    var c = load();
    return {
      'Authorization': 'Bearer ' + c.token,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };
  }

  function fileUrl() {
    var c = load();
    return API + '/repos/' + c.owner + '/' + c.repo + '/contents/' + c.path;
  }

  function httpError(res, what) {
    if (res.status === 401) return new Error('token 无效或已过期');
    if (res.status === 403) return new Error('没有权限，或请求太频繁');
    if (res.status === 404) return new Error(what + '：仓库或路径不存在');
    if (res.status === 409) return new Error('冲突，请重试');
    return new Error(what + '失败（HTTP ' + res.status + '）');
  }

  async function fetchRemote() {
    var c = load();
    var res = await fetch(fileUrl() + '?ref=' + encodeURIComponent(c.branch) + '&t=' + Date.now(), {
      headers: headers(),
      cache: 'no-store'
    });
    if (res.status === 404) return { sha: null, data: null };
    if (!res.ok) throw httpError(res, '读取');
    var j = await res.json();
    if (!j.content) return { sha: j.sha, data: null };
    var text = b64dec(j.content);
    var data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    return { sha: j.sha, data: data };
  }

  async function putRemote(payload, sha) {
    var c = load();
    var body = {
      message: 'sync ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
      content: b64enc(payload),
      branch: c.branch
    };
    if (sha) body.sha = sha;
    var res = await fetch(fileUrl(), {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw httpError(res, '写入');
    return res.json();
  }

  /* ---------- 对外 ---------- */

  async function run(silent) {
    if (!configured()) {
      lastResult = { ok: false, msg: '还没填 token' };
      return lastResult;
    }
    if (busy) return lastResult || { ok: false, msg: '正在同步中' };
    busy = true;
    try {
      var remote = await fetchRemote();
      var local = WL.store.exportAll();
      var merged = mergeData(local, remote.data);

      WL.store.importAll({ v: 1, books: merged.books, log: merged.log });

      // 内容与远端一致就不再提交，避免每次打开页面都多一个空 commit
      if (remote.data && stableStringify(remote.data) === stableStringify(merged)) {
        var cSame = load();
        cSame.lastSync = Date.now();
        cSame.lastError = '';
        save();
        lastResult = { ok: true, msg: '已同步（内容无变化）' };
        return lastResult;
      }

      var payload = JSON.stringify({
        v: 1,
        updatedAt: Date.now(),
        books: merged.books,
        log: merged.log
      });
      try {
        await putRemote(payload, remote.sha);
      } catch (e) {
        // 别人刚写过，重拉一次再合并提交
        if (/冲突/.test(e.message)) {
          var again = await fetchRemote();
          var merged2 = mergeData(WL.store.exportAll(), again.data);
          WL.store.importAll({ v: 1, books: merged2.books, log: merged2.log });
          if (again.data && stableStringify(again.data) !== stableStringify(merged2)) {
            await putRemote(JSON.stringify({
              v: 1, updatedAt: Date.now(), books: merged2.books, log: merged2.log
            }), again.sha);
          }
        } else {
          throw e;
        }
      }

      var c = load();
      c.lastSync = Date.now();
      c.lastError = '';
      save();
      lastResult = { ok: true, msg: '已同步' };
      return lastResult;
    } catch (e) {
      var c2 = load();
      c2.lastError = e.message || '未知错误';
      save();
      lastResult = { ok: false, msg: c2.lastError };
      return lastResult;
    } finally {
      busy = false;
      if (!silent && WL.app && WL.app.render) WL.app.render();
    }
  }

  // 答题后攒一会儿再推，避免每答一题就提交一次
  function markDirty() {
    if (!configured()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      run(true).then(function () {
        if (WL.app && WL.app.state && WL.app.state.view !== 'study') WL.app.render();
      });
    }, PUSH_DELAY);
  }

  function flushNow() {
    if (timer) { clearTimeout(timer); timer = null; }
    return run(true);
  }

  function pullOnBoot() {
    if (!configured()) return;
    run(true).then(function (r) {
      if (r.ok && WL.app && WL.app.render) WL.app.render();
    });
  }

  function clear() {
    conf = { owner: 'Starryeeeeee', repo: 'Lexilume', branch: 'main', path: 'progress.json' };
    try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
    lastResult = null;
  }

  WL.sync = {
    get: get,
    setConf: setConf,
    configured: configured,
    state: state,
    run: run,
    markDirty: markDirty,
    flushNow: flushNow,
    pullOnBoot: pullOnBoot,
    clear: clear,
    mergeData: mergeData,
    mergeProgress: mergeProgress,
    mergeLog: mergeLog
  };
})(window.WL);
