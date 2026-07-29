/**
 * 桥接的**真**验收:在真浏览器里把旧类和它对应的 <Button> 组合并排算一遍样式,
 * 逐条属性对比(2026-07-29)。
 *
 * 为什么静态断言不够:scripts/button-primitive.test.mjs 能证明「旧类挂在原语的选择器组里」,
 * 但证不了「后面没有别的规则把它顶回去」—— 而这正是桥接最容易翻车的地方:
 * 同权重下靠后的赢,旧类自己那块声明大多在原语前面几千行,`html[data-portal-theme]`
 * 的夜间覆盖又比原语高一级。这一版就踩到两次(跳过键的 muted 色、type-action 的夜间蓝)。
 * 这个脚本是唯一能当场看出「算出来到底是哪一套值」的判据。
 *
 * 不进 test:contracts:它要 playwright + chromium,CI 里没有。改完桥接手动跑一次:
 *   node scripts/button-bridge-visual.check.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const CSS = fs.readFileSync('app/globals.css', 'utf8');
const PAIRS = [
  ['nesio-ob-primary-btn',     'nesio-btn nesio-btn--primary nesio-btn--lg nesio-btn--pill nesio-btn--full'],
  ['nesio-rel-log-btn',        'nesio-btn nesio-btn--soft nesio-btn--sm nesio-btn--pill'],
  ['nesio-today-btn',          'nesio-btn nesio-btn--md nesio-btn--pill'],
  ['nesio-proactive-action-btn','nesio-btn nesio-btn--secondary nesio-btn--sm nesio-btn--pill'],
  ['nesio-ob-auth-btn',        'nesio-btn nesio-btn--secondary nesio-btn--lg nesio-btn--full'],
  ['nesio-ob-skip-btn',        'nesio-btn nesio-btn--ghost nesio-btn--sm nesio-btn--full'],
  ['nesio-settings-action-btn','nesio-btn nesio-btn--soft nesio-btn--md nesio-btn--full'],
  ['nesio-settings-danger-btn','nesio-btn nesio-btn--soft nesio-btn--md nesio-btn--full nesio-btn--risk'],
  ['nesio-type-action-btn',    'nesio-btn nesio-btn--soft nesio-btn--sm nesio-btn--pill'],
  ['nesio-collapsed-act-btn',  'nesio-btn nesio-btn--soft nesio-btn--sm nesio-btn--pill'],
  ['nesio-exp-cancel-btn',     'nesio-btn nesio-btn--secondary nesio-btn--md'],
];
// 只比「统一性」相关的几何 + 底色/字色;各自保留的差异(外边距、描边、flex)不比。
const PROPS = ['fontSize', 'paddingTop', 'paddingLeft', 'borderRadius', 'backgroundColor', 'color', 'fontWeight'];
// 有意保留的差异:跳过键比 ghost 更淡、取消键比 secondary 更淡(都是「别抢主按钮」)。
const ALLOW = { 'nesio-ob-skip-btn': ['color'], 'nesio-exp-cancel-btn': ['color'] };

const html = `<style>${CSS}</style><div class="portal-root">`
  + PAIRS.map(([o, n], i) => `<button id="o${i}" class="${o}">文字</button><button id="n${i}" class="${n}">文字</button>`).join('')
  + '</div>';

const b = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const p = await b.newPage();
await p.setContent(html);
const out = await p.evaluate(({ PAIRS, PROPS }) => PAIRS.map(([o], i) => {
  const g = (id) => { const s = getComputedStyle(document.getElementById(id)); return Object.fromEntries(PROPS.map((k) => [k, s[k]])); };
  return { old: o, a: g(`o${i}`), b: g(`n${i}`) };
}), { PAIRS, PROPS });
await b.close();

let bad = 0;
for (const { old, a, b: n } of out) {
  const diff = PROPS.filter((k) => a[k] !== n[k] && !(ALLOW[old] || []).includes(k));
  if (diff.length) { bad++; console.log(`  ✗ ${old}`); for (const k of diff) console.log(`      ${k}: 旧类=${a[k]}  原语=${n[k]}`); }
  else console.log(`  ✓ ${old}`);
}
process.exit(bad ? 1 : 0);
