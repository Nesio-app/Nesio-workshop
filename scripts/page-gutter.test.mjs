/**
 * 行为契约:页面留边(2026-07-31 用户:「所有的页面,把这种四边都紧挨着屏幕边的
 * 情况处理一下。需要留一些边,要做到自适应屏幕才对」)。
 *
 * ── 出事的是什么 ────────────────────────────────────────────────────────────
 * 今天页、记忆页各自写了一份 `1.1rem` 的左右留边,而**装着财务/衣橱/洞察/日程的
 * 那整个壳(.nesio-insights-body)一个字都没写**。子面板普遍也不自己加
 * (analytics / finance / wardrobe / timeline / relationships 的根上都没有),
 * 于是那几屏的内容一路顶到屏幕边 —— 实测截图里「5 月」这个标签被裁掉了半个字。
 *
 * 更能说明问题的是那两处**就地补丁**:洞察标题栏补过 `0.25rem`(因为「洞察」两个字
 * 贴边了)、宫格编辑行补过 `0 0.25rem`(因为「完成」压在屏幕右边缘上),后者的注释里
 * 还把「洞察页整体是贴边布局」写成了既定事实。两次都在治症状,而下面整个 body 照旧贴着。
 *
 * ── 所以压什么 ──────────────────────────────────────────────────────────────
 *  ① 留边只有**一处定义**(--page-gutter)。散着写就会再出现「这一页改了那一页没改」。
 *  ② 页面级容器必须用它,并且是 `max(gutter, safe-area)` —— 写死一个数在横屏/刘海机上
 *     等于让内容钻到挖孔底下,那才是「自适应屏幕」真正要的那一半。
 *  ③ 那两处就地补丁不许长回来。
 *
 * ── 压不了什么(说清楚)──────────────────────────────────────────────────────
 * 这份契约只管**页面级容器**。单个 bottom sheet 内部贴不贴边由它自己的 card 决定
 * (查过:.nesio-voice-sheet-card 这类都有自己的 1.25rem),静态扫 CSS 分不清
 * 「容器没 padding 但子元素有」——那种要靠真机看。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const css = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

/** 取一个选择器的规则体(第一处定义)。 */
function block(selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `${selector} 不见了`);
  return css.slice(i, css.indexOf('}', i));
}

// ── ① 留边只有一处定义 ──────────────────────────────────────────────────────
{
  // 定位到 token 块(--tap-min 所在的那一块),不用 :root —— 这个文件里有好几个
  // :root 块(字体一块、主题一块),按选择器找会找到字体那块去。
  const at = css.indexOf('--tap-min: 44px;');
  assert.ok(at > 0, 'token 块不见了');
  const tokens = css.slice(at, at + 900);
  assert.match(tokens, /--page-gutter:\s*var\(--space-4\)/, '留边要和别的间距 token 放在一起,并且走 4px 网格上的 space token,不许再写一个魔数');
}

// ── ② 页面级容器都用它,而且带 safe-area ────────────────────────────────────
//
// 这四个是「一页的最外层滚动壳」。漏掉任何一个,那一页就贴边 —— 而漏掉的那次
// 恰恰不会有人立刻发现:别的页都是好的,看着像「只有这一页怪怪的」。
const PAGE_SHELLS = [
  ['.nesio-insights-body', '洞察壳 —— 财务/衣橱/洞察/日程全装在它里面,这次贴边的就是它'],
  ['.nesio-insights-header', '洞察标题栏 —— 要和它下面的内容对齐在同一条左边线上'],
  ['.nesio-today-scroll', '今天页'],
  ['.nesio-memory-scroll', '记忆页'],
  ['.portal-main', '设置页'],
  // 这两条是**弹出件的总闸**:所有走 NesioSheet 原语的 sheet/modal 都吃它们。
  // 单个 sheet 自己带 card 的(bare)不在这儿,那种由它自己的 card 类负责 ——
  // 查过一轮:.nesio-settings-sheet-card 1.25rem / .nesio-mood-card 1.1rem /
  // .nesio-rd-overlay 0.9rem / .nesio-trip-sheet-card space-4,都有。
  ['.nesio-sheet--bottom:not(.nesio-sheet--bare)', '底部弹出件(原语)'],
  ['.nesio-sheet--center', '居中弹出件(原语)'],
];
for (const [sel, why] of PAGE_SHELLS) {
  const b = block(sel);
  assert.match(
    b,
    /padding-left:\s*max\(var\(--page-gutter\),\s*env\(safe-area-inset-left,\s*0px\)\)/,
    `${sel} 的左留边要走 --page-gutter + safe-area(${why})`,
  );
  assert.match(
    b,
    /padding-right:\s*max\(var\(--page-gutter\),\s*env\(safe-area-inset-right,\s*0px\)\)/,
    `${sel} 的右留边要走 --page-gutter + safe-area(${why})`,
  );
  // 简写里的左右必须是 0 —— 留着旧值就是两份留边打架,而赢的那份取决于书写顺序。
  const shorthand = /\n\s*padding:\s*([^;]+);/.exec(b);
  if (shorthand) {
    // 括号深度感知的分词 —— 简写里常有 calc(6.5rem + env(...)),
    // 直接按空白切会把 calc 内部的 `+` 当成一个值(第一版就栽在这)。
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of shorthand[1].trim()) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (/\s/.test(ch) && depth === 0) { if (cur) { parts.push(cur); cur = ''; } continue; }
      cur += ch;
    }
    if (cur) parts.push(cur);
    const x = parts.length >= 2 ? parts[1] : parts[0];
    assert.match(x, /^0(px|rem)?$/, `${sel} 的 padding 简写里左右要留 0,交给 padding-left/right —— 两处都写会打架`);
  }
}

// ── ③ 就地补丁不许长回来 ────────────────────────────────────────────────────
{
  const sheet = fs.readFileSync(new URL('../components/portal/InsightsSheet.tsx', import.meta.url), 'utf8');
  assert.ok(
    !/padding:\s*'0 0\.25rem'/.test(sheet),
    '宫格编辑行那块 `0 0.25rem` 是贴边时代的补丁 —— 根因修了它就是双重缩进',
  );
  assert.ok(
    !/洞察页整体是贴边布局/.test(sheet),
    '「洞察页整体是贴边布局」这句话已经不成立了,别把一个 bug 当成设计写进注释',
  );
  const header = block('.nesio-insights-header');
  assert.ok(
    !/padding:\s*calc\([^;]*\)\s+0\.25rem/.test(header),
    '标题栏那个 0.25rem 也是补丁,统一走 --page-gutter',
  );
}

console.log(`page-gutter: OK(留边一处定义 / ${PAGE_SHELLS.length} 个页面壳与弹出件总闸都用上 / 带 safe-area 自适应 / 旧补丁没长回来)`);
