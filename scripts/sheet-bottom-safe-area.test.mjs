/**
 * 行为契约:底部 sheet 不得裁掉 Vaul 安全区填充 → 真机「底白边」。
 *
 * 根因:`.nesio-sheet--bottom { overflow:hidden }` 会裁掉 Vaul 自带的
 * `[data-vaul-drawer]::after`(top:100%;height:200%;同色填充)。
 * 洞察全屏若用 100dvh,iOS 动态视口还会再短一截。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf8');

// 1) bottom sheet 必须 overflow:visible,让 Vaul ::after 能画出底边。
assert.match(
  css,
  /\.nesio-sheet\.nesio-sheet--bottom\s*\{[^}]*overflow:\s*visible/s,
  'nesio-sheet--bottom 必须 overflow:visible(否则裁掉 Vaul 底填充 → 白边)',
);

// 2) 不得再写回 overflow:hidden 到同一选择器的最终规则意图。
const bottomBlock = css.match(/\.nesio-sheet\.nesio-sheet--bottom\s*\{[^}]+\}/s);
assert.ok(bottomBlock, '找不到 .nesio-sheet.nesio-sheet--bottom 规则块');
assert.doesNotMatch(bottomBlock[0], /overflow:\s*hidden/, 'nesio-sheet--bottom 不得 overflow:hidden');

// 3) 洞察全屏卡用 lvh 盖满物理屏。
assert.match(
  css,
  /\.nesio-insights-sheet-card\s*\{[^}]*100lvh/s,
  '洞察全屏卡须用 100lvh(dvh 在 iOS 常短一截露白边)',
);

console.log('sheet-bottom-safe-area: OK(Vaul 底填充可见 + 洞察 lvh)');
