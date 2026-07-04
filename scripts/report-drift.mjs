/**
 * L-2 漂移检测循环(report-only)。
 *
 * 三线漂移曾各自积累数周才被人工发现:契约测试钉在页面不可达的组件上假绿、
 * PRD 验收标准与代码实现脱节、文档数字过时。本脚本把三类漂移变成周报。
 *
 * 用法:node scripts/report-drift.mjs [--markdown]
 * 退出码恒为 0(L1 只报告);输出末行 DRIFT_TOTAL=<n> 供工作流判断是否开 issue。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const markdown = process.argv.includes('--markdown');
const findings = [];

function read(p) { return readFileSync(join(root, p), 'utf8'); }

// ── 1. 契约可达性:scripts/*.mjs 引用的 portal 组件是否被页面代码引用 ────────
const scriptFiles = readdirSync(join(root, 'scripts')).filter((f) => f.endsWith('.mjs'));
const componentRefRe = /components[/'"], '([A-Z][A-Za-z]+)\.tsx'|components\/portal\/([A-Z][A-Za-z]+)\.tsx/g;
const contractRefs = new Map(); // component -> Set<script>
for (const s of scriptFiles) {
  const src = read(join('scripts', s));
  // 跳过测试自写的临时 fixture(如 i18n-hardcode-scan 的 DemoPanel)
  const writesFixtures = src.includes('writeFileSync');
  for (const m of src.matchAll(componentRefRe)) {
    if (writesFixtures && !src.includes(`read('components/portal/${m[1] || m[2]}`) && !src.includes(`'${m[1] || m[2]}.tsx'), 'utf8'`)) continue;
    const comp = m[1] || m[2];
    if (!comp) continue;
    if (!contractRefs.has(comp)) contractRefs.set(comp, new Set());
    contractRefs.get(comp).add(s);
  }
}

// 页面侧引用图:components/ + app/ 里 import 该组件的文件(排除自身)
function isReachable(comp) {
  const dirs = ['components', 'app'];
  const needle1 = `/${comp}'`;
  const needle2 = `./${comp}'`;
  const needle3 = `import('./${comp}')`;
  for (const dir of dirs) {
    const stack = [join(root, dir)];
    while (stack.length) {
      const cur = stack.pop();
      for (const entry of readdirSync(cur, { withFileTypes: true })) {
        const p = join(cur, entry.name);
        if (entry.isDirectory()) { stack.push(p); continue; }
        if (!/\.(tsx|ts)$/.test(entry.name)) continue;
        if (entry.name === `${comp}.tsx`) continue;
        const src = readFileSync(p, 'utf8');
        if (src.includes(needle1) || src.includes(needle2) || src.includes(needle3)) return true;
      }
    }
  }
  return false;
}

for (const [comp, scripts] of contractRefs) {
  const file = join(root, 'components', 'portal', `${comp}.tsx`);
  if (!existsSync(file)) {
    findings.push({ kind: 'contract_target_missing', detail: `${comp}.tsx 不存在,但被契约引用: ${[...scripts].join(', ')}` });
    continue;
  }
  if (!isReachable(comp)) {
    findings.push({
      kind: 'contract_pinned_to_orphan',
      detail: `${comp}.tsx 页面不可达(死代码),但 ${scripts.size} 个契约仍钉在它上面: ${[...scripts].slice(0, 3).join(', ')}${scripts.size > 3 ? '…' : ''} — 契约在验证尸体`,
    });
  }
}

// ── 2. PRD 验收对账 ───────────────────────────────────────────────────────────
const prdMap = JSON.parse(read('docs/prd-acceptance-map.json'));
for (const item of prdMap.items) {
  if (!item.file || !existsSync(join(root, item.file))) {
    findings.push({ kind: 'prd_unimplemented', detail: `${item.id}: ${item.description} — 无实现文件` });
    continue;
  }
  const src = read(item.file);
  if (!src.includes(item.marker)) {
    findings.push({
      kind: 'prd_marker_missing',
      detail: `${item.id}: ${item.description} — ${item.file} 缺标记 "${item.marker}"${item.status_note ? `(${item.status_note})` : ''}`,
    });
  }
}

// ── 3. 文档过时:ARCHITECTURE.md 文件数 ───────────────────────────────────────
const archDoc = read('lib/portal/ARCHITECTURE.md');
const claimed = archDoc.match(/file count: (\d+)/)?.[1];
const actual = readdirSync(join(root, 'lib', 'portal')).filter((f) => /\.(ts|mjs|d\.ts|md)$/.test(f)).length;
if (claimed && Math.abs(Number(claimed) - actual) > 10) {
  findings.push({ kind: 'doc_stale', detail: `ARCHITECTURE.md 声称 ${claimed} 个文件,实际 ${actual} — 偏差 >10,该更新了` });
}

// ── 输出 ──────────────────────────────────────────────────────────────────────
const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);

if (markdown) {
  console.log('## 漂移检测报告(L-2,只报告)\n');
  if (findings.length === 0) console.log('✅ 无漂移。\n');
  for (const [kind, items] of Object.entries(byKind)) {
    console.log(`### ${kind}(${items.length})\n`);
    for (const f of items) console.log(`- ${f.detail}`);
    console.log('');
  }
} else {
  for (const f of findings) console.log(`[${f.kind}] ${f.detail}`);
  console.log(`\n漂移项合计: ${findings.length}`);
}
console.log(`DRIFT_TOTAL=${findings.length}`);
