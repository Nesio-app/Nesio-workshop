/**
 * 把 pdfjs-dist 的 cmaps / standard_fonts 同步到 public/pdfjs/。
 *
 * 为什么必须随包一起下发:pdf.js 解 CJK(CID-keyed)字体要查 CMap 表。
 * 缺了它,中文 PDF 的 getTextContent() 返回**零个文字块** —— 不报错、不抛异常,
 * 只是「什么都没有」。上层于是把一份好端端的文字版化验单判成扫描件,
 * 推给端上 OCR。中文化验单正是主场景,所以这不是边角情况。
 * (2026-07-29 实测:不带 cMapUrl 时,一份带文字层的中文化验单提取出 0 个字符。)
 *
 * 从 CDN 拉也不行 —— next.config.js 的 CSP connect-src 不放行,而且离线就废了。
 * 所以复制进 public/,和主包同源。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const from = path.join(root, 'node_modules/pdfjs-dist');
const to = path.join(root, 'public/pdfjs');

for (const dir of ['cmaps', 'standard_fonts']) {
  const src = path.join(from, dir);
  if (!fs.existsSync(src)) { console.error(`[sync-pdfjs] 缺 ${src} —— pdfjs-dist 装好了吗?`); process.exit(1); }
  fs.rmSync(path.join(to, dir), { recursive: true, force: true });
  fs.cpSync(src, path.join(to, dir), { recursive: true });
  console.log(`[sync-pdfjs] ${dir}: ${fs.readdirSync(path.join(to, dir)).length} 个文件`);
}
