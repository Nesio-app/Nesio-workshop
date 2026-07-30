/**
 * css-token-integrity —— 设计系统规范的**守卫**(2026-07-30)。
 *
 * ## 为什么补这一条:规范一直在,但没人看着它
 *
 * CLAUDE.md 写着「禁止硬编码色值」和一张废弃色表(「遇到立即替换」)。查下来发现
 * **这条规范根本没有守卫**:
 *
 *   · `nesio-runtime-color-tokens` 名字像颜色守卫,实际只扫 personalization-insights.ts 一个文件;
 *   · `design-token-ratchet` 是**数量**棘轮 —— 它只看写死值的总数涨没涨,
 *     不看品种。所以废弃色可以一直躺着,只要总数不增就是绿的。
 *
 * 于是审计时找到的东西:`--chip-fog: #f0f4ff`、`--accent-info: #3b82f6`、
 * 健康卡的 `rgba(16,185,129,.14)` —— 全是 CLAUDE.md 点名废弃的,躺了很久没人发现。
 *
 * ## 更隐蔽的一类:写着 var() 但变量根本不存在
 *
 * 这一类**看起来完全合规**,棘轮也数不到(它数裸 hex),但实际渲染的是兜底值,
 * 甚至什么都不渲染:
 *
 *   · `var(--accent, #10b981)` —— `--accent` 全仓没定义 → 实际渲染的就是**废弃绿**;
 *   · `var(--text-muted)` —— 没定义也没兜底 → 颜色继承父级,文字次色变成主色,对比度全错;
 *   · `var(--radius)` —— 同上 → 圆角直接变 0,方角混在一堆圆角里。
 *
 * 这三处都是真机上看得见的,而且看源码时完全不觉得有问题。
 *
 * 所以这道守卫管两件事:**废弃色不许出现** + **var(--x) 里的 x 必须真的存在**。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** CLAUDE.md 点名废弃的色值。出现即红。 */
const DEPRECATED = [
  ['#8b5cf6', 'var(--portal-cool-accent)'],
  ['139,92,246', 'var(--portal-cool-accent)'],
  ['#3b6ef0', 'var(--portal-blue-deep)'],
  ['#6366f1', 'var(--portal-blue-deep)'],
  ['#3b82f6', 'var(--portal-blue-deep)'],
  ['#ef4444', 'var(--status-risk)'],
  ['239,68,68', 'var(--status-risk)'],
  ['#10b981', 'var(--status-go)'],
  ['16,185,129', 'var(--status-go)'],
  ['#f59e0b', 'var(--status-gentle)'],
  ['245,158,11', 'var(--status-gentle)'],
  ['#f0f4ff', 'var(--portal-accent-soft)'],
  ['#e8effe', 'var(--portal-accent-soft)'],
];

/**
 * 运行时由 JS `setProperty` 注入的变量 —— CSS 里查不到定义是正常的。
 * 加进来之前先确认它**真的**有代码在设置,否则就是给漏网开后门。
 */
const RUNTIME_SET = new Set([
  '--kb-inset',   // Portal.tsx:386 键盘弹起时 setProperty
]);

/** 模板字符串拼出来的前缀(`var(--emotion-${id})`)—— 名字是动态的,静态查不了。 */
const DYNAMIC_PREFIXES = ['--emotion-', '--viz-'];

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const cssFiles = [
  ...walk(path.join(ROOT, 'app'), ['.css']),
  ...(fs.existsSync(path.join(ROOT, 'design-system')) ? walk(path.join(ROOT, 'design-system'), ['.css']) : []),
];
const tsxFiles = walk(path.join(ROOT, 'components'), ['.tsx', '.ts']);

// ── ① 废弃色不许出现(注释里的历史说明不算)──────────────────────────────
const deprecatedHits = [];
for (const f of [...cssFiles, ...tsxFiles]) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  for (const [bad, better] of DEPRECATED) {
    if (src.includes(bad)) {
      deprecatedHits.push(`${path.relative(ROOT, f)}: ${bad} → 应改成 ${better}`);
    }
  }
}
assert.deepEqual(
  deprecatedHits, [],
  'CLAUDE.md 点名废弃的色值又出现了(「遇到立即替换」):\n  ' + deprecatedHits.join('\n  '),
);

// ── ② var(--x) 里的 x 必须真的有定义 ────────────────────────────────────
const defined = new Set();
for (const f of cssFiles) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]);
}

const undefinedUses = new Map();
for (const f of tsxFiles) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/var\((--[a-z0-9-]+)/g)) {
    const name = m[1];
    if (defined.has(name) || RUNTIME_SET.has(name)) continue;
    if (DYNAMIC_PREFIXES.some((p) => name === p || name.startsWith(p))) continue;
    const rel = path.relative(ROOT, f);
    if (!undefinedUses.has(name)) undefinedUses.set(name, new Set());
    undefinedUses.get(name).add(rel);
  }
}
const undefList = [...undefinedUses.entries()].map(([k, v]) => `${k}  ← ${[...v].join(', ')}`);
assert.deepEqual(
  undefList, [],
  '引用了**不存在**的 CSS 变量。这类问题看源码完全像合规的,但实际渲染的是兜底值\n'
  + '(甚至什么都不渲染:没兜底的 color 会继承父级、没兜底的 borderRadius 直接变 0):\n  '
  + undefList.join('\n  ')
  + '\n  → 改成设计系统里真实存在的 token;如果它由 JS setProperty 注入,加进 RUNTIME_SET 并注明在哪注入的。',
);

// ── ③ 反向:别把这道守卫变成摆设 ─────────────────────────────────────────
assert.ok(DEPRECATED.length >= 13, '废弃色表被删剩几条了 —— 它该和 CLAUDE.md 那张表一致');
assert.ok(defined.size > 50, `只扫到 ${defined.size} 个 token 定义 —— CSS 文件没找全,这道守卫等于没跑`);
assert.ok(tsxFiles.length > 50, `只扫到 ${tsxFiles.length} 个组件 —— 扫描范围不对`);

console.log(`css-token-integrity: OK(废弃色 0 处 / ${defined.size} 个 token 定义 / ${tsxFiles.length} 个组件里的 var() 全部有定义)`);
