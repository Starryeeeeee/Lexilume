// 核心逻辑自检：不依赖浏览器，直接在 Node 里跑调度与出题
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const ctx = { window: {}, console };
vm.createContext(ctx);
['src/srs.js', 'src/quiz.js', 'data/books.js'].forEach(function (f) {
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
let noTr = 0, noPh = 0, noEx = 0;
WL.books.forEach(function (b) {
  b.words.forEach(function (w) {
    if (!w.tr) noTr++;
    if (!w.ph && w.w.split(' ').length === 1) noPh++;
    if (!w.ex) noEx++;
  });
});
ok('所有词条都有释义', noTr === 0, noTr + ' 条缺释义');
ok('单词都有音标', noPh === 0, noPh + ' 条缺音标');
ok('所有词条都有例句', noEx === 0, noEx + ' 条缺例句');
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

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
