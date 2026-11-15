window.WL = window.WL || {};
(function (WL) {
  'use strict';

  var S = {
    view: 'home',
    bookId: null,
    session: null,
    flash: null,
    toast: null,
    importOpen: false
  };

  var bookCache = {};

  // 练习模式一轮的题数
  var PRACTICE_SIZE = 10;

  // 练习模式的范围与题型选择（页面重渲染间保持）
  var practiceSel = { scope: 'all', mode: 'en2cn' };

  // 拼写环节：纠正后重排确认的最大轮次（防止个别词无限循环；跳过按钮随时可退出）
  var SPELL_REQUEUE_MAX = 3;

  function getBook(id) {
    if (bookCache[id]) return bookCache[id];
    var books = WL.books || [];
    for (var i = 0; i < books.length; i++) {
      if (books[i].id === id) {
        var b = books[i];
        b.byId = {};
        b.words.forEach(function (w) { b.byId[w.id] = w; });
        bookCache[id] = b;
        return b;
      }
    }
    return null;
  }

  function curBook() {
    return getBook(S.bookId || WL.store.getConfig().book);
  }

  function wordOf(id) {
    var b = curBook();
    return b && b.byId[id];
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function h(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild;
  }

  // 分段按钮组：同一组内单选，选中态内凹 + 品牌色（替代原生下拉框）
  function segGroup(options, current, onPick) {
    var box = el('div', 'seg');
    options.forEach(function (o) {
      var b = el('button', 'seg-btn' + (o[0] === current ? ' on' : ''), o[1]);
      b.onclick = function () { onPick(o[0]); };
      box.appendChild(b);
    });
    return box;
  }

  // 完成页插画：Fluent Emoji 3D（微软开源，MIT 协议）放在新拟态圆托上
  function clayArt(file) {
    var hero = el('div', 'clay-hero');
    var orb = el('div', 'clay-orb');
    var img = document.createElement('img');
    img.src = 'assets/emoji/' + file;
    img.alt = '';
    img.draggable = false;
    orb.appendChild(img);
    hero.appendChild(orb);
    return hero;
  }

  function todayStr() { return WL.store.todayKey(); }

  // 当前题型集合对应的记忆通道，例如只开「看词选义」时是 ['r']
  function activeChannels() {
    var cfg = WL.store.getConfig();
    var seen = {};
    (cfg.activeTypes || ['en2cn']).forEach(function (t) {
      var ch = WL.quiz.CHANNEL[t];
      if (ch) seen[ch] = 1;
    });
    var out = Object.keys(seen);
    return out.length ? out : ['r'];
  }

  function toast(msg) {
    S.toast = msg;
    render();
    setTimeout(function () { S.toast = null; render(); }, 1800);
  }

  /* ============ 会话 ============ */

  // mode: 'all' 复习+新学 | 'review' 只复习 | 'new' 只新学
  function startSession(mode) {
    mode = mode || 'all';
    var cfg = WL.store.getConfig();
    var book = curBook();
    if (!book) return;
    var prog = WL.store.getProgress(book.id);
    var now = Date.now();
    var chs = activeChannels();

    var due = [];
    book.words.forEach(function (w) {
      var st = prog[w.id];
      if (st && !st.cut && WL.srs.dueNow(st, now, chs)) due.push({ w: w, st: st });
    });
    due.sort(function (a, b) {
      return WL.srs.overdueDays(b.st, now, chs) - WL.srs.overdueDays(a.st, now, chs);
    });
    due = due.slice(0, cfg.reviewLimit);
    if (mode === 'new') due = [];

    var fresh = mode === 'review' ? [] : book.words.filter(function (w) { return !prog[w.id]; });
    if (cfg.shuffleNew) fresh = WL.quiz.shuffle(fresh);
    fresh = fresh.slice(0, cfg.newLimit);

    if (!due.length && !fresh.length) {
      toast(mode === 'review' ? '当前没有到期复习的词' : '当前没有要学的内容，可以先导入词表');
      return;
    }

    S.session = {
      phase: 'review',
      mode: mode,
      learn: fresh.map(function (w) { return w.id; }),
      li: 0,
      reviewWids: due.map(function (x) { return x.w.id; }),
      spellQueue: [],
      items: [],
      i: 0,
      total: 0,
      retryCard: false,
      bookId: book.id,
      t0: now,
      q: null,
      answered: null,
      newDone: {},
      revDone: {},
      spokenFor: '',
      right: 0,
      wrong: 0,
      ended: false
    };

    if (due.length) enterReviewPhase();
    else enterLearnPhase();
  }

  /* ----- 会话阶段机：复习 → 学一个测一个 → 拼写环节 ----- */

  function enterReviewPhase() {
    var s = S.session;
    s.phase = 'review';
    s.items = s.reviewWids.map(function (id) { return { wid: id, from: 'review', retry: 0 }; });
    s.i = 0;
    s.total = s.items.length;
    s.q = null;
    s.answered = null;
    S.view = 'study';
    prepare();
    render();
  }

  function enterLearnPhase() {
    var s = S.session;
    s.phase = 'learn';
    s.items = [];
    s.i = 0;
    s.q = null;
    s.answered = null;
    S.view = 'learn';
    render();
  }

  // 词卡看完，立刻测这个词（百词斩式：学一个测一个）
  function advanceFromCard() {
    var s = S.session;
    var wid = s.learn[s.li];
    var word = wordOf(wid);
    if (!word) { s.li++; nextFromLearn(); return; }
    markLearned(wid, word);
    s.phase = 'quiz';
    s.items = [{ wid: wid, from: 'new', retry: 0 }];
    s.i = 0;
    s.total = s.items.length;
    s.q = null;
    s.answered = null;
    S.view = 'study';
    prepare();
    render();
  }

  function nextFromLearn() {
    var s = S.session;
    if (s.li < s.learn.length) enterLearnPhase();
    else enterSpellAsk();
  }

  function enterSpellAsk() {
    var s = S.session;
    s.spellQueue = Object.keys(s.newDone).filter(function (id) {
      var w = wordOf(id);
      return w && WL.quiz.spellable(w);
    });
    if (!s.spellQueue.length) { finishSession(); return; }
    s.phase = 'spellask';
    S.view = 'spellask';
    render();
  }

  function startSpell() {
    var s = S.session;
    s.phase = 'spell';
    s.items = s.spellQueue.map(function (id) { return { wid: id, from: 'spell', retry: 0 }; });
    s.i = 0;
    s.total = s.items.length;
    s.q = null;
    s.answered = null;
    S.view = 'study';
    prepare();
    render();
  }

  function finishSession() {
    var s = S.session;
    if (!s) return;
    if (!s.ended) {
      s.ended = true;
      WL.store.bumpLog('ms', Date.now() - s.t0);
    }
    s.phase = 'done';
    WL.store.removeSession();
    S.view = 'study';
    render();
  }

  // 练习模式收尾：不计入学习时长日志
  function finishPractice() {
    var s = S.session;
    if (!s) return;
    s.ended = true;
    s.phase = 'done';
    WL.store.removeSession();
    S.view = 'study';
    render();
  }

  // 学有余力时的练习模式：抽已学词巩固，不计入进度与统计
  // scope: 'all' 随机已学 | 'wrong' 答错过(lapses≥1) | 'risk' 遗忘风险
  function startPractice(mode, scope) {
    var book = curBook();
    if (!book) return;
    var prog = WL.store.getProgress(book.id);
    var now = Date.now();
    var chs = activeChannels();
    var learned = book.words.filter(function (w) { return prog[w.id] && !prog[w.id].cut; });
    if (scope === 'wrong') {
      learned = learned.filter(function (w) { return prog[w.id].lapses >= 1; });
    } else if (scope === 'risk') {
      learned = learned.filter(function (w) { return WL.srs.healthOf(prog[w.id], now, chs) === 'risk'; });
    }
    if (!learned.length) {
      toast(scope === 'wrong' ? '当前没有答错过（未斩）的词' : scope === 'risk' ? '当前没有遗忘风险词' : '先学一些词再来练习');
      return;
    }
    if (learned.length > PRACTICE_SIZE) learned = WL.quiz.shuffle(learned).slice(0, PRACTICE_SIZE);

    S.session = {
      phase: 'practice',
      practiceMode: mode === 'cn2en' ? 'cn2en' : 'en2cn',
      learn: [],
      li: 0,
      reviewWids: [],
      spellQueue: [],
      items: learned.map(function (w) { return { wid: w.id, from: 'practice', retry: 0 }; }),
      i: 0,
      total: learned.length,
      retryCard: false,
      bookId: book.id,
      t0: Date.now(),
      q: null,
      answered: null,
      newDone: {},
      revDone: {},
      spokenFor: '',
      right: 0,
      wrong: 0,
      ended: false
    };
    S.view = 'study';
    prepare();
    render();
  }

  // 一段队列走完之后去哪，由当前阶段决定
  function queueDrained() {
    var s = S.session;
    if (s.phase === 'review') {
      if (s.learn.length) enterLearnPhase();
      else enterSpellAsk();
    } else if (s.phase === 'quiz') {
      s.li++;
      nextFromLearn();
    } else if (s.phase === 'practice') {
      finishPractice();
    } else if (s.phase === 'spell') {
      finishSession();
    } else {
      finishSession();
    }
  }

  function markLearned(wid, word) {
    var s = S.session;
    var prog = WL.store.getProgress(s.bookId);
    var st = prog[wid];
    if (st) return st;
    st = WL.srs.newState(word, Date.now());
    st.seen = 0;
    WL.store.putProgress(s.bookId, wid, st);
    WL.store.flush();
    if (!s.newDone[wid]) {
      s.newDone[wid] = 1;
      WL.store.bumpLog('nw');
    }
    return st;
  }

  function currentItem() {
    var s = S.session;
    if (!s || s.i >= s.items.length) return null;
    return s.items[s.i];
  }

  function prepare() {
    var s = S.session;
    var cur = currentItem();
    s.answered = null;
    if (!cur) { s.q = null; return; }
    var word = wordOf(cur.wid);
    if (!word) { s.q = null; return; }

    var cfg = WL.store.getConfig();
    var prog = WL.store.getProgress(s.bookId);
    var st = prog[cur.wid];
    var now = Date.now();
    var channel = 'r';
    var type;

    if (cur.from === 'spell') {
      type = 'spell';
    } else if (cur.from === 'practice') {
      // 练习模式：整轮固定一种题型
      type = s.practiceMode || 'en2cn';
    } else if (cur.from === 'new') {
      // 刚看完词卡，立刻测「看词选义」：认出刚见过的这个词；
      // 「看义选词」这类回忆词形的题留给复习阶段的产出通道
      type = 'en2cn';
    } else if (cur.from === 'review' && st) {
      var chs = activeChannels();
      channel = WL.srs.weakestChannel(st, now, chs);
      if (chs.indexOf(channel) < 0) channel = 'r';
      type = WL.quiz.chooseType(word, channel, cfg.activeTypes);
    } else {
      type = WL.quiz.chooseType(word, 'r', cfg.activeTypes);
    }
    var q = WL.quiz.build(word, type, curBook().words) ||
      WL.quiz.build(word, 'en2cn', curBook().words);
    s.q = q;
    // 每道题的状态：首次计分标记与拼写就地重拼状态
    s.spellGraded = false;
    s.spellMissed = false;
    s.itemGraded = false;

    if (type === 'audio2cn') WL.quiz.speak(word.w, cfg.sound);
    if (type === 'spell') WL.quiz.speak(word.w, cfg.sound);
  }

  // 答对：只让选项变绿，随即进入下一题，不再追加任何反馈条
  function answer(idx) {
    var s = S.session;
    if (!s || s.answered || !s.q) return;
    var picked = s.q.options[idx];
    if (!picked) return;
    var ok = !!picked.ok;
    s.answered = { idx: idx, ok: ok };
    s.answeredAt = Date.now();
    grade(ok);
    render();
    if (ok) {
      // 答对后停留久一点，让用户读完各选项对应的单词与释义；点击任意选项可提前继续
      setTimeout(function () {
        if (S.session === s && s.answered && s.answered.ok) advanceCorrect();
      }, 2600);
    } else {
      setTimeout(function () {
        if (S.session === s && s.answered && !s.answered.ok) {
          // 练习模式答错：停留看一眼正确答案后直接下一题，不退回词卡
          if (currentItem() && currentItem().from === 'practice') advanceCorrect();
          else enterRetry();
        }
      }, 720);
    }
  }

  function answerSpell(value) {
    var s = S.session;
    if (!s || s.answered || !s.q) return;
    var ok = WL.quiz.normalize(value) === WL.quiz.normalize(s.q.answer);
    // 每次出现的首次提交计分；看正确答案后的纠正重拼不计分
    if (!s.spellGraded) {
      s.spellGraded = true;
      grade(ok);
    }
    s.answered = { idx: -1, ok: ok };
    render();
    if (ok) {
      setTimeout(function () {
        if (S.session !== s || !s.answered || !s.answered.ok) return;
        // 这一次出现是「拼错后纠正过来的」：把词排到队列最后，稍后再拼一次确认记忆；
        // 再拼对就过，再拼错就重复这个循环（最多重排 SPELL_REQUEUE_MAX 轮）
        if (s.spellMissed) {
          var cur2 = currentItem();
          var requeues = (cur2 && cur2.retry) || 0;
          s.answered = null;
          if (cur2 && requeues < SPELL_REQUEUE_MAX) {
            s.items.push({ wid: cur2.wid, from: 'spell', retry: requeues + 1 });
            s.total = s.items.length;
          }
          advanceCorrect();
          return;
        }
        advanceCorrect();
      }, 420);
    } else {
      setTimeout(function () {
        if (S.session === s && s.answered && !s.answered.ok) spellRetryInPlace();
      }, 900);
    }
  }

  // 拼写答错：留在当前题，亮出正确拼写和读音按钮，清空输入框重新拼
  function spellRetryInPlace() {
    var s = S.session;
    if (!s) return;
    s.spellMissed = true;
    s.answered = null;
    render();
  }

  function grade(ok) {
    var s = S.session;
    var cur = currentItem();
    if (!cur) return;
    s.itemGraded = true;
    if (cur.from === 'practice') {
      // 练习模式：不计入记忆调度，但计入每日练习量（激励用）
      if (ok) s.right++; else s.wrong++;
      WL.store.bumpLog('pr', 1);
      WL.store.flush();
      if (WL.sync) WL.sync.markDirty();
      return;
    }
    var now = Date.now();
    var prog = WL.store.getProgress(s.bookId);
    var st = prog[cur.wid];
    var word = wordOf(cur.wid);

    if (!st) {
      st = WL.srs.newState(word, now);
      st.seen = 1;
      prog[cur.wid] = st;
    }

    var channel = s.q ? s.q.channel : 'r';
    WL.srs.review(st, channel, ok, now);
    WL.store.putProgress(s.bookId, cur.wid, st);

    if (ok) {
      s.right++;
      WL.store.bumpLog('ok');
      if (cur.from === 'review' && !s.revDone[cur.wid]) {
        s.revDone[cur.wid] = 1;
        WL.store.bumpLog('rv');
      }
    } else {
      s.wrong++;
      WL.store.bumpLog('bad');
    }
    WL.store.flush();
    if (WL.sync) WL.sync.markDirty();
  }

  function advanceCorrect() {
    var s = S.session;
    if (!s) return;
    s.i++;
    s.q = null;
    s.answered = null;
    if (s.i >= s.items.length) {
      queueDrained();
      return;
    }
    prepare();
    render();
  }

  // 答错：先停在该词的介绍页，看完再回队列，该词稍后重考
  function enterRetry() {
    var s = S.session;
    if (!s) return;
    s.retryCard = true;
    s.answered = null;
    render();
  }

  function leaveRetry() {
    var s = S.session;
    var cur = currentItem();
    if (!cur) return;
    var retry = cur.retry || 0;
    s.retryCard = false;

    if (retry < 2) {
      var copy = { wid: cur.wid, from: cur.from, retry: retry + 1 };
      var at = Math.min(s.items.length, s.i + 3);
      s.items.splice(at, 0, copy);
    }
    s.i++;
    s.q = null;
    s.answered = null;

    if (s.i >= s.items.length) {
      queueDrained();
      return;
    }
    prepare();
    render();
  }

  /* ============ 视图 ============ */

  // 登录门的判定：令牌存在且经过一次真实校验
  function loggedIn() {
    return WL.sync.configured() && !!WL.sync.get().verified;
  }

  function render() {
    var app = document.getElementById('app');
    app.innerHTML = '';
    if (!loggedIn()) {
      // 登录门：没有令牌只能看到锁屏
      if (!WL.store.available()) app.appendChild(storageBanner());
      app.appendChild(lockBody());
      if (S.toast) {
        var lt = el('div', 'toast', S.toast);
        lt.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#1E1C19;color:#fff;padding:9px 16px;border-radius:6px;font-size:13px;z-index:99';
        app.appendChild(lt);
      }
      return;
    }
    app.appendChild(topbar());
    if (!WL.store.available()) app.appendChild(storageBanner());

    var body;
    if (S.view === 'study') body = viewStudy();
    else if (S.view === 'learn') body = viewLearn();
    else if (S.view === 'spellask') body = viewSpellAsk();
    else if (S.view === 'resume') body = viewResume();
    else if (S.view === 'books') body = viewBooks();
    else if (S.view === 'stats') body = viewStats();
    else if (S.view === 'settings') body = viewSettings();
    else body = viewHome();

    app.appendChild(body);

    // 断点续学：会话快照随渲染保存；没有会话时清掉残留快照
    if (loggedIn() && S.session) {
      try { WL.store.saveSession(JSON.parse(JSON.stringify(S.session))); } catch (e) { /* 快照失败忽略 */ }
    } else if (loggedIn() && !S.session) {
      WL.store.removeSession();
    }

    if (S.toast) {
      var t = el('div', 'toast', S.toast);
      t.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#1E1C19;color:#fff;padding:9px 16px;border-radius:6px;font-size:13px;z-index:99';
      app.appendChild(t);
    }
  }

  /* ============ 登录门 ============ */

  function lockBody() {
    var sy = WL.sync.state();
    var wrap = el('div', 'stack lock');
    wrap.appendChild(h('<div class="lock-brand">Lexi<span>lume</span></div>'));

    var card = el('div', 'card');
    card.appendChild(h('<div class="small muted" style="margin-bottom:16px;line-height:1.8">这是私人学习站，凭访问令牌登录后使用。登录同时会开启跨设备同步。</div>'));

    var err = el('div', 'small');
    err.style.color = 'var(--wrong)';
    err.style.marginTop = '12px';
    err.style.minHeight = '18px';
    err.textContent = sy.lastError || '';

    var fRepo = el('div', 'field');
    fRepo.appendChild(el('label', null, '仓库'));
    var iRepo = el('input');
    iRepo.type = 'text';
    iRepo.value = sy.owner + '/' + sy.repo;
    fRepo.appendChild(iRepo);
    card.appendChild(fRepo);

    var fTok = el('div', 'field');
    fTok.appendChild(el('label', null, '访问令牌'));
    var iTok = el('input');
    iTok.type = 'password';
    iTok.autocomplete = 'off';
    iTok.placeholder = '粘贴 github_pat_ 开头的令牌';
    fTok.appendChild(iTok);
    card.appendChild(fTok);

    var btn = el('button', 'btn primary block lg', '登录');
    btn.style.marginTop = '18px';
    btn.onclick = function () {
      var parts = iRepo.value.trim().split('/');
      if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
        err.textContent = '仓库要写成 用户名/仓库名';
        return;
      }
      if (!iTok.value.trim()) {
        err.textContent = '先粘贴访问令牌';
        return;
      }
      btn.disabled = true;
      btn.textContent = '登录中…';
      err.textContent = '';
      WL.sync.setConf({ owner: parts[0].trim(), repo: parts[1].trim(), branch: 'main', path: 'progress.json', token: iTok.value.trim() });
      // silent：失败时不触发 finally 里的重渲染，锁屏上已输入的内容得以保留
      WL.sync.run(true).then(function (r) {
        if (r.ok) {
          // 登录成功，进入正常界面
          S.view = 'home';
          render();
          return;
        }
        // 失败留在锁屏，不重建 DOM，保留已输入内容；失败原因写入同步配置，下次渲染也会显示
        btn.disabled = false;
        btn.textContent = '登录';
        err.textContent = '登录失败：' + r.msg;
      });
    };
    card.appendChild(btn);
    card.appendChild(err);

    // 快捷入口：直达 GitHub 新建令牌页
    card.appendChild(h('<div class="small" style="margin-top:16px">没有令牌？<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">去 GitHub 生成访问令牌</a>' +
      '<span class="muted">（勾选 Lexilume 仓库，给 Contents 读写）</span></div>'));

    card.appendChild(h('<div class="small muted" style="margin-top:14px;line-height:1.8">令牌只保存在这台设备上，可随时在 GitHub 撤销。</div>'));
    wrap.appendChild(card);
    return wrap;
  }

  // 令牌失效或退出登录后回到锁屏
  function lockOut(msg) {
    S.session = null;
    S.view = 'lock';
    WL.sync.clear();
    WL.store.removeSession();
    if (msg) toast(msg);
    render();
  }

  /* ============ 断点续学 ============ */

  function remainingText(s) {
    if (s.phase === 'review') return '复习剩 ' + Math.max(0, s.items.length - s.i) + ' 题';
    if (s.phase === 'quiz') return '新学第 ' + (s.li + 1) + ' / ' + s.learn.length + ' 词';
    if (s.phase === 'spell') return '拼写剩 ' + Math.max(0, s.items.length - s.i) + ' 题';
    if (s.phase === 'spellask') return '拼写待开始';
    if (s.phase === 'practice') return '练习剩 ' + Math.max(0, s.items.length - s.i) + ' 题';
    return '进行中';
  }

  function viewResume() {
    var s = S.session;
    var wrap = el('div', 'stack');
    var card = el('div', 'card');
    card.style.textAlign = 'center';
    card.appendChild(h('<div style="font-size:24px;margin-bottom:6px">上次学习未完成</div>'));
    card.appendChild(h('<div class="muted small">还剩 ' + remainingText(s) + '。继续吗？</div>'));

    var go = el('button', 'btn primary block lg', '继续本轮');
    go.style.marginTop = '20px';
    go.onclick = resumeSession;
    card.appendChild(go);

    var fresh = el('button', 'btn ghost block', '重新开始');
    fresh.style.marginTop = '8px';
    fresh.onclick = function () {
      WL.store.removeSession();
      S.session = null;
      startSession();
    };
    card.appendChild(fresh);

    wrap.appendChild(card);
    return wrap;
  }

  // 恢复快照。若快照停在某题的展示态（该题已计分），跳过它不重复计分
  function resumeSession() {
    var s = S.session;
    if (!s) return;
    if (s.answered && s.itemGraded) {
      s.answered = null;
      S.view = 'study';
      advanceCorrect();
      return;
    }
    if (s.phase === 'learn') S.view = 'learn';
    else if (s.phase === 'spellask') S.view = 'spellask';
    else S.view = 'study';
    render();
  }

  function topbar() {
    var bar = el('div', 'topbar');
    var brand = h('<div class="brand">Lexi<span>lume</span></div>');
    bar.appendChild(brand);

    var tabs = el('nav', 'tabs');
    var defs = [
      ['home', '学习'],
      ['books', '词表'],
      ['stats', '统计'],
      ['settings', '设置']
    ];
    defs.forEach(function (d) {
      var b = el('button', 'tab' + (S.view === d[0] || (d[0] === 'home' && (S.view === 'study' || S.view === 'learn' || S.view === 'spellask')) ? ' on' : ''), d[1]);
      b.onclick = function () {
        S.view = d[0];
        render();
      };
      tabs.appendChild(b);
    });
    bar.appendChild(tabs);
    return bar;
  }

  function viewHome() {
    var cfg = WL.store.getConfig();
    var book = curBook();
    var wrap = el('div', 'stack');
    if (!book) {
      wrap.appendChild(h('<div class="empty"><div class="big">还没有词表</div><div>去「词表」导入一份吧</div></div>'));
      return wrap;
    }

    var prog = WL.store.getProgress(book.id);
    var now = Date.now();
    var chs = activeChannels();
    var total = book.words.length;
    var learned = 0, dueN = 0;
    book.words.forEach(function (w) {
      var st = prog[w.id];
      if (st) {
        learned++;
        if (!st.cut && WL.srs.dueNow(st, now, chs)) dueN++;
      }
    });

    var today = WL.store.getToday();
    var streak = WL.store.streakDays();

    // 今日正确率放首页最上面（当天答过题才显示）
    if (today.ok + today.bad > 0) {
      var rateCard = el('div', 'card');
      rateCard.appendChild(el('h2', 'section', '今日正确率'));
      var rate = Math.round(today.ok / (today.ok + today.bad) * 100);
      rateCard.appendChild(h('<div style="font-size:26px;font-variant-numeric:tabular-nums">' + rate + '%</div>'));
      rateCard.appendChild(h('<div class="small muted">答对 ' + today.ok + ' · 答错 ' + today.bad + '</div>'));
      wrap.appendChild(rateCard);
    }

    var ov = el('div', 'overview');
    [['待复习', dueN], ['今日新学', today.nw], ['今日复习', today.rv], ['连续天数', streak]].forEach(function (x) {
      var cell = el('div', 'ov-cell');
      cell.appendChild(el('div', 'ov-num', String(x[1])));
      cell.appendChild(el('div', 'ov-label', x[0]));
      ov.appendChild(cell);
    });
    wrap.appendChild(ov);

    var card = el('div', 'card');
    card.appendChild(el('h2', 'section', '当前词表'));
    var line = el('div', 'spread');
    line.appendChild(h('<div><div style="font-size:17px">' + book.name + '</div><div class="small muted">已学 ' + learned + ' / ' + total + ' 词</div></div>'));
    card.appendChild(line);

    var bar = el('div', 'bar');
    bar.style.marginTop = '14px';
    var fill = el('i');
    fill.style.width = (total ? (learned / total * 100) : 0).toFixed(1) + '%';
    bar.appendChild(fill);
    card.appendChild(bar);
    wrap.appendChild(card);

    var startCard = el('div', 'card');
    var dueLimited = Math.min(dueN, cfg.reviewLimit);
    var nextNew = Math.min(cfg.newLimit, total - learned);
    var estMin = Math.max(1, Math.round((dueLimited * 15 + nextNew * 40) / 60));
    var estText = dueLimited + nextNew > 0
      ? '复习 ' + dueLimited + ' 个 · 新学 ' + nextNew + ' 个 · 约 ' + estMin + ' 分钟'
      : '今天没有待学内容';
    startCard.appendChild(h(
      '<div class="spread" style="margin-bottom:14px">' +
      '<div><div style="font-size:16px">今天的学习</div>' +
      '<div class="small muted">' + estText + '</div></div>' +
      '<div class="small muted">上限 新' + cfg.newLimit + ' / 复' + cfg.reviewLimit + '</div>' +
      '</div>'
    ));

    var goRow = el('div', 'learn-actions');
    var ro = el('button', 'btn lg btn-go', '复习');
    ro.disabled = !dueN;
    ro.onclick = function () { startSession('review'); };
    goRow.appendChild(ro);
    var go = el('button', 'btn primary lg btn-go', '新学');
    go.disabled = !nextNew;
    go.onclick = function () { startSession('new'); };
    goRow.appendChild(go);
    startCard.appendChild(goRow);

    if (dueN > cfg.reviewLimit) {
      startCard.appendChild(h('<div class="small muted" style="margin-top:10px">另有 ' + (dueN - cfg.reviewLimit) +
        ' 个到期复习词超过今日上限，会自动排入之后几天优先补上，不会丢失。</div>'));
    }
    wrap.appendChild(startCard);

    // 练习模式：学有余力时的额外巩固，不动调度
    var pc = el('div', 'card');
    pc.appendChild(el('h2', 'section', '练习模式'));
    var todayPr = today.pr || 0;
    pc.appendChild(h('<div class="small muted" style="margin-bottom:14px">抽 ' + PRACTICE_SIZE +
      ' 个已学词做巩固练习，答错会展示正确答案。' +
      (todayPr ? '今天已练 ' + todayPr + ' 题。' : '') + '</div>'));

    pc.appendChild(h('<div class="small muted" style="margin:0 0 8px">范围</div>'));
    pc.appendChild(segGroup([
      ['all', '全部已学词'], ['wrong', '只练答错的词'], ['risk', '只练遗忘风险词']
    ], practiceSel.scope, function (v) { practiceSel.scope = v; render(); }));

    var gap = el('div');
    gap.style.height = '14px';
    pc.appendChild(gap);

    pc.appendChild(h('<div class="small muted" style="margin:0 0 8px">题型</div>'));
    pc.appendChild(segGroup([
      ['en2cn', '看词选义'], ['cn2en', '看义选词']
    ], practiceSel.mode, function (v) { practiceSel.mode = v; render(); }));

    var pgo = el('button', 'btn primary block', '开始练习');
    pgo.style.marginTop = '18px';
    if (!learned) pgo.disabled = true;
    pgo.onclick = function () { startPractice(practiceSel.mode, practiceSel.scope); };
    pc.appendChild(pgo);
    wrap.appendChild(pc);

    return wrap;
  }

  // 存储不可用时在顶部明说，别让用户白学一轮
  function storageBanner() {
    var d = el('div', 'warnbar');
    d.innerHTML =
      '<b>当前页面写不进本地存储，这一轮的记录不会保存。</b>' +
      '<div class="small" style="margin-top:8px;line-height:1.85">' +
      '预览窗口和一些嵌入环境会把浏览器的存储隔离成一次性的，关掉就清空。换下面任意一种方式打开就能正常记录：<br>' +
      '① 双击文件夹里的 <code>index.html</code>，数据存在本机浏览器，断网也照常<br>' +
      '② 部署之后用网址打开，例如 <code>https://starryeeeeee.github.io/Lexilume/</code><br>' +
      '③ 只想临时留存，去「设置 → 导出备份」存一个 JSON，换环境再导回来' +
      '</div>';
    return d;
  }

  function viewStudy() {
    var s = S.session;
    if (!s) { S.view = 'home'; return viewHome(); }
    if (s.i >= s.items.length) return viewDone();

    var cur = currentItem();
    var word = wordOf(cur.wid);
    if (!word) { s.i++; return viewStudy(); }

    var wrap = el('div', 'stack');
    var total = s.total || s.items.length;
    var doneN = Math.min(s.i, total);

    var stage = s.retryCard ? '回顾'
      : s.phase === 'spell' ? '拼写'
      : s.phase === 'quiz' ? '新学'
      : s.phase === 'practice' ? '练习' : '复习';
    var where;
    if (s.phase === 'quiz') {
      where = '第 ' + (s.li + 1) + ' / ' + s.learn.length + ' 词';
    } else {
      where = (doneN + 1) + ' / ' + total;
    }

    var top = el('div', 'study-top');
    top.appendChild(el('div', null, stage + ' · ' + where));
    top.appendChild(el('div', null, '对 ' + s.right + ' · 错 ' + s.wrong));
    wrap.appendChild(top);

    var bar = el('div', 'bar');
    bar.style.marginBottom = '14px';
    var fill = el('i');
    if (s.phase === 'quiz') {
      fill.style.width = (s.li / Math.max(1, s.learn.length) * 100).toFixed(1) + '%';
    } else {
      fill.style.width = (doneN / total * 100).toFixed(1) + '%';
    }
    bar.appendChild(fill);
    wrap.appendChild(bar);

    if (s.retryCard) {
      wrap.appendChild(learnCard(word, '看懂了，继续', leaveRetry));
    } else {
      wrap.appendChild(questionCard(word));
    }

    if (s.phase === 'spell' && !s.retryCard) {
      var exit = el('div', 'study-exit');
      var skip = el('button', 'btn ghost');
      skip.textContent = '跳过剩余拼写，完成今日学习';
      skip.onclick = finishSession;
      exit.appendChild(skip);
      wrap.appendChild(exit);
    }

    if (s.phase === 'practice' && !s.retryCard) {
      var exit2 = el('div', 'study-exit');
      var cutBtn = el('button', 'btn ghost');
      cutBtn.textContent = '斩';
      cutBtn.title = '斩：这个词不再进入后续复习';
      cutBtn.onclick = function () {
        var cur = currentItem();
        if (!cur) return;
        var w = wordOf(cur.wid);
        if (!w) return;
        markCut(cur.wid, w);
        // 本轮练习的剩余队列里也移除该词
        s.items = s.items.filter(function (it, idx) { return idx <= s.i || it.wid !== cur.wid; });
        s.total = s.items.length;
        toast('已斩「' + w.w + '」，不再进入复习');
        render();
      };
      exit2.appendChild(cutBtn);
      var quit = el('button', 'btn ghost');
      quit.textContent = '结束练习';
      quit.onclick = finishPractice;
      exit2.appendChild(quit);
      wrap.appendChild(exit2);
    }
    return wrap;
  }

  // 新学阶段：每张词卡看完立刻测这个词
  function viewLearn() {
    var s = S.session;
    if (!s) { S.view = 'home'; return viewHome(); }
    if (s.li >= s.learn.length) {
      enterSpellAsk();
      return viewSpellAsk();
    }

    var wid = s.learn[s.li];
    var word = wordOf(wid);
    if (!word) { s.li++; return viewLearn(); }

    var total = s.learn.length;

    var wrap = el('div', 'stack');
    var top = el('div', 'study-top');
    top.appendChild(el('div', null, '新学 · 第 ' + (s.li + 1) + ' / ' + total + ' 词'));
    wrap.appendChild(top);

    var bar = el('div', 'bar');
    bar.style.marginBottom = '14px';
    var fill = el('i');
    fill.style.width = (s.li / total * 100).toFixed(1) + '%';
    bar.appendChild(fill);
    wrap.appendChild(bar);

    wrap.appendChild(learnCard(word, '继续', function () {
      // li 仍指向当前这张卡；advanceFromCard 学完这个词，测完由 queueDrained 里 li++
      advanceFromCard();
    }, true));
    return wrap;
  }

  // 拼写环节前的选择页：继续拼写或者跳过
  function viewSpellAsk() {
    var s = S.session;
    if (!s) { S.view = 'home'; return viewHome(); }
    var n = s.spellQueue.length;

    var wrap = el('div', 'stack');
    var card = el('div', 'card');
    card.style.textAlign = 'center';
    card.appendChild(h('<div style="font-size:24px;margin-bottom:6px">今日新学完成</div>'));
    card.appendChild(h('<div class="muted small">新学了 ' + Object.keys(s.newDone).length +
      ' 个词。要进入拼写模式吗？拼写模式只显示中文释义并朗读单词，你来拼写。</div>'));
    card.appendChild(clayArt('party_popper_3d.png'));

    var go = el('button', 'btn primary block lg', '进入拼写模式（' + n + ' 词）');
    go.style.marginTop = '20px';
    go.onclick = startSpell;
    card.appendChild(go);

    var skip = el('button', 'btn ghost block', '跳过拼写，完成今日学习');
    skip.style.marginTop = '8px';
    skip.onclick = finishSession;
    card.appendChild(skip);

    wrap.appendChild(card);
    return wrap;
  }

  function learnCard(word, btnText, onClick, withCut) {
    var cfg = WL.store.getConfig();
    var s = S.session;
    var card = el('div', 'qcard learn-body');
    card.appendChild(el('div', 'learn-word', word.w));

    var phRow = el('div', 'learn-ph');
    if (cfg.sound) {
      var sp = el('span', 'speak');
      sp.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
      sp.onclick = function (e) { e.stopPropagation(); WL.quiz.speak(word.w, true); };
      phRow.appendChild(sp);
    }
    if (word.ph) phRow.appendChild(el('span', null, word.ph));
    card.appendChild(phRow);

    var def = el('div', 'learn-def');
    def.appendChild(h('<div><span class="pos">' + (word.pos || '') + '</span>' + word.tr + '</div>'));
    if (word.ex) {
      def.appendChild(h('<div class="learn-ex">' + word.ex + '</div>'));
      if (word.exCn) def.appendChild(h('<div class="learn-ex-cn">' + word.exCn + '</div>'));
    }
    card.appendChild(def);

    var actions = el('div', 'learn-actions');
    if (withCut) {
      var cut = el('button', 'btn lg btn-cut', '斩');
      cut.title = '斩：这个词不再进入后续复习';
      cut.onclick = function () { cutAndNext(word.id, word); };
      actions.appendChild(cut);
    }
    var go = el('button', 'btn primary lg btn-go', btnText || '继续');
    go.onclick = onClick;
    actions.appendChild(go);
    card.appendChild(actions);

    if (cfg.sound && s && s.spokenFor !== word.id) {
      s.spokenFor = word.id;
      WL.quiz.speak(word.w, true);
    }
    return card;
  }

  // 斩：给词打上 cut 标记，后续不再进入复习与练习
  function markCut(wid, word) {
    var s = S.session;
    if (!s) return;
    var prog = WL.store.getProgress(s.bookId);
    var st = prog[wid];
    if (!st) {
      st = WL.srs.newState(word, Date.now());
      st.seen = 1;
      prog[wid] = st;
    }
    st.cut = Date.now();
    WL.store.putProgress(s.bookId, wid, st);
    WL.store.flush();
    if (WL.sync) WL.sync.markDirty();
  }

  // 斩：确认掌握的词打上标记，后续不再进入复习；本词也跳过测验
  function cutAndNext(wid, word) {
    var s = S.session;
    if (!s) return;
    markCut(wid, word);
    s.li++;
    if (s.li >= s.learn.length) enterSpellAsk();
    else enterLearnPhase();
  }

  function questionCard(word) {
    var s = S.session;
    var q = s.q;
    var cfg = WL.store.getConfig();

    if (!q) {
      var empty = el('div', 'qcard');
      empty.textContent = '题目生成失败';
      return empty;
    }

    var card = el('div', 'qcard');
    var chip = el('div', 'chip', q.label);
    chip.style.marginBottom = '18px';
    card.appendChild(chip);

    var prompt = el('div', 'qprompt');
    if (q.type === 'en2cn' || q.type === 'audio2cn') {
      if (q.type === 'audio2cn') {
        prompt = el('div', 'qprompt', '· · ·');
        prompt.style.letterSpacing = '0.3em';
      } else {
        prompt.textContent = q.prompt;
      }
    } else if (q.type === 'cn2en' || q.type === 'spell') {
      prompt.className = 'qprompt zh';
      prompt.textContent = q.prompt;
    } else {
      prompt.className = 'qprompt sentence';
      prompt.textContent = q.prompt;
    }
    card.appendChild(prompt);

    if (q.sub && q.type !== 'spell') {
      var sub = el('div', 'qsub');
      if (q.type === 'audio2cn') {
        var btn = el('button', 'btn ghost', '再听一次');
        btn.onclick = function () { WL.quiz.speak(word.w, true); };
        card.appendChild(btn);
        sub.textContent = '';
      } else {
        sub.textContent = q.sub;
      }
      if (sub.textContent) card.appendChild(sub);
    }

    if (q.type === 'spell') {
      // 拼写模式：只显示中文释义，单词音频在出题时自动播放；读音按钮兼作提示
      var replay = el('button', 'btn ghost', '再听一次');
      replay.onclick = function () { WL.quiz.speak(word.w, true); };
      card.appendChild(replay);

      // 拼错过：就地亮出正确拼写，听读音后重新拼，不跳下一词
      if (s.spellMissed) {
        card.appendChild(h('<div class="spell-reveal"><div class="spell-correct">拼错了，正确拼写是 <b>' + q.answer + '</b></div></div>'));
      }

      var box = el('div', 'spellbox');
      var input = el('input');
      input.type = 'text';
      input.placeholder = '输入单词';
      input.autocomplete = 'off';
      input.autocapitalize = 'off';
      input.spellcheck = false;
      var submit = el('button', 'btn primary', '确认');
      var doSubmit = function () {
        if (input.value.trim() === '') return;
        answerSpell(input.value);
      };
      submit.onclick = doSubmit;
      input.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doSubmit(); }
      };
      box.appendChild(input);
      box.appendChild(submit);
      card.appendChild(box);

      if (s.answered) {
        input.value = s.answered.ok ? q.answer : input.value;
        input.classList.add(s.answered.ok ? 'right' : 'wrong');
        input.disabled = true;
        submit.disabled = true;
      } else {
        setTimeout(function () { if (document.body.contains(input)) input.focus(); }, 30);
      }
      card.appendChild(qFoot('输入后回车确认'));
      return card;
    }

    var opts = el('div', 'options');
    var isEnPrimary = q.type === 'cn2en' || q.type === 'cloze';
    q.options.forEach(function (o, i) {
      var b = el('button', 'opt');
      b.appendChild(el('span', 'key', String(i + 1)));
      var txt2 = el('span', 'txt');
      var answeredOk = s.answered && s.answered.ok && o.src;
      if (isEnPrimary) {
        // 主行是英文（看义选词），答对后中文释义从下方平滑展开
        txt2.appendChild(el('span', 'opt-en', o.text));
        if (answeredOk) txt2.appendChild(el('span', 'opt-zh opt-add', o.meaning));
      } else {
        // 主行是中文（看词选义），答对后英文单词从上方平滑展开
        if (answeredOk) txt2.appendChild(el('span', 'opt-en opt-add', o.src));
        txt2.appendChild(el('span', 'opt-zh', o.text));
      }
      b.appendChild(txt2);

      if (s.answered) {
        if (o.ok) b.classList.add('right');
        else if (i === s.answered.idx) b.classList.add('wrong');
        else b.classList.add('dim');
        b.disabled = true;
      } else {
        b.onclick = function () { answer(i); };
      }
      opts.appendChild(b);
    });
    card.appendChild(opts);

    // 答对后的展示时长内，点任意位置可提前进入下一题（刚答完的短窗口内忽略，防双击误触）
    if (s.answered && s.answered.ok) {
      card.classList.add('answered-ok');
      card.onclick = function () {
        if (S.session === s && s.answered && s.answered.ok && Date.now() - (s.answeredAt || 0) > 600) advanceCorrect();
      };
    }

    card.appendChild(qFoot());
    return card;
  }


  // 固定高度的一行提示，作答前后都不变，避免卡片高度抖动
  function qFoot(text) {
    var f = el('div', 'qfoot');
    f.textContent = text || '按数字键 1–4 选择';
    return f;
  }

  function viewDone() {
    var s = S.session;
    var wrap = el('div', 'stack');
    var card = el('div', 'card');
    card.style.textAlign = 'center';
    var totalDone = s.right + s.wrong;

    if (s.practiceMode) {
      var todayPr = WL.store.getToday().pr || 0;
      card.appendChild(h('<div style="font-size:24px;margin-bottom:6px">本轮练习完成</div>'));
      card.appendChild(h('<div class="muted small">今天累计练习 ' + todayPr + ' 题</div>'));
      card.appendChild(clayArt('sparkles_3d.png'));
      card.appendChild(h(
        '<div class="overview" style="margin-top:20px;grid-template-columns:repeat(3,1fr)">' +
        '<div class="ov-cell"><div class="ov-num">' + s.right + '</div><div class="ov-label">答对</div></div>' +
        '<div class="ov-cell"><div class="ov-num">' + s.wrong + '</div><div class="ov-label">答错</div></div>' +
        '<div class="ov-cell"><div class="ov-num">' + (totalDone ? Math.round(s.right / totalDone * 100) : 0) + '%</div><div class="ov-label">正确率</div></div>' +
        '</div>'
      ));

      var more = el('button', 'btn primary block lg', '再练一组');
      more.style.marginTop = '20px';
      more.onclick = function () { startPractice(s.practiceMode); };
      card.appendChild(more);
    } else {
      var mins = Math.max(1, Math.round((Date.now() - s.t0) / 60000));
      card.appendChild(h('<div style="font-size:24px;margin-bottom:6px">本轮学习完成</div>'));
      card.appendChild(h('<div class="muted small">用时约 ' + mins + ' 分钟</div>'));
      card.appendChild(clayArt('trophy_3d.png'));
      card.appendChild(h(
        '<div class="overview" style="margin-top:20px">' +
        '<div class="ov-cell"><div class="ov-num">' + Object.keys(s.newDone).length + '</div><div class="ov-label">新学</div></div>' +
        '<div class="ov-cell"><div class="ov-num">' + Object.keys(s.revDone).length + '</div><div class="ov-label">复习</div></div>' +
        '<div class="ov-cell"><div class="ov-num">' + s.right + '</div><div class="ov-label">答对</div></div>' +
        '<div class="ov-cell"><div class="ov-num">' + (totalDone ? Math.round(s.right / totalDone * 100) : 0) + '%</div><div class="ov-label">正确率</div></div>' +
        '</div>'
      ));

      var again = el('button', 'btn primary block lg', '再来一组');
      again.style.marginTop = '20px';
      again.onclick = startSession;
      card.appendChild(again);
    }

    var back = el('button', 'btn ghost block', '回到首页');
    back.style.marginTop = '8px';
    back.onclick = function () { S.view = 'home'; S.session = null; render(); };
    card.appendChild(back);

    wrap.appendChild(card);
    return wrap;
  }

  /* ============ 每日时文词（Agnes 生成，仓库 data/daily/） ============ */

  function ghApi(path) {
    var c = WL.sync.get();
    return fetch('https://api.github.com' + path, {
      headers: {
        'Authorization': 'Bearer ' + c.token,
        'Accept': 'application/vnd.github+json'
      }
    }).then(function (res) {
      if (res.status === 404) return { status: 404, json: null };
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json().then(function (j) { return { status: res.status, json: j }; });
    });
  }

  function b64ToText(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function fetchDailyList() {
    var c = WL.sync.get();
    return ghApi('/repos/' + c.owner + '/' + c.repo + '/contents/data/daily?ref=' + (c.branch || 'main'))
      .then(function (r) {
        if (r.status === 404) return [];
        return (r.json || []).filter(function (f) { return f.type === 'file' && /\.json$/.test(f.name); })
          .map(function (f) { return { name: f.name, size: f.size }; });
      });
  }

  // 解析时文 JSON：字段容错、批内去重；结构非法返回 null
  function parseDaily(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.words)) return null;
    var seen = {};
    var words = [];
    (data.words || []).forEach(function (e) {
      if (!e || !e.word) return;
      var w = String(e.word).trim().toLowerCase();
      if (!w || seen[w]) return;
      seen[w] = 1;
      words.push({
        w: w,
        ph: e.phonetic || '',
        pos: e.pos || '',
        tr: e.meaning || '',
        ex: e.example || '',
        exCn: e.exampleCn || ''
      });
    });
    if (!words.length) return null;
    var date = (data.date || '').trim() || String(data.url || '').slice(-30);
    return {
      book: {
        id: 'daily-' + (date || Date.now().toString(36)),
        name: '时文 · ' + date,
        note: (data.source || '时文词表') + ' · ' + words.length + ' 词',
        words: words,
        notes: data.notes || []
      }
    };
  }

  function importDailyFile(file) {
    var c = WL.sync.get();
    return ghApi('/repos/' + c.owner + '/' + c.repo + '/contents/data/daily/' + encodeURIComponent(file.name) + '?ref=' + (c.branch || 'main'))
      .then(function (r) {
        if (r.status === 404 || !r.json || !r.json.content) return { ok: false, msg: '文件不存在或为空' };
        var data;
        try {
          data = JSON.parse(b64ToText(r.json.content));
        } catch (e) {
          return { ok: false, msg: '文件不是合法 JSON' };
        }
        var parsed = parseDaily(data);
        if (!parsed) return { ok: false, msg: '词表为空或格式不符合契约（见 AGNES.md）' };
        parsed.book.words.forEach(function (w, i) { w.id = parsed.book.id + '-' + i; });
        WL.books.push(parsed.book);
        WL.store.upsertUserBook(parsed.book);
        bookCache[parsed.book.id] = null;
        WL.store.markDailyImported(file.name);
        WL.store.setConfig({ book: parsed.book.id });
        S.bookId = parsed.book.id;
        return { ok: true, name: parsed.book.name };
      });
  }

  /* ============ 词表 ============ */

  function viewBooks() {
    var cfg = WL.store.getConfig();
    var wrap = el('div', 'stack');

    var card = el('div', 'card');
    card.appendChild(el('h2', 'section', '词表'));
    var list = el('div', 'book-list');
    (WL.books || []).forEach(function (b) {
      var prog = WL.store.getProgress(b.id);
      var learned = Object.keys(prog).length;
      var userOwned = WL.store.isUserBook(b.id);
      var btn = el('button', 'book' + (cfg.book === b.id ? ' on' : ''));
      var left = el('div');
      left.appendChild(el('div', 'book-name', b.name));
      left.appendChild(el('div', 'book-note', b.note || ''));
      btn.appendChild(left);
      btn.appendChild(el('div', 'book-meta', learned + ' / ' + b.words.length));
      btn.onclick = function () {
        WL.store.setConfig({ book: b.id });
        S.bookId = b.id;
        toast('已切换到「' + b.name + '」');
      };
      list.appendChild(btn);

      // 自建词书：提供重命名与删除（删除不传播到远端，见确认文案）
      if (userOwned) {
        var acts = el('div', 'book-acts');
        var rn = el('button', 'btn', '重命名');
        rn.onclick = function () {
          var name = prompt('新的词表名称', b.name);
          if (!name || !name.trim() || name.trim() === b.name) return;
          b.name = name.trim();
          WL.store.upsertUserBook(b);
          toast('已重命名');
          render();
        };
        acts.appendChild(rn);
        var del = el('button', 'btn ghost', '删除');
        del.onclick = function () {
          var progN = Object.keys(WL.store.getProgress(b.id)).length;
          if (!confirm('删除「' + b.name + '」？本机将移除该词书及其 ' + progN +
            ' 条学习进度。注意：远端 progress.json 里的进度会保留（删除不会传播）。')) return;
          WL.books = (WL.books || []).filter(function (x) { return x.id !== b.id; });
          WL.store.removeUserBook(b.id);
          WL.store.resetBook(b.id);
          delete bookCache[b.id];
          if (WL.store.getConfig().book === b.id) {
            WL.store.setConfig({ book: (WL.books[0] || {}).id });
            S.bookId = (WL.books[0] || {}).id;
          }
          toast('已删除「' + b.name + '」');
          render();
        };
        acts.appendChild(del);
        list.appendChild(acts);
      }
    });
    card.appendChild(list);
    wrap.appendChild(card);

    var imp = el('div', 'card');
    imp.appendChild(el('h2', 'section', '导入词表'));

    var hint = el('div', 'small muted');
    hint.style.marginBottom = '10px';
    hint.innerHTML = '每行一个词，用逗号或制表符分隔：<br>' +
      '<code class="small">word, 音标, 词性, 释义, 例句, 例句翻译</code><br>' +
      '后四项可以留空，只写 <code>word, 释义</code> 也可以；含逗号的字段用英文双引号包裹。';
    imp.appendChild(hint);

    var nameField = el('div', 'field');
    nameField.appendChild(el('label', null, '新词表名称（留空则追加到当前词表）'));
    var nameInput = el('input');
    nameInput.type = 'text';
    nameInput.placeholder = '例如：选必三 Unit 1';
    nameField.appendChild(nameInput);
    imp.appendChild(nameField);

    var ta = el('textarea');
    ta.placeholder = 'abandon, /əˈbændən/, v., 放弃；抛弃, She abandoned the project., 她放弃了那个项目。';
    var taField = el('div', 'field');
    taField.appendChild(ta);
    imp.appendChild(taField);

    var row = el('div', 'row');
    row.style.marginTop = '12px';
    var doImport = el('button', 'btn primary', '导入');
    doImport.onclick = function () {
      var text = ta.value.trim();
      if (!text) { toast('先粘贴一些内容'); return; }
      var rows = parseRows(text);
      if (!rows.length) { toast('没有解析到有效单词'); return; }
      var bookName = nameInput.value.trim();
      var target = curBook();

      // 批内去重 + 跳过目标词书里已有的词（不区分大小写）
      var existing = {};
      if (!bookName && target) {
        target.words.forEach(function (w) { existing[w.w.toLowerCase()] = 1; });
      }
      var seen = {};
      var kept = [];
      var dupCount = 0;
      rows.forEach(function (r) {
        var k = r.w.toLowerCase();
        if (seen[k] || existing[k]) { dupCount++; return; }
        seen[k] = 1;
        kept.push(r);
      });
      if (!kept.length) { toast('这批词都已存在，没有导入任何内容'); return; }
      var dupNote = dupCount ? '，跳过重复 ' + dupCount + ' 条' : '';

      if (bookName) {
        var id = 'u' + Date.now().toString(36);
        var nb = { id: id, name: bookName, note: '自建词表 · ' + kept.length + ' 词', words: kept };
        WL.books.push(nb);
        WL.store.upsertUserBook(nb);
        bookCache[id] = null;
        WL.store.setConfig({ book: id });
        S.bookId = id;
        toast('已新建「' + bookName + '」，导入 ' + kept.length + ' 词' + dupNote);
      } else if (target) {
        var start = target.words.length;
        var prefix = target.id + '-' + Date.now().toString(36) + '-';
        kept.forEach(function (r, i) { r.id = prefix + i; target.words.push(r); });
        target.byId = null;
        bookCache[target.id] = null;
        if (WL.store.isUserBook(target.id)) WL.store.upsertUserBook(target);
        toast('已追加 ' + kept.length + ' 词到「' + target.name + '」' + dupNote +
          (WL.store.isUserBook(target.id) ? '' : '（内置词书的追加内容刷新后不保留，长期使用建议新建词表）'));
      }
      ta.value = '';
      render();
    };
    row.appendChild(doImport);

    var tmpl = el('button', 'btn ghost', '填个示例');
    tmpl.onclick = function () {
      ta.value = 'abandon, /əˈbændən/, v., 放弃；抛弃, She abandoned the project., 她放弃了那个项目。\nabsorb, /əbˈzɔːb/, v., 吸收；理解, Plants absorb water., 植物吸收水分。';
    };
    row.appendChild(tmpl);
    imp.appendChild(row);
    wrap.appendChild(imp);

    var daily = el('div', 'card');
    daily.appendChild(el('h2', 'section', '每日时文词'));
    daily.appendChild(h('<div class="small muted" style="margin-bottom:12px">Agnes 每天从 China Daily 选词生成词表，放在仓库 <code>data/daily/</code> 里。点下面检查并一键导入为独立词书。</div>'));
    var drow = el('div', 'row');
    var checkBtn = el('button', 'btn primary', '检查远端时文词表');
    drow.appendChild(checkBtn);
    daily.appendChild(drow);
    var dList = el('div');
    daily.appendChild(dList);
    checkBtn.onclick = function () {
      checkBtn.disabled = true;
      checkBtn.textContent = '检查中…';
      fetchDailyList().then(function (files) {
        checkBtn.disabled = false;
        checkBtn.textContent = '检查远端时文词表';
        dList.innerHTML = '';
        if (!files.length) {
          dList.appendChild(h('<div class="small muted">data/daily/ 里还没有文件。等 Agnes 生成后再来检查。</div>'));
          return;
        }
        files.forEach(function (f) {
          var row = el('div', 'wrongitem');
          row.appendChild(el('span', 'w', f.name.replace('.json', '')));
          var imported = WL.store.isDailyImported(f.name);
          row.appendChild(el('span', 't', imported ? '已导入' : Math.round(f.size / 1024) + ' KB'));
          if (!imported) {
            var ib = el('button', 'btn', '导入');
            ib.style.cssText = 'padding:6px 14px;margin-left:auto;flex:none';
            ib.onclick = function () {
              ib.disabled = true;
              ib.textContent = '导入中…';
              importDailyFile(f).then(function (r) {
                if (r.ok) {
                  toast('已导入「' + r.name + '」');
                  render();
                } else {
                  ib.disabled = false;
                  ib.textContent = '导入';
                  toast('导入失败：' + r.msg);
                }
              }).catch(function (e) {
                ib.disabled = false;
                ib.textContent = '导入';
                toast('导入失败：' + (e.message || '网络错误'));
              });
            };
            row.appendChild(ib);
          }
          dList.appendChild(row);
        });
      }).catch(function (e) {
        checkBtn.disabled = false;
        checkBtn.textContent = '检查远端时文词表';
        toast('检查失败：' + (e.message || '网络错误'));
      });
    };
    wrap.appendChild(daily);

    var bk = el('div', 'card');
    bk.appendChild(el('h2', 'section', '数据'));
    var b1 = el('button', 'btn block', '导出备份（JSON）');
    b1.onclick = exportBackup;
    bk.appendChild(b1);
    var b2 = el('button', 'btn block ghost', '清空当前词表进度');
    b2.style.marginTop = '8px';
    b2.onclick = function () {
      if (!confirm('确定清空「' + curBook().name + '」的本机学习进度吗？\n注意：删除不会传播——下次同步时这些进度可能从远端合并回来。')) return;
      WL.store.resetBook(curBook().id);
      toast('已清空');
    };
    bk.appendChild(b2);
    wrap.appendChild(bk);

    return wrap;
  }

  // 按分隔符拆一行，支持英文双引号包裹（含分隔符或转义 "" 的字段）
  function splitLine(line, sep) {
    var out = [], cur = '', q = false, i, ch;
    for (i = 0; i < line.length; i++) {
      ch = line[i];
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else { q = false; }
        } else {
          cur += ch;
        }
      } else if (ch === '"' && cur === '') {
        q = true;
      } else if (ch === sep) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  function parseRows(text) {
    var lines = text.split(/\r?\n/);
    var out = [];
    var stamp = Date.now().toString(36);
    lines.forEach(function (line, i) {
      line = line.trim();
      if (!line || /^#/.test(line)) return;
      var sep = line.indexOf('\t') >= 0 ? '\t' : ',';
      var p = splitLine(line, sep);
      if (p.length < 2) return;
      var w = p[0];
      if (!/^[a-zA-Z][a-zA-Z\s'\-\.]*$/.test(w)) return;

      var rec = { id: 'imp-' + stamp + '-' + i, w: w, ph: '', pos: '', tr: '', ex: '', exCn: '' };
      var rest = p.slice(1);
      var k = 0;
      if (rest[0] && /^\/.+\/$/.test(rest[0])) { rec.ph = rest[0]; k = 1; }
      if (rest[k] && /^(n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|phr|aux)\./i.test(rest[k])) {
        rec.pos = rest[k]; k++;
      }
      if (!rest[k]) return;
      rec.tr = rest[k]; k++;
      if (rest[k]) { rec.ex = rest[k]; k++; }
      if (rest[k]) { rec.exCn = rest[k]; }
      if (!rec.tr) return;
      out.push(rec);
    });
    return out;
  }

  // 恢复前的备份校验：结构合法返回统计，否则返回错误原因字符串
  function validateBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '不是有效的备份 JSON';
    if (!data.books || typeof data.books !== 'object' || Array.isArray(data.books)) return '缺少词书进度数据（books 字段）';
    var bookN = 0, wordN = 0;
    Object.keys(data.books).forEach(function (id) {
      var b = data.books[id];
      if (!b || typeof b !== 'object' || Array.isArray(b)) return;
      bookN++;
      wordN += Object.keys(b).length;
    });
    if (!bookN) return '备份里没有任何词书进度';
    var dayN = data.log && typeof data.log === 'object' && !Array.isArray(data.log) ? Object.keys(data.log).length : 0;
    return { bookN: bookN, wordN: wordN, dayN: dayN };
  }

  // 汇总最近 N 天的日志（含今天）
  function logWindow(days) {
    var log = WL.store.getLog();
    var out = { nw: 0, rv: 0, ok: 0, bad: 0, pr: 0, ms: 0 };
    var d = new Date();
    for (var i = 0; i < days; i++) {
      var k = WL.store.todayKey(d);
      var rec = log[k];
      if (rec) {
        out.nw += rec.nw || 0;
        out.rv += rec.rv || 0;
        out.ok += rec.ok || 0;
        out.bad += rec.bad || 0;
        out.pr += rec.pr || 0;
        out.ms += rec.ms || 0;
      }
      d.setDate(d.getDate() - 1);
    }
    return out;
  }

  function accPct(ok, bad) {
    var t = ok + bad;
    return t ? Math.round(ok / t * 100) + '%' : '—';
  }

  // 导出 Markdown 学习报告：按当前词书生成，时间段统计为全部词书合计
  function exportReport() {
    var book = curBook();
    if (!book) { toast('先选择词表'); return; }
    var prog = WL.store.getProgress(book.id);
    var now = Date.now();
    var chs = activeChannels();
    var total = book.words.length;
    var learned = 0, cutN = 0;
    var buckets = { learning: 0, familiar: 0, mastered: 0, risk: 0 };
    var riskList = [], lapseList = [];
    book.words.forEach(function (w) {
      var st = prog[w.id];
      if (!st) return;
      if (st.cut) { cutN++; return; }
      learned++;
      var hl = WL.srs.healthOf(st, now, chs);
      if (hl === 'risk') buckets.risk++;
      else if (hl === 'learning') buckets.learning++;
      else if (hl === 'familiar') buckets.familiar++;
      else buckets.mastered++;
      var minR = 1;
      chs.forEach(function (ch) {
        var c = st.ch[ch];
        if (!c || c.n === 0) return;
        var r = WL.srs.retrievability(c.s, c.last, now);
        if (r < minR) minR = r;
      });
      if (minR < 0.75) riskList.push({ w: w.w, tr: w.tr, r: minR });
      if (st.lapses >= 3) lapseList.push({ w: w.w, tr: w.tr, n: st.lapses });
    });
    riskList.sort(function (a, b) { return a.r - b.r; });
    lapseList.sort(function (a, b) { return b.n - a.n; });

    var t1 = logWindow(1), w7 = logWindow(7), w30 = logWindow(30);
    var fc = WL.srs.forecast(prog, now, 30, chs, WL.srs.simulateNewLearn(
      book.words.filter(function (w) { return !prog[w.id]; }),
      now, 30, WL.store.getConfig().newLimit));
    var sum = fc.reduce(function (a, b) { return a + b; }, 0);
    var week = fc.slice(0, 7).reduce(function (a, b) { return a + b; }, 0);
    var un = total - learned - cutN;

    var L = [];
    L.push('# Lexilume 学习报告');
    L.push('');
    L.push('- 词书：' + book.name + '（' + total + ' 词）');
    L.push('- 生成时间：' + new Date().toLocaleString('zh-CN', { hour12: false }));
    L.push('- 连续学习天数：' + WL.store.streakDays() + ' 天；累计有记录天数：' + Object.keys(WL.store.getLog()).length + ' 天');
    L.push('');
    L.push('## 词汇状态');
    L.push('- 已学 ' + learned + '（学习中 ' + buckets.learning + ' · 熟悉 ' + buckets.familiar +
      ' · 已掌握 ' + buckets.mastered + ' · 遗忘风险 ' + buckets.risk + '）');
    L.push('- 已斩 ' + cutN + '；未学 ' + un);
    L.push('');
    L.push('## 时间段统计（全部词书合计，含练习）');
    L.push('');
    L.push('| 指标 | 今日 | 近 7 天 | 近 30 天 |');
    L.push('|---|---|---|---|');
    L.push('| 新学 | ' + t1.nw + ' | ' + w7.nw + ' | ' + w30.nw + ' |');
    L.push('| 复习 | ' + t1.rv + ' | ' + w7.rv + ' | ' + w30.rv + ' |');
    L.push('| 正确率 | ' + accPct(t1.ok, t1.bad) + ' | ' + accPct(w7.ok, w7.bad) + ' | ' + accPct(w30.ok, w30.bad) + ' |');
    L.push('| 练习题数 | ' + t1.pr + ' | ' + w7.pr + ' | ' + w30.pr + ' |');
    L.push('| 学习时长 | ' + Math.round(t1.ms / 60000) + ' 分 | ' + Math.round(w7.ms / 60000) + ' 分 | ' + Math.round(w30.ms / 60000) + ' 分 |');
    L.push('');
    L.push('## 未来 30 天复习量（含继续新学的模拟）');
    L.push('- 明天：' + (fc[1] || 0) + ' 张；7 天内：' + week + ' 张；30 天合计：' + sum + ' 张（日均 ' + Math.round(sum / 30) + ' 张）');
    L.push('');
    L.push('## 遗忘风险 TOP' + Math.min(10, riskList.length));
    if (riskList.length) {
      riskList.slice(0, 10).forEach(function (x) {
        L.push('- ' + x.w + ' — ' + x.tr + '（保留率 ' + Math.round(x.r * 100) + '%）');
      });
    } else {
      L.push('- 无');
    }
    L.push('');
    L.push('## 错词本 TOP' + Math.min(10, lapseList.length));
    if (lapseList.length) {
      lapseList.slice(0, 10).forEach(function (x) {
        L.push('- ' + x.w + ' — ' + x.tr + '（错 ' + x.n + ' 次）');
      });
    } else {
      L.push('- 无');
    }
    L.push('');

    var blob = new Blob([L.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Lexilume学习报告-' + book.name + '-' + WL.store.todayKey() + '.md';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('报告已导出');
  }

  function exportBackup() {
    var data = WL.store.exportAll();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    var d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = 'Lexilume备份-' + WL.store.todayKey() + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('已导出');
  }

  /* ============ 统计 ============ */

  function viewStats() {
    var book = curBook();
    var wrap = el('div', 'stack');
    if (!book) return wrap;

    var top = el('div', 'spread');
    top.appendChild(el('h2', 'section', '统计'));
    var rep = el('button', 'btn', '导出学习报告');
    rep.onclick = exportReport;
    top.appendChild(rep);
    wrap.appendChild(top);

    var prog = WL.store.getProgress(book.id);
    var now = Date.now();
    var chs = activeChannels();
    var total = book.words.length;
    var learned = 0, newN = 0, cutN = 0;
    var buckets = { learning: 0, familiar: 0, mastered: 0, risk: 0 };
    var riskList = [];
    var lapseList = [];
    var cutList = [];

    book.words.forEach(function (w) {
      var st = prog[w.id];
      if (!st) { newN++; return; }
      if (st.cut) { cutN++; cutList.push({ w: w, at: st.cut }); return; }
      learned++;
      var hl = WL.srs.healthOf(st, now, chs);
      if (hl === 'risk') { buckets.risk++; }
      else if (hl === 'learning') buckets.learning++;
      else if (hl === 'familiar') buckets.familiar++;
      else buckets.mastered++;

      var minR = 1;
      chs.forEach(function (ch) {
        var c = st.ch[ch];
        if (!c || c.n === 0) return;
        var r = WL.srs.retrievability(c.s, c.last, now);
        if (r < minR) minR = r;
      });
      if (minR < 0.75) riskList.push({ w: w, r: minR });
      if (st.lapses >= 3) lapseList.push({ w: w, n: st.lapses });
    });

    riskList.sort(function (a, b) { return a.r - b.r; });
    lapseList.sort(function (a, b) { return b.n - a.n; });

    var c1 = el('div', 'card');
    c1.appendChild(el('h2', 'section', '掌握分布'));
    var segs = [
      ['未学', newN, '#D2CDBF'],
      ['学习中', buckets.learning, '#8FB3A4'],
      ['熟悉', buckets.familiar, '#5C8A76'],
      ['已掌握', buckets.mastered, '#2E5C4E'],
      ['遗忘风险', buckets.risk, '#A4473C'],
      ['已斩', cutN, '#AEB4BF']
    ];
    var barWrap = el('div');
    barWrap.style.cssText = 'display:flex;height:12px;border-radius:3px;overflow:hidden;background:#EDEAE2';
    segs.forEach(function (sg) {
      if (!sg[1] || !total) return;
      var d = el('div');
      d.style.cssText = 'width:' + (sg[1] / total * 100) + '%;background:' + sg[2];
      barWrap.appendChild(d);
    });
    c1.appendChild(barWrap);

    var lg = el('div', 'legend');
    lg.style.marginTop = '12px';
    segs.forEach(function (sg) {
      lg.appendChild(h('<span><i style="background:' + sg[2] + '"></i>' + sg[0] + ' ' + sg[1] + '</span>'));
    });
    c1.appendChild(lg);
    wrap.appendChild(c1);

    var c2 = el('div', 'card');
    c2.appendChild(el('h2', 'section', '未来 30 天复习量'));
    var cfgF = WL.store.getConfig();
    var freshWords = book.words.filter(function (w) { return !prog[w.id]; });
    var extraDues = WL.srs.simulateNewLearn(freshWords, now, 30, cfgF.newLimit);
    var fc = WL.srs.forecast(prog, now, 30, chs, extraDues);
    var maxV = Math.max.apply(null, fc.concat([1]));
    var bars = el('div', 'bars');
    fc.forEach(function (v, i) {
      var d = el('div');
      d.style.height = Math.max(3, Math.sqrt(v / maxV) * 92) + 'px';
      d.title = '第 ' + i + ' 天 · ' + v + ' 张';
      bars.appendChild(d);
    });
    c2.appendChild(bars);
    var axis = el('div', 'bar-axis');
    axis.appendChild(el('span', null, '今天'));
    axis.appendChild(el('span', null, '15 天'));
    axis.appendChild(el('span', null, '30 天'));
    c2.appendChild(axis);
    var tomorrow = fc[1] || 0;
    c2.appendChild(h('<div class="small muted" style="margin-top:10px">明天预计 ' + tomorrow + ' 张，日均 ' +
      Math.round(fc.reduce(function (a, b) { return a + b; }, 0) / 30) + ' 张</div>'));
    c2.appendChild(h('<div class="small muted" style="margin-top:6px">已含假设：从明天起每天继续新学 ' + cfgF.newLimit + ' 个；实际随你的作答浮动。</div>'));
    wrap.appendChild(c2);

    var c3 = el('div', 'card');
    c3.appendChild(el('h2', 'section', '打卡记录'));
    c3.appendChild(heatmap());
    wrap.appendChild(c3);

    var c4 = el('div', 'card');
    c4.appendChild(el('h2', 'section', '遗忘风险'));
    if (!riskList.length) {
      c4.appendChild(h('<div class="small muted">暂时没有高风险词</div>'));
    } else {
      var wl = el('div', 'wronglist');
      riskList.slice(0, 12).forEach(function (x) {
        var row = el('div', 'wrongitem');
        row.appendChild(el('span', 'w', x.w.w));
        row.appendChild(el('span', 't', x.w.tr));
        row.appendChild(el('span', 'n', 'R ' + Math.round(x.r * 100) + '%'));
        wl.appendChild(row);
      });
      c4.appendChild(wl);
    }
    wrap.appendChild(c4);

    var c5 = el('div', 'card');
    c5.appendChild(el('h2', 'section', '错词本'));
    if (!lapseList.length) {
      c5.appendChild(h('<div class="small muted">还没有反复出错的词</div>'));
    } else {
      var wl2 = el('div', 'wronglist');
      lapseList.slice(0, 20).forEach(function (x) {
        var row = el('div', 'wrongitem');
        row.appendChild(el('span', 'w', x.w.w));
        row.appendChild(el('span', 't', x.w.tr));
        row.appendChild(el('span', 'n', '错 ' + x.n + ' 次'));
        wl2.appendChild(row);
      });
      c5.appendChild(wl2);
    }
    wrap.appendChild(c5);

    var c6 = el('div', 'card');
    c6.appendChild(el('h2', 'section', '已斩'));
    if (!cutList.length) {
      c6.appendChild(h('<div class="small muted">暂无已斩的词。</div>'));
    } else {
      var cl = el('div', 'wronglist');
      cutList.slice(0, 30).forEach(function (x) {
        var row = el('div', 'wrongitem');
        row.appendChild(el('span', 'w', x.w.w));
        row.appendChild(el('span', 't', x.w.tr));
        var btn = el('button', 'btn', '恢复');
        btn.style.cssText = 'padding:6px 14px;margin-left:auto;flex:none';
        btn.onclick = function () { restoreCut(book.id, x.w.id, x.w.w); };
        row.appendChild(btn);
        cl.appendChild(row);
      });
      c6.appendChild(cl);
      if (cutList.length > 30) {
        c6.appendChild(h('<div class="small muted" style="margin-top:8px">共 ' + cutList.length + ' 个，仅显示前 30 个</div>'));
      }
    }
    wrap.appendChild(c6);

    return wrap;
  }

  // 恢复已斩的词：学过历史的继续原调度；从未学过的删掉状态回到新词池
  function restoreCut(bookId, wid, wordText) {
    var prog = WL.store.getProgress(bookId);
    var st = prog[wid];
    if (!st) return;
    var attempts = (st.ch && st.ch.r ? st.ch.r.n : 0) + (st.ch && st.ch.p ? st.ch.p.n : 0);
    if (!attempts) {
      delete prog[wid];
    } else {
      delete st.cut;
    }
    WL.store.flush();
    if (WL.sync) WL.sync.markDirty();
    toast('已恢复「' + wordText + '」');
    render();
  }

  function heatmap() {
    var log = WL.store.getLog();
    var WEEKS = 24;
    var CELLS = WEEKS * 7;
    var today = new Date();
    var dow = today.getDay();
    var start = new Date(today);
    start.setDate(today.getDate() - dow - (WEEKS - 1) * 7);
    start.setHours(0, 0, 0, 0);

    var grid = el('div', 'heat');
    var maxV = 1;
    var activeDays = 0;
    for (var i = 0; i < CELLS; i++) {
      var d = new Date(start);
      d.setDate(start.getDate() + i);
      var k = WL.store.todayKey(d);
      var rec = log[k];
      var v = rec ? (rec.nw + rec.rv + (rec.pr || 0)) : 0;
      if (v > 0) activeDays++;
      if (v > maxV) maxV = v;
    }
    for (var j = 0; j < CELLS; j++) {
      var d2 = new Date(start);
      d2.setDate(start.getDate() + j);
      var k2 = WL.store.todayKey(d2);
      var rec2 = log[k2];
      var v2 = rec2 ? (rec2.nw + rec2.rv + (rec2.pr || 0)) : 0;
      var cell = el('i');
      if (v2 > 0) {
        var alpha = 0.22 + 0.78 * Math.min(1, v2 / maxV);
        cell.style.background = 'rgba(47, 110, 212, ' + alpha.toFixed(2) + ')';
        cell.style.boxShadow = 'none';
      }
      cell.title = k2 + (v2 ? ' · ' + v2 + ' 词' : ' · 未学');
      grid.appendChild(cell);
    }
    var box = el('div');
    box.appendChild(grid);
    var cap = el('div', 'small muted');
    cap.style.cssText = 'margin-top:12px;display:flex;justify-content:space-between';
    cap.appendChild(el('span', null, '近 ' + WEEKS + ' 周 · 学过的天数 ' + activeDays));
    cap.appendChild(el('span', null, '最深 ' + (maxV === 1 ? 0 : maxV) + ' 词/天'));
    box.appendChild(cap);
    return box;
  }

  /* ============ 设置 ============ */

  function syncCard() {
    var sy = WL.sync.state();
    var card = el('div', 'card');
    card.appendChild(el('h2', 'section', '跨设备同步'));

    var srow = el('div', 'spread');
    srow.style.padding = '0 0 14px';
    srow.appendChild(el('span', 'small', '状态'));
    var sv = el('span', 'small');
    sv.style.textAlign = 'right';
    if (!sy.configured) {
      sv.style.color = 'var(--ink-3)';
      sv.textContent = '未配置';
    } else if (sy.busy) {
      sv.style.color = 'var(--accent-deep)';
      sv.textContent = '同步中…';
    } else if (sy.lastError) {
      sv.style.color = 'var(--wrong)';
      sv.textContent = sy.lastError;
    } else {
      sv.style.color = 'var(--accent-deep)';
      sv.textContent = sy.lastSync
        ? '已连接 · ' + new Date(sy.lastSync).toLocaleString('zh-CN', { hour12: false })
        : '已连接';
      if (sy.pending) sv.textContent += ' · 有待上传的修改';
    }
    srow.appendChild(sv);
    card.appendChild(srow);

    var sizeRow = el('div', 'spread');
    sizeRow.style.padding = '0 0 14px';
    sizeRow.appendChild(el('span', 'small', '同步数据体积'));
    var sizeV = el('span', 'small');
    var kb = Math.round(WL.sync.payloadSize() / 1024);
    sizeV.textContent = '约 ' + kb + ' KB';
    if (kb > 800) {
      sizeV.style.color = 'var(--wrong)';
      sizeV.textContent += '（接近 GitHub 接口上限，需要把进度按词书拆分文件）';
    }
    sizeRow.appendChild(sizeV);
    card.appendChild(sizeRow);

    var fRepo = el('div', 'field');
    fRepo.appendChild(el('label', null, '仓库（用户名/仓库名）'));
    var iRepo = el('input');
    iRepo.type = 'text';
    iRepo.value = sy.owner + '/' + sy.repo;
    fRepo.appendChild(iRepo);
    card.appendChild(fRepo);

    var fTok = el('div', 'field');
    fTok.appendChild(el('label', null, '访问令牌'));
    var iTok = el('input');
    iTok.type = 'password';
    iTok.autocomplete = 'off';
    iTok.placeholder = sy.hasToken ? '已保存，留空则不修改' : 'github_pat_ 开头的那串';
    fTok.appendChild(iTok);
    card.appendChild(fTok);

    var row = el('div', 'row');
    var bSave = el('button', 'btn primary', '保存并同步');
    bSave.onclick = function () {
      var parts = iRepo.value.trim().split('/');
      if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
        toast('仓库要写成 用户名/仓库名');
        return;
      }
      var patch = {
        owner: parts[0].trim(),
        repo: parts[1].trim(),
        branch: WL.sync.get().branch || 'main',
        path: WL.sync.get().path || 'progress.json'
      };
      if (iTok.value.trim()) patch.token = iTok.value.trim();
      WL.sync.setConf(patch);
      bSave.disabled = true;
      bSave.textContent = '同步中…';
      WL.sync.run(false).then(function (r) {
        toast(r.ok ? '同步成功' : ('失败：' + r.msg));
        render();
      });
    };
    row.appendChild(bSave);

    var bNow = el('button', 'btn', '立即同步');
    bNow.onclick = function () {
      if (!WL.sync.configured()) { toast('先填令牌'); return; }
      bNow.disabled = true;
      WL.sync.run(false).then(function (r) {
        toast(r.ok ? '已同步' : ('失败：' + r.msg));
        render();
      });
    };
    row.appendChild(bNow);

    var bOff = el('button', 'btn ghost', '退出登录');
    bOff.onclick = function () {
      if (!confirm('退出后本机学习数据保留，但需要重新输入令牌才能继续使用。确定退出吗？')) return;
      lockOut('已退出登录');
    };
    row.appendChild(bOff);
    card.appendChild(row);

    card.appendChild(h('<div class="small muted" style="margin-top:16px;line-height:1.85">' +
      '同步时会把两边的记录按「每个词最后一次复习的时间」合并，取更晚的那份，' +
      '所以不会出现一边覆盖另一边。' +
      '答题之后会攒二十多秒再自动提交一次，不必每次手动点。<br>' +
      '「已同步」指 GitHub 上的文件已更新；其他设备在下次打开网站时会自动拉取到最新内容。<br>' +
      '两点边界：同一天两台设备的学习量按天取较大值合并（不相加）；' +
      '清空本机词书进度后，下次同步可能从远端把它合并回来（删除不会传播）。<br>' +
      '令牌只保存在本机浏览器，可以随时去 GitHub 撤销。' +
      '学习记录写在你选定的仓库里，如果仓库是公开的，这份 JSON 也会被公开读取。' +
      '</div>'));
    return card;
  }

  function viewSettings() {
    var cfg = WL.store.getConfig();
    var wrap = el('div', 'stack');

    // 存储状况放在最前，换设备或换地址时一眼能看出记录为什么不在
    var c0 = el('div', 'card');
    c0.appendChild(el('h2', 'section', '存储'));
    var avail = WL.store.available();
    var progAll = 0, bookN = 0;
    (WL.books || []).forEach(function (b) {
      var n = Object.keys(WL.store.getProgress(b.id)).length;
      progAll += n;
      if (n) bookN++;
    });
    var rows = [
      ['状态', avail ? '可用' : '不可用（记录不会保存）', avail ? 'var(--accent-deep)' : 'var(--wrong)'],
      ['已学词条', progAll + ' 条，分布在 ' + bookN + ' 份词表', 'var(--ink-2)'],
      ['有记录的天数', Object.keys(WL.store.getLog()).length + ' 天', 'var(--ink-2)'],
      ['本机占用（浏览器存储）', (WL.store.usage() / 1024).toFixed(1) + ' KB', 'var(--ink-2)']
    ];
    rows.forEach(function (r) {
      var row = el('div', 'spread');
      row.style.padding = '10px 2px';
      row.appendChild(el('span', 'small', r[0]));
      var v = el('span', 'small');
      v.style.color = r[2];
      v.style.wordBreak = 'break-all';
      v.style.textAlign = 'right';
      v.textContent = r[1];
      row.appendChild(v);
      c0.appendChild(row);
    });
    c0.appendChild(h('<div class="small muted" style="margin-top:12px;line-height:1.8">' +
      '数据按「打开方式」分开存放。换一个地址打开就是另一份空记录，' +
      '比如从预览窗口换到双击 index.html，数据不会自动跟过去。' +
      '搬家请用下面的导出与恢复，或者配置跨设备同步。</div>'));
    wrap.appendChild(c0);

    if (WL.sync) wrap.appendChild(syncCard());

    var c1 = el('div', 'card');
    c1.appendChild(el('h2', 'section', '每日配额'));

    var f1 = el('div', 'field');
    f1.appendChild(el('label', null, '每天新学词数'));
    var i1 = el('input'); i1.type = 'number'; i1.min = '5'; i1.max = '100'; i1.value = cfg.newLimit;
    i1.onchange = function () { WL.store.setConfig({ newLimit: Math.max(1, Math.min(100, +i1.value || 20)) }); toast('已保存'); };
    f1.appendChild(i1);
    c1.appendChild(f1);

    var f2 = el('div', 'field');
    f2.appendChild(el('label', null, '每天复习上限'));
    var i2 = el('input'); i2.type = 'number'; i2.min = '10'; i2.max = '300'; i2.value = cfg.reviewLimit;
    i2.onchange = function () { WL.store.setConfig({ reviewLimit: Math.max(5, Math.min(300, +i2.value || 60)) }); toast('已保存'); };
    f2.appendChild(i2);
    c1.appendChild(f2);

    c1.appendChild(h('<div class="small muted">复习上限到了不会丢词，没复习完的会在之后几天优先补上。</div>'));
    wrap.appendChild(c1);

    var c2 = el('div', 'card');
    c2.appendChild(el('h2', 'section', '训练题型'));

    // 基底题型：看词选义，始终启用
    var baseRow = el('div', 'spread');
    baseRow.style.padding = '11px 2px';
    var baseLeft = el('div');
    baseLeft.appendChild(el('div', null, '看词选义'));
    baseLeft.appendChild(el('div', 'small muted', '基础题型，始终启用'));
    baseRow.appendChild(baseLeft);
    var baseTag = el('div', 'small', '已启用');
    baseTag.style.color = 'var(--accent-deep)';
    baseTag.style.fontWeight = '600';
    baseRow.appendChild(baseTag);
    c2.appendChild(baseRow);

    // 可开关题型：目前只有看义选词，其余接口已留好
    var togglable = [['cn2en', '看义选词', '答对率会一同计入调度，建议开启']];
    togglable.forEach(function (t) {
      var row = el('div', 'spread');
      row.style.padding = '11px 2px';
      row.style.marginTop = '4px';
      var left = el('div');
      left.appendChild(el('div', null, t[1]));
      left.appendChild(el('div', 'small muted', t[2]));
      row.appendChild(left);
      var sw = el('div', 'sw');
      var isOn = (cfg.activeTypes || []).indexOf(t[0]) >= 0;
      sw.classList.toggle('on', isOn);
      sw.onclick = function () {
        var cur = (WL.store.getConfig().activeTypes || ['en2cn']).slice();
        var i = cur.indexOf(t[0]);
        if (i >= 0) { cur.splice(i, 1); }
        else { cur.push(t[0]); }
        if (cur.indexOf('en2cn') < 0) cur.unshift('en2cn');
        WL.store.setConfig({ activeTypes: cur });
        sw.classList.toggle('on', cur.indexOf(t[0]) >= 0);
        toast(cur.indexOf(t[0]) >= 0 ? '已启用「' + t[1] + '」' : '已关闭「' + t[1] + '」');
      };
      row.appendChild(sw);
      c2.appendChild(row);
    });

    var pendTypes = [
      ['听音辨义', '待补充'],
      ['拼写', '作为出题题型待补充；学习结束后的拼写环节已可用'],
      ['语境填词', '待补充']
    ];
    pendTypes.forEach(function (t) {
      var row = el('div', 'spread');
      row.style.padding = '11px 2px';
      row.style.opacity = '0.45';
      var left = el('div');
      left.appendChild(el('div', null, t[0]));
      left.appendChild(el('div', 'small muted', t[1]));
      row.appendChild(left);
      var tag = el('div', 'small', '—');
      tag.style.color = 'var(--ink-3)';
      row.appendChild(tag);
      c2.appendChild(row);
    });
    wrap.appendChild(c2);

    var c3 = el('div', 'card');
    c3.appendChild(el('h2', 'section', '设置'));
    var row2 = el('div', 'spread');
    row2.appendChild(el('span', null, '学习时自动朗读单词'));
    var sw = el('div', 'sw' + (cfg.sound ? ' on' : ''));
    sw.onclick = function () {
      var v = !WL.store.getConfig().sound;
      WL.store.setConfig({ sound: v });
      sw.classList.toggle('on', v);
      toast(v ? '已开启朗读' : '已关闭朗读');
    };
    row2.appendChild(sw);
    c3.appendChild(row2);

    var row3 = el('div', 'spread');
    row3.style.marginTop = '18px';
    row3.appendChild(el('span', null, '每个单元打乱新词顺序'));
    var sw2 = el('div', 'sw' + (cfg.shuffleNew ? ' on' : ''));
    sw2.onclick = function () {
      var v = !WL.store.getConfig().shuffleNew;
      WL.store.setConfig({ shuffleNew: v });
      sw2.classList.toggle('on', v);
    };
    row3.appendChild(sw2);
    c3.appendChild(row3);
    c3.appendChild(h('<div class="small muted" style="margin-top:14px">朗读使用系统语音合成，Edge 与 Chrome 自带，不需要下载音频。</div>'));
    wrap.appendChild(c3);

    var c4 = el('div', 'card');
    c4.appendChild(el('h2', 'section', '数据'));
    var b1 = el('button', 'btn block', '导出备份');
    b1.onclick = exportBackup;
    c4.appendChild(b1);

    var fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    fileInput.onchange = function () {
      var f = fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = JSON.parse(reader.result); } catch (e) { toast('恢复被拒绝：文件不是合法 JSON'); return; }
        var v = validateBackup(data);
        if (typeof v === 'string') { toast('恢复被拒绝：' + v); return; }
        if (!confirm('将恢复 ' + v.bookN + ' 本词书（' + v.wordN + ' 条进度）和 ' + v.dayN +
          ' 天记录，覆盖本机现有数据。建议先「导出备份」留底。确定继续吗？')) return;
        try {
          WL.store.importAll(data);
          mergeUserBooks();
          S.bookId = WL.store.getConfig().book;
          WL.app.render();
          toast('已恢复备份');
        } catch (e) {
          toast('恢复失败：' + (e.message || '未知原因'));
        }
      };
      reader.readAsText(f);
    };
    var b2 = el('button', 'btn block ghost', '从备份恢复');
    b2.onclick = function () { fileInput.click(); };
    b2.style.marginTop = '8px';
    c4.appendChild(b2);
    c4.appendChild(fileInput);

    var b3 = el('button', 'btn block ghost', '清空全部数据');
    b3.style.marginTop = '8px';
    b3.onclick = function () {
      if (!confirm('将删除本机所有词书进度、自建词书和记录。\n注意：删除不会传播——下次同步时进度可能从远端合并回来（自建词书需要重新导入）。确定吗？')) return;
      WL.store.resetAll();
      S.bookId = null;
      toast('已清空');
      render();
    };
    c4.appendChild(b3);
    wrap.appendChild(c4);

    var c5 = el('div', 'card');
    c5.appendChild(el('h2', 'section', '关于'));
    c5.appendChild(h(
      '<div class="small" style="color:#5E6470;line-height:1.9">' +
      '调度模型：每个词维护难度 D 与稳定度 S，保留率 R = 1/(1+t/9S)，按 90% 保留率反解下次复习时间。<br>' +
      '答错时稳定度缩水但不清零，避免难词被永久打回原点。<br>' +
      '流程：复习到期词 → 新学（看一张卡立刻测一个）→ 拼写环节（可跳过）。<br>' +
      '数据默认只存本机浏览器；配置跨设备同步后，学习进度会经 GitHub 仓库在设备间合并。' +
      '</div>'
    ));
    wrap.appendChild(c5);

    return wrap;
  }

  /* ============ 事件 ============ */

  document.addEventListener('keydown', function (e) {
    var s = S.session;
    if (!s) return;

    if (S.view === 'learn') {
      var lw = wordOf(s.learn[s.li]);
      if (!lw) return;
      if (e.key === ' ' && WL.store.getConfig().sound) {
        e.preventDefault();
        WL.quiz.speak(lw.w, true);
      }
      return;
    }
    if (S.view !== 'study') return;

    var cur = currentItem();
    if (!cur) return;

    if (e.key === 'Enter') {
      if (s.retryCard) { e.preventDefault(); leaveRetry(); return; }
      if (s.answered && !s.answered.ok) { e.preventDefault(); enterRetry(); return; }
      return;
    }
    if (s.retryCard) {
      if (e.key === ' ' && WL.store.getConfig().sound) {
        e.preventDefault();
        WL.quiz.speak(wordOf(cur.wid).w, true);
      }
      return;
    }
    if (s.answered) return;
    if (s.q && s.q.type === 'spell') return;
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4) {
      e.preventDefault();
      answer(n - 1);
    }
  });

  /* ============ 启动 ============ */

  // 把 localStorage 里持久化的自建词书并入 WL.books（boot 与恢复备份后都会调用）
  function mergeUserBooks() {
    WL.store.getUserBooks().forEach(function (b) {
      var exists = (WL.books || []).some(function (x) { return x.id === b.id; });
      if (!exists) WL.books.push(b);
    });
  }

  function boot() {
    var cfg = WL.store.getConfig();
    mergeUserBooks();
    var books = WL.books || [];
    var ok = false;
    for (var i = 0; i < books.length; i++) {
      if (books[i].id === cfg.book) { ok = true; break; }
    }
    if (!ok && books.length) {
      WL.store.setConfig({ book: books[0].id });
    }
    S.bookId = WL.store.getConfig().book;

    // 登录门：未登录（或令牌未通过校验）只能停在锁屏
    if (!loggedIn()) {
      S.view = 'lock';
      render();
      return;
    }

    // 断点续学：有未完成会话快照时先询问
    var saved = WL.store.getSession();
    if (saved && saved._v === 1 && saved.phase && saved.phase !== 'done' && !saved.ended) {
      S.session = saved;
      S.view = 'resume';
      render();
      return;
    }
    render();
    WL.sync.run(true).then(function (r) {
      if (!r.ok) {
        // 令牌被撤销/过期时锁回登录页；纯网络问题不锁，离线也能继续学
        if (/token 无效|没有权限/.test(r.msg)) {
          lockOut('登录已失效，请重新登录');
          return;
        }
        render();
        return;
      }
      render();
    });
  }

  // 切走页面前把没提交的改动推上去；有未完成会话时轻提示
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && WL.sync && WL.sync.configured()) {
      WL.sync.flushNow();
    }
  });

  window.addEventListener('beforeunload', function (e) {
    var s = S.session;
    if (s && !s.ended && loggedIn()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  WL.app = { boot: boot, startSession: startSession, render: render, state: S };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.WL);
