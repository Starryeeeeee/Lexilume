// 核心逻辑自检：不依赖浏览器，直接在 Node 里跑调度与出题
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const ctx = { window: {}, console, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
vm.createContext(ctx);
['src/srs.js', 'src/quiz.js', 'src/sync.js', 'data/books.js', 'data/books-generated.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
});

const WL = ctx.window.WL;
const DAY = 86400000;
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); }
}

const gk = WL.books[0];
const word = gk.words[0];

console.log('\n[1] 间隔增长');
let st = WL.srs.newState(word, 0);
let t = 0;
const gaps = [];
for (let i = 0; i < 9; i++) {
  t = st.ch.r.due || (t + DAY);
  WL.srs.review(st, 'r', true, t);
  gaps.push(Math.round((st.ch.r.due - t) / DAY * 10) / 10);
}
console.log('    间隔序列(天):', gaps.join(' → '));
ok('间隔单调递增', gaps.every(function (v, i) { return i === 0 || v > gaps[i - 1]; }), gaps.join(','));
ok('9 次全对后间隔超过 100 天', gaps[gaps.length - 1] > 100, gaps[gaps.length - 1]);
ok('稳定度未超过上限', st.ch.r.s <= 365 * 3);

console.log('\n[2] 答错不清零');
const before = st.ch.r.s;
WL.srs.review(st, 'r', false, t + 200 * DAY);
ok('稳定度缩水', st.ch.r.s < before, before.toFixed(1) + ' → ' + st.ch.r.s.toFixed(1));
ok('缩水后仍大于 0.2 天', st.ch.r.s > 0.2, st.ch.r.s);
ok('遗忘次数 +1', st.lapses === 1);
ok('难度上升', st.ch.r.d > 2.2);

console.log('\n[3] 到期判定只认激活通道');
let st2 = WL.srs.newState(word, 1000);
ok('新词未测前不算到期', WL.srs.dueNow(st2, 1000, ['r']) === false);
WL.srs.review(st2, 'r', true, 1000);
ok('刚测完不算到期', WL.srs.dueNow(st2, 1000, ['r']) === false);
ok('推进到 due 之后算到期', WL.srs.dueNow(st2, st2.ch.r.due + 1, ['r']) === true);
ok('产出通道未激活时不被计入', st2.ch.p.n === 0 && st2.ch.p.due === 0);

console.log('\n[4] 保留率与间隔自洽');
let st3 = WL.srs.newState(word, 0);
WL.srs.review(st3, 'r', true, 1 * DAY);
const dueT = st3.ch.r.due;
const rAtDue = WL.srs.retrievability(st3.ch.r.s, st3.ch.r.last, dueT);
ok('到期时刻保留率约 90%', Math.abs(rAtDue - 0.9) < 0.001, rAtDue.toFixed(4));

console.log('\n[5] 出题：选项完整且唯一正确');
const chs = ['r'];
let bad = 0, checked = 0;
gk.words.forEach(function (w) {
  const q = WL.quiz.build(w, 'en2cn', gk.words);
  if (!q) { bad++; return; }
  checked++;
  const correct = q.options.filter(function (o) { return o.ok; }).length;
  const texts = q.options.map(function (o) { return o.text; });
  const uniq = new Set(texts).size;
  if (correct !== 1 || q.options.length !== 4 || uniq !== 4) {
    bad++;
    console.log('    问题词:', w.w, '选项数', q.options.length, '正确数', correct, '去重后', uniq);
  }
});
ok('全部 ' + checked + ' 个词都能生成 4 选 1 且干扰项不重复', bad === 0, bad + ' 个异常');

console.log('\n[6] 题型路由');
ok('只开 en2cn 时通道为 r', WL.quiz.CHANNEL['en2cn'] === 'r');
ok('chooseType 返回 en2cn', WL.quiz.chooseType(word, 'r', ['en2cn']) === 'en2cn');

