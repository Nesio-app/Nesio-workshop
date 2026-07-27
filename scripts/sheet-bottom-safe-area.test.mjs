/**
 * 行为契约:底部 sheet 与洞察全屏的视口架构。
 *
 * 底白边/顶叠状态栏的真根因不是「填色」,而是把全屏页做成 Vaul bottom + 100lvh:
 * Vaul transform 会把内容上推、底下留缝;下滑才重算对齐。
 * 洞察必须走 NesioSheet fullscreen(inset:0),安全区由内容 padding 吃。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf8');
const portal = fs.readFileSync(path.join(process.cwd(), 'components', 'portal', 'Portal.tsx'), 'utf8');

// 1) bottom sheet 必须 overflow:visible,让 Vaul ::after 能画出底边(真半屏抽屉仍需要)。
assert.match(
  css,
  /\.nesio-sheet\.nesio-sheet--bottom\s*\{[^}]*overflow:\s*visible/s,
  'nesio-sheet--bottom 必须 overflow:visible(否则裁掉 Vaul 底填充 → 白边)',
);

const bottomBlock = css.match(/\.nesio-sheet\.nesio-sheet--bottom\s*\{[^}]+\}/s);
assert.ok(bottomBlock, '找不到 .nesio-sheet.nesio-sheet--bottom 规则块');
assert.doesNotMatch(bottomBlock[0], /overflow:\s*hidden/, 'nesio-sheet--bottom 不得 overflow:hidden');

// 2) 洞察挂载必须是 fullscreen,禁止再当 bottom 假全屏。
assert.match(
  portal,
  /insightsOpen[\s\S]*?variant=["']fullscreen["']/s,
  '洞察必须 NesioSheet variant=fullscreen',
);
assert.doesNotMatch(
  portal,
  /insightsOpen[\s\S]*?variant=["']bottom["'][\s\S]*?InsightsSheet/s,
  '洞察不得再用 variant=bottom 假全屏',
);

// 3) 洞察卡用 inset:0 贴满,不靠 100lvh + Vaul ::after 填色。
assert.match(
  css,
  /\.nesio-insights-sheet-card\s*\{[^}]*inset:\s*0/s,
  '洞察卡须 inset:0 贴满 WebView',
);
assert.doesNotMatch(
  css,
  /\.nesio-insights-sheet-card\s*\{[^}]*(?:height|max-height)\s*:\s*[^;]*100(?:lvh|dvh|vh)/s,
  '洞察卡不得再靠视口单位撑高',
);
assert.doesNotMatch(
  css,
  /\.nesio-insights-sheet-card\[data-vaul-drawer\]::after/,
  '洞察卡不得再依赖 Vaul ::after 填色',
);

// 4) 通用 fullscreen 也不要 max-height:100lvh(与 inset:0 打架)。
const fsBlock = css.match(/\.nesio-sheet--fullscreen\s*\{[^}]+\}/s);
assert.ok(fsBlock, '找不到 .nesio-sheet--fullscreen');
assert.doesNotMatch(fsBlock[0], /max-height:\s*100lvh/, 'fullscreen 不得 max-height:100lvh');
  assert.match(fsBlock[0], /inset:\s*0/, 'fullscreen 须 inset:0');
assert.match(fsBlock[0], /max-height:\s*none/, 'fullscreen 不得用视口单位限高');
assert.doesNotMatch(fsBlock[0], /100lvh/, 'fullscreen 规则块不得再写 100lvh');

console.log('sheet-bottom-safe-area: OK(bottom Vaul 可见 + 洞察真 fullscreen inset:0)');
