// 跨区 P1.5 lead-lag 契约:滞后互相关正确检出「X 领先 Y k 天」,挡纯噪声与同期拖影。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'lib/platform/cross-region/detect-core.mjs'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}) });
const { detectLeadLag } = mod.exports;

function rng(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }

// ── 1. a 领先 b 3 天:b_t ≈ a_{t-3} → 检出 lag=3, leader=a ──
{
  const cols = [
    { key: 'a', domain: 'finance', kind: 'continuous' },
    { key: 'b', domain: 'mood', kind: 'continuous' },
    { key: 'noise', domain: 'weather', kind: 'continuous' },
  ];
  const r = rng(99);
  const LAG = 3;
  const N = 60;
  const aSeries = Array.from({ length: N }, () => r() * 100); // 平稳随机
  const rows = [];
  for (let i = 0; i < N; i++) {
    rows.push({
      dateKey: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      m: {
        a: aSeries[i],
        b: i >= LAG ? aSeries[i - LAG] * 0.95 + (r() * 6 - 3) : r() * 100, // b 跟随 3 天前的 a
        noise: r() * 100,
      },
    });
  }
  const rels = detectLeadLag(rows, cols);
  const ab = rels.find((x) => x.leader === 'a' && x.follower === 'b');
  assert.ok(ab, 'a→b 先后线索应被检出');
  assert.equal(ab.lag, LAG, `滞后应为 ${LAG} 天,得 ${ab && ab.lag}`);
  assert.ok(ab.strength > 0.5, `应为强正向滞后相关,得 ${ab && ab.strength}`);
  assert.ok(ab.pValue < 0.05, 'p 值应显著');
  assert.ok(!rels.some((x) => x.leader === 'noise' || x.follower === 'noise'), '纯噪声不产生先后线索');
}

// ── 2. 纯同期相关(无滞后结构)→ 不应误报先后 ──
{
  const cols = [
    { key: 'x', domain: 'finance', kind: 'continuous' },
    { key: 'y', domain: 'mood', kind: 'continuous' },
  ];
  const r = rng(7);
  const rows = [];
  for (let i = 0; i < 50; i++) {
    const base = r() * 100;
    rows.push({
      dateKey: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      m: { x: base, y: base * 0.9 + (r() * 8 - 4) }, // 同一天强相关,无先后
    });
  }
  const rels = detectLeadLag(rows, cols);
  // 同期相关会让滞后也有些相关,但「滞后须强于同期」的门应挡掉纯同期拖影
  assert.ok(rels.length === 0, `纯同期相关不应报先后,得 ${rels.length} 条`);
}

// ── 3. 跨域约束:同域列不配对 ──
{
  const cols = [
    { key: 'p', domain: 'health', kind: 'continuous' },
    { key: 'q', domain: 'health', kind: 'continuous' }, // 同域
  ];
  const r = rng(3);
  const rows = [];
  const ps = Array.from({ length: 40 }, () => r() * 100);
  for (let i = 0; i < 40; i++) {
    rows.push({ dateKey: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`, m: { p: ps[i], q: i >= 2 ? ps[i - 2] : r() * 100 } });
  }
  assert.equal(detectLeadLag(rows, cols).length, 0, '同域列不产生跨区先后线索');
}

console.log('cross-region lead-lag: OK');