console.log('\n[7] 预测与健康度');
let states = {};
const now = 50 * DAY;
for (let i = 0; i < 20; i++) {
  const w = gk.words[i];
  const s = WL.srs.newState(w, now);
  WL.srs.review(s, 'r', true, now);
  states[w.id] = s;
}
const fc = WL.srs.forecast(states, now, 30, chs);
ok('预测数组长度 30', fc.length === 30);
ok('预测总数等于已学词数', fc.reduce(function (a, b) { return a + b; }, 0) === 20);
const h = WL.srs.healthOf(states[gk.words[0].id], now, chs);
ok('健康度落在合法枚举内', ['learning', 'familiar', 'mastered', 'risk'].indexOf(h) >= 0, h);

console.log('\n[8] 词库完整性');
let noTr = 0;
WL.books.forEach(function (b) {
  b.words.forEach(function (w) {
    if (!w.tr) noTr++;
  });
});
ok('所有词条都有释义', noTr === 0, noTr + ' 条缺释义');

// 生成词书允许少量缺失（数据源覆盖度约 97%+），手工词书要求 100%
WL.books.forEach(function (b) {
  const n = b.words.length;
  if (!n) return;
  const missPh = b.words.filter(w => !w.ph && w.w.split(' ').length === 1).length;
  const missEx = b.words.filter(w => !w.ex).length;
  const hand = ['gk', 'tb', 'mine'].indexOf(b.id) >= 0;
  ok(b.name + ' 音标覆盖', hand ? missPh === 0 : (n - missPh) / n >= 0.95, '缺 ' + missPh + '/' + n);
  ok(b.name + ' 例句覆盖', hand ? missEx === 0 : (n - missEx) / n >= 0.95, '缺 ' + missEx + '/' + n);
});
console.log('    词库合计 ' + WL.books.reduce(function (a, b) { return a + b.words.length; }, 0) + ' 词');

console.log('\n[9] 看义选词与拼写环节');
bad = 0; checked = 0;
gk.words.forEach(function (w) {
  const q = WL.quiz.build(w, 'cn2en', gk.words);
  if (!q) { bad++; return; }
  checked++;
  const correct = q.options.filter(function (o) { return o.ok; }).length;
  const texts = q.options.map(function (o) { return o.text; });
  const uniq = new Set(texts).size;
  if (correct !== 1 || q.options.length !== 4 || uniq !== 4 || q.channel !== 'p') {
    bad++;
    console.log('    问题词:', w.w, '选项数', q.options.length, '正确数', correct, '通道', q.channel);
  }
});
ok('全部 ' + checked + ' 个词都能生成看义选词 4 选 1', bad === 0, bad + ' 个异常');

let spellableN = 0, spellBad = 0;
gk.words.forEach(function (w) {
  if (!WL.quiz.spellable(w)) return;
  spellableN++;
  const q = WL.quiz.build(w, 'spell', gk.words);
  if (!q || q.answer !== w.w || q.channel !== 'p' || q.hint[0] !== w.w[0]) spellBad++;
});
ok('拼写环节覆盖 ' + spellableN + '/' + gk.words.length + ' 词且题目完整', spellBad === 0, spellBad + ' 个异常');
ok('spellable 与 build("spell") 前提一致', gk.words.every(function (w) {
  return WL.quiz.spellable(w) === !!WL.quiz.build(w, 'spell', gk.words);
}));

const t2 = WL.quiz.chooseType(word, 'p', ['en2cn', 'cn2en']);
ok('产出通道路由到看义选词', t2 === 'cn2en', t2);

console.log('\n[10] 选项来源与对比释义');
let srcBad = 0;
gk.words.forEach(function (w) {
  const q = WL.quiz.build(w, 'en2cn', gk.words);
  if (!q) { srcBad++; return; }
  const okOpt = q.options.find(function (o) { return o.ok; });
  if (!okOpt || okOpt.src !== w.w || okOpt.meaning !== okOpt.text) srcBad++;
  const wrongs = q.options.filter(function (o) { return !o.ok; });
  if (wrongs.length < 3 || wrongs.some(function (o) { return !o.src || o.meaning !== o.text; })) srcBad++;
});
ok('看词选义选项都携带来源词与释义', srcBad === 0, srcBad + ' 个异常');

