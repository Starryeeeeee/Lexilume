// 把 data/books.js 与 data/books-generated.js 在 Node 里执行一遍，导出「词 id → 单词」索引。
// progress.json 只存 id（如 gk-12、daily-2026-11-21-3），要还原成单词文本只能靠词库本身。
// 注意：books-generated.js 依赖 books.js 先建好 WL.books（它直接 push），所以必须共用
// 同一个 window 并按顺序执行，不能每个文件一个 window。
import fs from 'node:fs';

const win = {};
const books = [];
for (const file of process.argv.slice(2)) {
  let code;
  try {
    code = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  try {
    new Function('window', code)(win);
  } catch {
    continue;
  }
}

for (const b of (win.WL && win.WL.books) || []) {
  books.push({
    id: String(b.id || ''),
    name: String(b.name || ''),
    words: (b.words || []).map((w) => String((w && w.w) || '')),
  });
}
process.stdout.write(JSON.stringify({ books }));
