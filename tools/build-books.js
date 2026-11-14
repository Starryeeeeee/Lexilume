// 词书生成：把 kajweb/dict（有道词书公开镜像）下载来的三本词书 NDJSON 转成 data/books-generated.js
// 数据获取方式：github.com/kajweb/dict 的 book/ 目录下三个 zip（GaoZhong_2 / CET4_2 / CET6_2），
// 经 api.github.com blobs 接口下载后解压到 %TEMP% 下 wordbeat-dict/{GaoZhong_2,CET4_2,CET6_2}/，
// 然后运行 node tools/build-books.js 重新生成
const fs = require('fs');
const path = require('path');

const SRC = path.join(process.env.TEMP || 'C:/Users/Win10/AppData/Local/Temp', 'wordbeat-dict');
const ROOT = path.join(__dirname, '..');

function pickPhone(w) {
  const raw = (w.ukphone || w.usphone || '').trim();
  if (!raw) return '';
  const parts = raw.split(/\s*;\s*/).filter(Boolean);
  return '/' + parts.join(' / ') + '/';
}

function pickPos(trans) {
  const seen = [];
  (trans || []).forEach(function (t) {
    const p = (t.pos || '').trim();
    if (/^[a-z]+$/i.test(p) && seen.indexOf(p) < 0) seen.push(p);
  });
  if (!seen.length) return '';
  return seen.map(p => p + '.').join('/');
}

function capTr(senses) {
  let out = '';
  for (let i = 0; i < senses.length; i++) {
    const candidate = senses.slice(0, i + 1).join('；');
    if (candidate.length > 90 && i > 0) break;
    out = candidate;
  }
  if (!out) out = senses[0].slice(0, 90) + '…';
  else if (out.length < senses.join('；').length) out += '…';
  return out;
}

function pickMeaning(trans) {
  const senses = (trans || []).map(t => (t.tranCn || '').trim()).filter(Boolean);
  if (!senses.length) return '';
  return capTr(senses);
}

function cleanSentence(s) {
  return (s || '').replace(/^\s*\.{2,}\s*/, '').replace(/\s*\.{2,}\s*$/, '').trim();
}

function pickExample(word) {
  const s = word.sentence && word.sentence.sentences && word.sentence.sentences[0];
  if (s && s.sContent) return { ex: s.sContent.trim(), exCn: (s.sCn || '').trim() };
  const r = word.realExamSentence && word.realExamSentence.sentences && word.realExamSentence.sentences[0];
  if (r && r.sContent) return { ex: cleanSentence(r.sContent), exCn: (r.sCn || cleanSentence(r.sContent)).slice(0, 160) };
  return { ex: '', exCn: '' };
}

function convertBook(zipDir) {
  const raw = fs.readFileSync(path.join(SRC, zipDir, zipDir + '.json'), 'utf8');
  const entries = raw.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  const seen = {};
  const words = [];
  let noPh = 0, noEx = 0;
  entries.forEach(function (e) {
    const w0 = (e.headWord || (e.content.word.wordHead || '')).trim();
    if (!w0 || seen[w0]) return;
    seen[w0] = 1;
    const c = (e.content && e.content.word && e.content.word.content) || {};
    const ph = pickPhone(c);
    const exPair = pickExample(c.sentence ? c : Object.assign({}, c, {}));
    if (!ph) noPh++;
    if (!exPair.ex) noEx++;
    words.push({
      w: w0,
      ph: ph,
      pos: pickPos(c.trans),
      tr: pickMeaning(c.trans),
      ex: exPair.ex,
      exCn: exPair.exCn
    });
  });
  return { words: words, noPh: noPh, noEx: noEx, dup: entries.length - words.length };
}

const gk = convertBook('GaoZhong_2');
const c4 = convertBook('CET4_2');
const c6 = convertBook('CET6_2');
[[ '高中3500', gk ], ['四级', c4 ], ['六级', c6 ]].forEach(function (p) {
  const total = p[1].words.length;
  console.log(p[0] + ':', total, '词 | 缺音标', p[1].noPh, '| 缺例句', p[1].noEx, '| 去重', p[1].dup);
  if (!p[1].words.some(w => w.tr)) throw new Error('no meanings!');
  p[1].words.forEach(w => { if (!w.tr) throw new Error('missing tr: ' + w.w); });
});

function G(id, name, note, words) {
  words.forEach(function (w, i) { w.id = id + '-' + i; });
  return { id: id, name: name, note: note, words: words };
}

const out = [];
out.push('// 数据来源：kajweb/dict（有道词书公开镜像，NDJSON 原始数据由 tools 脚本转换生成）');
out.push('// 由一次性脚本生成，勿手工编辑；重新生成时重跑转换脚本即可');
out.push('window.WL = window.WL || {};');
out.push('(function (WL) {');
out.push("  'use strict';");
out.push('  function G(id, name, note, words) {');
out.push('    words.forEach(function (w, i) { w.id = id + \'-\' + i; });');
out.push('    return { id: id, name: name, note: note, words: words };');
out.push('  }');
['gk3500', 'cet4', 'cet6'].forEach(function (id) {
  const book = id === 'gk3500' ? gk : id === 'cet4' ? c4 : c6;
  out.push('  var ' + id.toUpperCase().replace('3', 'THREE') + ' = [');
  book.words.forEach(function (w, i) {
    out.push('    ' + JSON.stringify(w) + (i < book.words.length - 1 ? ',' : ''));
  });
  out.push('  ];');
  const name = id === 'gk3500' ? '高中 3500 词' : id === 'cet4' ? '大学英语四级' : '大学英语六级';
  const note = id === 'gk3500' ? '高考大纲与高中课标词汇 · ' + book.words.length + ' 词'
    : id === 'cet4' ? '四级大纲词汇 · ' + book.words.length + ' 词'
    : '四级以上的六级大纲词汇 · ' + book.words.length + ' 词';
  out.push('  WL.books.push(G(\'' + id + '\', \'' + name + '\', \'' + note + '\', ' + id.toUpperCase().replace('3', 'THREE') + '));');
});
out.push('})(window.WL);');

fs.writeFileSync(path.join(ROOT, 'data', 'books-generated.js'), out.join('\n') + '\n');
console.log('written data/books-generated.js,', Math.round(fs.statSync(path.join(ROOT, 'data', 'books-generated.js')).size / 1024) + 'KB');
