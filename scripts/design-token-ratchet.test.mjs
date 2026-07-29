/**
 * 设计系统棘轮 —— 写死的尺寸/颜色**只减不增**(2026-07-29)。
 *
 * 背景:用户说「整体都不统一」。查下来病根不是审美,是**没有唯一的写值处**:
 * 字号 254 处、间距 360 处、圆角 13 处、色值 67 处直接写在组件的 inline style 里,
 * 绕过了 design-system 的 token。于是两个挨着的按钮一个 0.78rem 一个 0.8rem、
 * 一个 padding 0.5 一个 0.55 —— 单看都合理,并排就是歪的。
 *
 * 为什么用棘轮而不是「一次清干净」:
 *   · 694 处一轮改不完,硬改必然出回归;
 *   · 只挂 eslint warning 等于没挂 —— 几百条警告没人会看,新增的一条淹在里面。
 * 棘轮把「不能更糟」变成 CI 能判的事:存量慢慢还,但**任何新代码都别想再加一处**。
 * 每清理一批就把下面的基线调低,数字只能往下走。
 *
 * 判据和 .eslintrc.json 里那几条 no-restricted-syntax 是同一套(编辑器里给提示,
 * 这里给 CI 一道闸)。加新规则时两边一起改。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url);

/**
 * 当前基线。**只能调低,不能调高。**
 * 清理完一批就把对应数字改成新的实际值 —— 那一刻棘轮就卡在更严的位置上了。
 */
const BASELINE = {
  fontSize: 252,
  spacing: 358,
  radius: 66,
  hex: 24,
};

/** 和 .eslintrc.json 同源的判据(那边管编辑器提示,这边管 CI)。 */
const CHECKS = [
  { key: 'fontSize', re: /\bfontSize:\s*'[0-9.]+(rem|px|em)'/g, what: '写死的字号', fix: 'var(--text-xs/sm/body/h3/h2/h1/display)' },
  { key: 'spacing', re: /\b(?:padding|margin|gap):\s*'[^']*[0-9.]+rem[^']*'/g, what: '写死的间距', fix: 'var(--space-1..16)(4px 网格)' },
  { key: 'radius', re: /\bborderRadius:\s*(?:'[0-9.]+(?:rem|px|em)?'|[0-9]+)/g, what: '写死的圆角', fix: 'var(--radius-sm/md/xl/pill)' },
  // 先摘掉 var(--x, #fallback) 这种兜底(全站惯例,不算硬编码),剩下的才是真写死。
  { key: 'hex', re: /#[0-9a-fA-F]{6}\b/g, what: '写死的色值', fix: 'var(--portal-*/--status-*/--viz-*)', strip: (s) => s.replace(/var\([^)]*,\s*#[0-9a-fA-F]{3,8}\)/g, '') },
];

/** ui/ 下是原语本身 —— 它就是那个「唯一写值的地方」,不该被自己的规则挡住。 */
const EXEMPT = /^components\/portal\/ui\//;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name) && !EXEMPT.test(rel)) out.push(rel);
  }
  return out;
}

const files = walk('components');
const counts = Object.fromEntries(CHECKS.map((c) => [c.key, 0]));
const worst = Object.fromEntries(CHECKS.map((c) => [c.key, new Map()]));

for (const rel of files) {
  const raw = fs.readFileSync(new URL(rel, ROOT), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')       // 注释里提到的不算
    .replace(/^\s*\/\/.*$/gm, '');
  for (const c of CHECKS) {
    const src = c.strip ? c.strip(raw) : raw;
    const n = (src.match(c.re) || []).length;
    if (n) {
      counts[c.key] += n;
      worst[c.key].set(rel, n);
    }
  }
}

let failed = false;
for (const c of CHECKS) {
  const now = counts[c.key];
  const base = BASELINE[c.key];
  if (now > base) {
    failed = true;
    const top = [...worst[c.key].entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([f, n]) => `      ${n.toString().padStart(3)}  ${path.basename(f)}`).join('\n');
    console.error(
      `\n  ✗ ${c.what}:${now} 处,比基线 ${base} 多了 ${now - base}。\n`
      + `    新代码不许再写死 —— 用 ${c.fix}。\n`
      + `    (如果你**清理**了一批导致数字变化,把 scripts/design-token-ratchet.test.mjs 里的基线调低即可,\n`
      + `     但绝不能调高:那等于把棘轮往回拧。)\n`
      + `    当前最多的几个文件:\n${top}`,
    );
  } else if (now < base) {
    console.log(`  ↓ ${c.what}:${now} 处(基线 ${base},已清理 ${base - now} 处)—— 记得把基线调到 ${now}`);
  }
}
assert.ok(!failed, '设计系统棘轮被往回拧了 —— 详见上面的清单');

// 原语必须存在,否则这条棘轮就成了「只许挡、不给替代品」
for (const p of ['components/portal/ui/Button.tsx', 'components/portal/ui/SegTabs.tsx', 'components/portal/ui/NesioSheet.tsx']) {
  assert.ok(fs.existsSync(new URL(p, ROOT)), `原语 ${p} 不见了 —— 挡住写死值却不给替代品,只会逼人绕过规则`);
}

console.log(`design-token-ratchet: OK(字号 ${counts.fontSize} · 间距 ${counts.spacing} · 圆角 ${counts.radius} · 色值 ${counts.hex},均未超基线)`);
