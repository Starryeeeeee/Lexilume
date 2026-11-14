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

  function startSession() {
    var cfg = WL.store.getConfig();
    var book = curBook();
    if (!book) return;
    var prog = WL.store.getProgress(book.id);
    var now = Date.now();
    var chs = activeChannels();

    var due = [];
    book.words.forEach(function (w) {
      var st = prog[w.id];
      if (st && WL.srs.dueNow(st, now, chs)) {
        due.push({ w: w, st: st });
      }
    });
    due.sort(function (a, b) {
      return WL.srs.overdueDays(b.st, now, chs) - WL.srs.overdueDays(a.st, now, chs);
    });
    due = due.slice(0, cfg.reviewLimit);

    var fresh = book.words.filter(function (w) { return !prog[w.id]; });
    if (cfg.shuffleNew) fresh = WL.quiz.shuffle(fresh);
    fresh = fresh.slice(0, cfg.newLimit);

    var items = [];
    due.forEach(function (x) {
      items.push({ wid: x.w.id, from: 'review', stage: 'test', retry: 0 });
    });
    fresh.forEach(function (w) {
      items.push({ wid: w.id, from: 'new', stage: 'show', retry: 0 });
    });

    if (!items.length) {
      toast('当前没有要学的内容，可以先导入词表');
      return;
    }

    S.session = {
      items: items,
      i: 0,
      total: items.length,
      bookId: book.id,
      t0: now,
      q: null,
      answered: null,
      newDone: {},
      revDone: {},
      spokenFor: -1,
      right: 0,
      wrong: 0
    };
    S.view = 'study';
    S.flash = null;
    prepare();
    render();
  }

  function currentItem() {
    var s = S.session;
    if (!s || s.i >= s.items.length) return null;
    return s.items[s.i];
  }

  function prepare() {
    var s = S.session;
    var cur = currentItem();
    if (!cur) { s.q = null; return; }
    var word = wordOf(cur.wid);
    if (!word) { s.q = null; return; }

    if (cur.stage === 'show') { s.q = null; return; }

    var cfg = WL.store.getConfig();
    var prog = WL.store.getProgress(s.bookId);
    var st = prog[cur.wid];
    var now = Date.now();
    var channel = 'r';

    if (cur.from === 'review' && st) {
      channel = WL.srs.weakestChannel(st, now, activeChannels());
      if (activeChannels().indexOf(channel) < 0) channel = 'r';
    }
    var type = WL.quiz.chooseType(word, channel, cfg.activeTypes);
    var q = WL.quiz.build(word, type, curBook().words);
    if (!q) {
      q = WL.quiz.build(word, 'en2cn', curBook().words);
    }
    s.q = q;
    s.answered = null;

    if (type === 'audio2cn') {
      WL.quiz.speak(word.w, cfg.sound);
    }
  }

  function answer(idx) {
    var s = S.session;
    if (!s || s.answered) return;
    var q = s.q;
    if (!q) return;
    var picked = q.options[idx];
    var ok = !!picked.ok;
    s.answered = { idx: idx, ok: ok };
    grade(ok);
    render();
    if (ok) {
      setTimeout(function () {
        if (S.session === s && s.answered && s.answered.ok) advance();
      }, 620);
    }
  }

  function answerSpell(value) {
    var s = S.session;
    if (!s || s.answered || !s.q) return;
    var ok = WL.quiz.normalize(value) === WL.quiz.normalize(s.q.answer);
    s.answered = { idx: -1, ok: ok };
    grade(ok);
    render();
    if (ok) {
      setTimeout(function () {
        if (S.session === s && s.answered && s.answered.ok) advance();
      }, 620);
    }
  }

  function grade(ok) {
    var s = S.session;
    var cur = currentItem();
    if (!cur) return;
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
      if (cur.retry === 0) {
        if (cur.from === 'new' && !s.newDone[cur.wid]) { s.newDone[cur.wid] = 1; WL.store.bumpLog('nw'); }
        if (cur.from === 'review' && !s.revDone[cur.wid]) { s.revDone[cur.wid] = 1; WL.store.bumpLog('rv'); }
      }
    } else {
      s.wrong++;
      WL.store.bumpLog('bad');
    }
    WL.store.flush();
  }

  function advance() {
    var s = S.session;
    if (!s) return;
    var cur = currentItem();
    if (!cur) return;

    var wasWrong = s.answered && !s.answered.ok;

    if (wasWrong && cur.retry < 2) {
      var copy = { wid: cur.wid, from: cur.from, stage: 'show', retry: cur.retry + 1 };
      var at = Math.min(s.items.length, s.i + 2);
      s.items.splice(at, 0, copy);
    }

    s.i++;
    s.answered = null;
    s.q = null;
    S.flash = null;

    if (s.i >= s.items.length) {
      WL.store.bumpLog('ms', Date.now() - s.t0);
      render();
      return;
    }
    prepare();
    render();
  }

  /* ============ 视图 ============ */

  function render() {
    var app = document.getElementById('app');
    app.innerHTML = '';
    app.appendChild(topbar());

    var body;
    if (S.view === 'study') body = viewStudy();
    else if (S.view === 'books') body = viewBooks();
    else if (S.view === 'stats') body = viewStats();
    else if (S.view === 'settings') body = viewSettings();
    else body = viewHome();

    app.appendChild(body);

    if (S.toast) {
      var t = el('div', 'toast', S.toast);
      t.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#1E1C19;color:#fff;padding:9px 16px;border-radius:6px;font-size:13px;z-index:99';
      app.appendChild(t);
    }
  }

  function topbar() {
    var bar = el('div', 'topbar');
    var brand = h('<div class="brand">词<span>律</span></div>');
    bar.appendChild(brand);

    var tabs = el('nav', 'tabs');
    var defs = [
      ['home', '学习'],
      ['books', '词表'],
      ['stats', '统计'],
      ['settings', '设置']
    ];
    defs.forEach(function (d) {
      var b = el('button', 'tab' + (S.view === d[0] || (d[0] === 'home' && S.view === 'study') ? ' on' : ''), d[1]);
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
      if (st) { learned++; if (WL.srs.dueNow(st, now, chs)) dueN++; }
    });

    var today = WL.store.getToday();
    var streak = WL.store.streakDays();

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
    var nextNew = Math.min(cfg.newLimit, total - learned);
    startCard.appendChild(h(
      '<div class="spread" style="margin-bottom:14px">' +
      '<div><div style="font-size:16px">今天的学习</div>' +
      '<div class="small muted">复习 ' + Math.min(dueN, cfg.reviewLimit) + ' 个 · 新学 ' + nextNew + ' 个</div></div>' +
      '<div class="small muted">上限 新' + cfg.newLimit + ' / 复' + cfg.reviewLimit + '</div>' +
      '</div>'
    ));

    var go = el('button', 'btn primary block lg', dueN + nextNew > 0 ? '开始' : '没有待学内容');
    go.disabled = dueN + nextNew === 0;
    go.onclick = startSession;
    startCard.appendChild(go);
    wrap.appendChild(startCard);

    if (today.ok + today.bad > 0) {
      var c = el('div', 'card');
      c.appendChild(el('h2', 'section', '今日正确率'));
      var rate = Math.round(today.ok / (today.ok + today.bad) * 100);
      c.appendChild(h('<div style="font-size:26px;font-variant-numeric:tabular-nums">' + rate + '%</div>'));
      c.appendChild(h('<div class="small muted">答对 ' + today.ok + ' · 答错 ' + today.bad + '</div>'));
      wrap.appendChild(c);
    }

    return wrap;
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
    var top = el('div', 'study-top');
    var left = el('div');
    var kind = cur.from === 'new' ? '新学' : '复习';
    left.textContent = kind + ' · 第 ' + (doneN + 1) + ' / ' + total + ' 项';
    top.appendChild(left);
    var rightTxt = el('div');
    rightTxt.textContent = '对 ' + s.right + ' · 错 ' + s.wrong;
    top.appendChild(rightTxt);
    wrap.appendChild(top);

    var bar = el('div', 'bar');
    bar.style.marginBottom = '14px';
    var fill = el('i');
    fill.style.width = (doneN / total * 100).toFixed(1) + '%';
    bar.appendChild(fill);
    wrap.appendChild(bar);

    if (cur.stage === 'show') {
      wrap.appendChild(learnCard(word));
    } else {
      wrap.appendChild(questionCard(word, cur));
    }
    return wrap;
  }

  function learnCard(word) {
    var cfg = WL.store.getConfig();
    var card = el('div', 'qcard learn-body');
    var w = el('div', 'learn-word', word.w);
    card.appendChild(w);

    var phRow = el('div', 'learn-ph');
    if (word.ph) phRow.textContent = word.ph;
    if (cfg.sound) {
      var sp = el('button', 'speak');
      sp.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
      sp.onclick = function (e) { e.stopPropagation(); WL.quiz.speak(word.w, true); };
      phRow.appendChild(sp);
    }
    card.appendChild(phRow);

    var def = el('div', 'learn-def');
    def.appendChild(h('<div><span class="pos">' + (word.pos || '') + '</span>' + word.tr + '</div>'));
    if (word.ex) {
      def.appendChild(h('<div class="learn-ex">' + word.ex + '</div>'));
      if (word.exCn) def.appendChild(h('<div class="learn-ex-cn">' + word.exCn + '</div>'));
    }
    card.appendChild(def);

    var btn = el('button', 'btn primary block lg', '记住了，测一下');
    btn.style.marginTop = '24px';
    btn.onclick = function () {
      var cur = currentItem();
      if (!cur) return;
      var s = S.session;
      var prog = WL.store.getProgress(s.bookId);
      if (!prog[cur.wid]) {
        var st = WL.srs.newState(word, Date.now());
        st.seen = 0;
        WL.store.putProgress(s.bookId, cur.wid, st);
        WL.store.flush();
      }
      cur.stage = 'test';
      prepare();
      render();
    };
    card.appendChild(btn);

    if (WL.quiz.speak && cfg.sound && S.session.spokenFor !== S.session.i) {
      S.session.spokenFor = S.session.i;
      WL.quiz.speak(word.w, true);
    }
    return card;
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

    if (q.sub) {
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
      if (q.hint) card.appendChild(el('div', 'qhint', q.hint));
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
      card.appendChild(feedbackBar(word, q));
      return card;
    }

    var opts = el('div', 'options');
    q.options.forEach(function (o, i) {
      var b = el('button', 'opt');
      b.appendChild(el('span', 'key', String(i + 1)));
      b.appendChild(el('span', 'txt', o.text));

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

    card.appendChild(feedbackBar(word, q));
    return card;
  }

  function feedbackBar(word) {
    var s = S.session;
    if (!s.answered) {
      var hintRow = el('div');
      hintRow.style.cssText = 'margin-top:16px;font-size:12px;color:#948F83;text-align:center';
      hintRow.textContent = '按数字键选择，回车继续';
      return hintRow;
    }
    var f = el('div', 'feedback ' + (s.answered.ok ? 'right' : 'wrong'));
    var txt = el('div');
    if (s.answered.ok) {
      txt.textContent = '答对了';
    } else {
      txt.innerHTML = '正确答案：<b>' + (s.q ? s.q.answer : '') + '</b>';
    }
    f.appendChild(txt);

    var btn = el('button', 'btn ghost');
    btn.style.cssText = 'color:inherit;border-color:currentColor;padding:5px 12px;font-size:13px';
    btn.textContent = '继续 →';
    btn.onclick = advance;
    f.appendChild(btn);
    return f;
  }

  function viewDone() {
    var s = S.session;
    var wrap = el('div', 'stack');
    var card = el('div', 'card');
    card.style.textAlign = 'center';
    var mins = Math.max(1, Math.round((Date.now() - s.t0) / 60000));
    var totalDone = s.right + s.wrong;
    card.appendChild(h('<div style="font-size:20px;margin-bottom:6px">今天这一轮完成了</div>'));
    card.appendChild(h('<div class="muted small">用时约 ' + mins + ' 分钟</div>'));
    card.appendChild(h(
      '<div class="overview" style="margin-top:20px;text-align:left">' +
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

    var back = el('button', 'btn ghost block', '回到首页');
    back.style.marginTop = '8px';
    back.onclick = function () { S.view = 'home'; S.session = null; render(); };
    card.appendChild(back);

    wrap.appendChild(card);
    return wrap;
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
    });
    card.appendChild(list);
    wrap.appendChild(card);

    var imp = el('div', 'card');
    imp.appendChild(el('h2', 'section', '导入词表'));

    var hint = el('div', 'small muted');
    hint.style.marginBottom = '10px';
    hint.innerHTML = '每行一个词，用逗号或制表符分隔：<br>' +
      '<code class="small">word, 音标, 词性, 释义, 例句, 例句翻译</code><br>' +
      '后四项可以留空，只写 <code>word, 释义</code> 也可以。';
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
      if (bookName) {
        var id = 'u' + Date.now().toString(36);
        var nb = { id: id, name: bookName, note: '自建词表 · ' + rows.length + ' 词', words: rows };
        WL.books.push(nb);
        bookCache[id] = null;
        WL.store.setConfig({ book: id });
        S.bookId = id;
        toast('已新建「' + bookName + '」，共 ' + rows.length + ' 词');
      } else if (target) {
        var start = target.words.length;
        var prefix = target.id + '-' + Date.now().toString(36) + '-';
        rows.forEach(function (r, i) { r.id = prefix + i; target.words.push(r); });
        target.byId = null;
        bookCache[target.id] = null;
        toast('已追加 ' + rows.length + ' 词到「' + target.name + '」');
      }
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

    var bk = el('div', 'card');
    bk.appendChild(el('h2', 'section', '数据'));
    var b1 = el('button', 'btn block', '导出备份（JSON）');
    b1.onclick = exportBackup;
    bk.appendChild(b1);
    var b2 = el('button', 'btn block ghost', '清空当前词表进度');
    b2.style.marginTop = '8px';
    b2.onclick = function () {
      if (!confirm('确定清空「' + curBook().name + '」的学习记录？此操作不可撤销。')) return;
      WL.store.resetBook(curBook().id);
      toast('已清空');
    };
    bk.appendChild(b2);
    wrap.appendChild(bk);

    return wrap;
  }

  function parseRows(text) {
    var lines = text.split(/\r?\n/);
    var out = [];
    var stamp = Date.now().toString(36);
    lines.forEach(function (line, i) {
      line = line.trim();
      if (!line || /^#/.test(line)) return;
      var sep = line.indexOf('\t') >= 0 ? '\t' : ',';
      var p = line.split(sep).map(function (s) { return s.trim(); });
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

  function exportBackup() {
    var data = WL.store.exportAll();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    var d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = '词律备份-' + WL.store.todayKey() + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('已导出');
  }

  /* ============ 统计 ============ */

  function viewStats() {
    var book = curBook();
    var wrap = el('div', 'stack');
    if (!book) return wrap;

    var prog = WL.store.getProgress(book.id);
    var now = Date.now();
    var chs = activeChannels();
    var total = book.words.length;
    var learned = 0, newN = 0;
    var buckets = { learning: 0, familiar: 0, mastered: 0, risk: 0 };
    var riskList = [];
    var lapseList = [];

    book.words.forEach(function (w) {
      var st = prog[w.id];
      if (!st) { newN++; return; }
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
      ['遗忘风险', buckets.risk, '#A4473C']
    ];
    var barWrap = el('div');
    barWrap.style.cssText = 'display:flex;height:12px;border-radius:3px;overflow:hidden;background:#EDEAE2';
    segs.forEach(function (sg) {
      if (!sg[1]) return;
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
    var fc = WL.srs.forecast(prog, now, 30, chs);
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

    return wrap;
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
      var v = rec ? (rec.nw + rec.rv) : 0;
      if (v > 0) activeDays++;
      if (v > maxV) maxV = v;
    }
    for (var j = 0; j < CELLS; j++) {
      var d2 = new Date(start);
      d2.setDate(start.getDate() + j);
      var k2 = WL.store.todayKey(d2);
      var rec2 = log[k2];
      var v2 = rec2 ? (rec2.nw + rec2.rv) : 0;
      var cell = el('i');
      if (v2 > 0) {
        var alpha = 0.22 + 0.78 * Math.min(1, v2 / maxV);
        cell.style.background = 'rgba(46, 92, 78, ' + alpha.toFixed(2) + ')';
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

  function viewSettings() {
    var cfg = WL.store.getConfig();
    var wrap = el('div', 'stack');

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
    var types = [
      ['en2cn', '看词选义', true],
      ['cn2en', '看义选词', false],
      ['audio2cn', '听音辨义', false],
      ['spell', '拼写', false],
      ['cloze', '语境填词', false]
    ];
    types.forEach(function (t) {
      var row = el('div', 'spread');
      row.style.padding = '11px 2px';
      if (!t[2]) row.style.opacity = '0.45';
      var left = el('div');
      left.appendChild(el('div', null, t[1]));
      if (!t[2]) {
        var sub = el('div', 'small muted', '待补充');
        left.appendChild(sub);
      }
      row.appendChild(left);
      var tag = el('div', 'small');
      tag.style.color = t[2] ? 'var(--accent-deep)' : 'var(--ink-3)';
      tag.style.fontWeight = t[2] ? '600' : '400';
      tag.textContent = t[2] ? '已启用' : '—';
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
        try {
          WL.store.importAll(JSON.parse(reader.result));
          toast('已恢复备份');
        } catch (e) {
          toast('文件无法识别');
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
      if (!confirm('将删除所有词表进度和记录，确定吗？')) return;
      WL.store.resetAll();
      toast('已清空');
    };
    c4.appendChild(b3);

    var kb = (WL.store.usage() / 1024).toFixed(0);
    c4.appendChild(h('<div class="small muted" style="margin-top:12px">当前占用 ' + kb + ' KB</div>'));
    wrap.appendChild(c4);

    var c5 = el('div', 'card');
    c5.appendChild(el('h2', 'section', '关于'));
    c5.appendChild(h(
      '<div class="small" style="color:#5E6470;line-height:1.9">' +
      '调度模型：每个词维护难度 D 与稳定度 S，保留率 R = 1/(1+t/9S)，按 90% 保留率反解下次复习时间。<br>' +
      '答错时稳定度缩水但不清零，避免难词被永久打回原点。<br>' +
      '当前只启用「看词选义」，其余题型与拼写通道的接口已经预留。<br>' +
      '数据保存在本机浏览器，不上传任何服务器。' +
      '</div>'
    ));
    wrap.appendChild(c5);

    return wrap;
  }

  /* ============ 事件 ============ */

  document.addEventListener('keydown', function (e) {
    if (S.view !== 'study') return;
    var s = S.session;
    if (!s) return;
    var cur = currentItem();
    if (!cur) return;

    if (e.key === 'Enter') {
      if (s.answered) { e.preventDefault(); advance(); }
      return;
    }
    if (cur.stage === 'show') {
      var cfg = WL.store.getConfig();
      if (e.key === ' ' && cfg.sound) {
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

  function boot() {
    var cfg = WL.store.getConfig();
    var books = WL.books || [];
    var ok = false;
    for (var i = 0; i < books.length; i++) {
      if (books[i].id === cfg.book) { ok = true; break; }
    }
    if (!ok && books.length) {
      WL.store.setConfig({ book: books[0].id });
    }
    S.bookId = WL.store.getConfig().book;
    render();
  }

  WL.app = { boot: boot, startSession: startSession, render: render, state: S };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.WL);
