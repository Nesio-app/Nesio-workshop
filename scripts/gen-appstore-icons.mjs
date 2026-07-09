/**
 * 图标生成(App Store + PWA)—— 从 nesio-mark.svg 出一整套品牌图标。
 *
 * 产物:
 *  - public/appstore/nesio-icon-1024.png  —— App Store 营销图标,1024×1024,**不透明**
 *    (苹果拒收带 alpha 的图标),深蓝渐变底 + 居中发光立方(草稿,可替换)。
 *  - public/icons/nesio-pwa-{192,512}.png  —— PWA「any」图标,不透明。
 *  - public/icons/nesio-pwa-512-maskable.png —— maskable,mark 缩到安全区(~66%)。
 *  - public/icons/nesio-apple-touch-180.png —— iOS 主屏图标,不透明。
 *  - app/icon.png / app/apple-icon.png —— Next metadata 图标同步刷新。
 *
 * 跑:node scripts/gen-appstore-icons.mjs
 */
import sharp from 'sharp';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// nesio-mark.svg 的内部图形(去掉外层 <svg>),100×100 viewBox。
const MARK_INNER = `
  <defs>
    <linearGradient id="gc1" x1="0.15" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#f2f8ff"></stop><stop offset="0.45" stop-color="#b6d6f9"></stop><stop offset="1" stop-color="#588ce3"></stop>
    </linearGradient>
    <linearGradient id="gc2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.85"></stop><stop offset="1" stop-color="#ffffff" stop-opacity="0.05"></stop>
    </linearGradient>
    <radialGradient id="gcGlow" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="#c4dcfa" stop-opacity="0.9"></stop><stop offset="1" stop-color="#c4dcfa" stop-opacity="0"></stop>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="48" fill="url(#gcGlow)"></circle>
  <polygon points="50,10 84.6,30 84.6,70 50,90 15.4,70 15.4,30" fill="url(#gc1)"></polygon>
  <path d="M15.35898384862245,30.000000000000004 L50,10 L84.64101615137756,30.000000000000004 L50,50 Z" fill="url(#gc2)"></path>
  <path d="M15.35898384862245,70 L50,50 L84.64101615137756,70 L50,90 Z" fill="#3f6fc4" opacity="0.35"></path>
  <g stroke="#ffffff" stroke-opacity="0.7" stroke-width="1.1" stroke-linejoin="round" fill="none">
    <polygon points="50,10 84.6,30 84.6,70 50,90 15.4,70 15.4,30"></polygon>
    <path d="M15.35898384862245,30.000000000000004 L50,50 L84.64101615137756,30.000000000000004 M50,50 L50,90"></path>
  </g>`;

/** 组合一张不透明图标 SVG:深蓝渐变底 + 居中 mark(coverage = mark 占边长比例)。 */
function iconSvg(size, coverage) {
  const mark = size * coverage;
  const off = (size - mark) / 2;
  const s = mark / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0b1b34"></stop>
        <stop offset="1" stop-color="#1e3a63"></stop>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#bg)"></rect>
    <g transform="translate(${off},${off}) scale(${s})">${MARK_INNER}</g>
  </svg>`;
}

async function render(size, coverage, out) {
  const svg = iconSvg(size, coverage);
  // flatten → 去 alpha,不透明(苹果/iOS 要求)
  await sharp(Buffer.from(svg))
    .flatten({ background: '#0b1b34' })
    .png()
    .toFile(join(ROOT, out));
  console.log('wrote', out);
}

await mkdir(join(ROOT, 'public/appstore'), { recursive: true });

// App Store 营销图标(不透明,1024)
await render(1024, 0.62, 'public/appstore/nesio-icon-1024.png');
// PWA any
await render(192, 0.66, 'public/icons/nesio-pwa-192.png');
await render(512, 0.66, 'public/icons/nesio-pwa-512.png');
// maskable(mark 缩到安全区,四周留白多)
await render(512, 0.50, 'public/icons/nesio-pwa-512-maskable.png');
// iOS 主屏(不透明)
await render(180, 0.66, 'public/icons/nesio-apple-touch-180.png');
// Next metadata 图标同步
await render(512, 0.66, 'app/icon.png');
await render(180, 0.66, 'app/apple-icon.png');

// favicon(小尺寸,mark 大一点更清晰)
await render(32, 0.82, 'public/icons/nesio-favicon-32.png');

console.log('done');