let srcBad2 = 0;
gk.words.forEach(function (w) {
  const q = WL.quiz.build(w, 'cn2en', gk.words);
  if (!q) { srcBad2++; return; }
  const wrongs = q.options.filter(function (o) { return !o.ok; });
  if (wrongs.some(function (o) { return !o.src || !o.meaning || o.src !== o.text; })) srcBad2++;
});
ok('看义选词选项都携带来源词与释义', srcBad2 === 0, srcBad2 + ' 个异常');

console.log('\n[11] 已斩词不进入复习预测');
const stCut = WL.srs.newState(word, 0);
WL.srs.review(stCut, 'r', true, 0);
stCut.cut = 1;
const statesCut = {};
statesCut[word.id] = stCut;
const fcCut = WL.srs.forecast(statesCut, 0, 30, ['r']);
ok('已斩词不计入复习预测', fcCut.reduce(function (a, b) { return a + b; }, 0) === 0, JSON.stringify(fcCut));
delete stCut.cut;
const fcBack = WL.srs.forecast(statesCut, 0, 30, ['r']);
ok('恢复后重新计入预测', fcBack.reduce(function (a, b) { return a + b; }, 0) === 1, JSON.stringify(fcBack));

console.log('\n[11b] 超期天数按最早到期通道计算');
const stOd = WL.srs.newState(word, 0);
WL.srs.review(stOd, 'r', true, 0);
WL.srs.review(stOd, 'p', true, 0);
stOd.ch.r.due = 95 * DAY;    // r 通道已超期 5 天
stOd.ch.p.due = 110 * DAY;   // p 通道未到期
const od = WL.srs.overdueDays(stOd, 100 * DAY, ['r', 'p']);
ok('多通道下取最早到期（正数）', od > 4.9 && od < 5.1, od.toFixed(2));

console.log('\n[12] 同步合并边界');
const m = WL.sync;
const sa = WL.srs.newState(word, 0);
WL.srs.review(sa, 'r', true, 100 * DAY);
const sb = WL.srs.newState(word, 0);
WL.srs.review(sb, 'r', true, 200 * DAY);
sb.lapses = 2;
const mp = m.mergeProgress({ w1: sa }, { w1: sb });
ok('同词并行练习取较晚复习的那份', mp.w1.lapses === 2, 'lapses=' + mp.w1.lapses);
const sc = WL.srs.newState(word, 0);
sc.cut = 500 * DAY;
const mp2 = m.mergeProgress({ w1: sa }, { w2: sc });
ok('删除不传播：并集保留两边', Object.keys(mp2).length === 2 && !!mp2.w2.cut, JSON.stringify(Object.keys(mp2)));
const ml = m.mergeLog({ '2026-01-01': { nw: 10, rv: 5, ok: 8, bad: 2, ms: 100, pr: 3 } }, { '2026-01-01': { nw: 20, rv: 3, ok: 9, bad: 1, ms: 200, pr: 5 } });
ok('同日日志按字段取较大值（不相加）', ml['2026-01-01'].nw === 20 && ml['2026-01-01'].rv === 5 && ml['2026-01-01'].ok === 9 && ml['2026-01-01'].pr === 5, JSON.stringify(ml['2026-01-01']));
const md = m.mergeData({ books: { a: { w1: sa } }, log: {} }, { books: { b: { w9: sb } }, log: {} });
ok('合并按词书取并集', Object.keys(md.books).length === 2 && Object.keys(md.books.a).length === 1 && Object.keys(md.books.b).length === 1);

console.log('\n[13] 新学模拟与预测整合');
const fw = [gk.words[0], gk.words[1], gk.words[2]];
const nowS = 100 * DAY;
const dues = WL.srs.simulateNewLearn(fw, nowS, 30, 1);
ok('模拟 3 词产生充足到期序列', dues.length >= 9, 'dues=' + dues.length);
ok('模拟到期都落在窗口内且晚于学习日', dues.every(function (d) { return d > nowS && d < nowS + 30 * DAY; }));
const fcS = WL.srs.forecast({}, nowS, 30, ['r'], dues);
ok('模拟到期并入预测总量', fcS.reduce(function (a, b) { return a + b; }, 0) === dues.length, JSON.stringify(fcS));
ok('学习从明天开始，今天桶为空', (fcS[0] || 0) === 0, 'fcS[0]=' + fcS[0]);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
