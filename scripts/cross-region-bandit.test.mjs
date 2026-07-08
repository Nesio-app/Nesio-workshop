// 跨区 P3 LinUCB bandit 契约:矩阵求逆 + 冷启动=先验 + 反馈学习 + UCB 探索。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'lib/platform/cross-region/bandit-core.mjs'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), Math, Array, Object });
const { matInverse, createBanditState, banditScore, banditUpdate, rankByBandit } = mod.exports;

const approx = (a, b, t, m) => assert.ok(Math.abs(a - b) <= t, `${m}: ${a} vs ${b}`);

// ── 1. 矩阵求逆(已知 2×2)──
{
  const M = [[4, 3], [6, 3]]; // det = -6, inv = [[-0.5,0.5],[1,-0.6667]]
  const inv = matInverse(M);
  approx(inv[0][0], -0.5, 1e-9, 'inv[0][0]');
  approx(inv[0][1], 0.5, 1e-9, 'inv[0][1]');
  approx(inv[1][0], 1, 1e-9, 'inv[1][0]');
  approx(inv[1][1], -2 / 3, 1e-9, 'inv[1][1]');
  assert.equal(matInverse([[1, 2], [2, 4]]), null, '奇异矩阵返回 null');
}

// ── 2. 冷启动:θ = 先验(A=λI,b=λθ₀)──
{
  const prior = [0.2, 1.0, 0.4]; // bias, strength, confidence(示意)
  const st = createBanditState(prior, { lambda: 1 });
  // 无探索(alpha=0)时,score(x) = θ₀ᵀx
  const x = [1, 0.8, 0.5];
  const expect = 0.2 * 1 + 1.0 * 0.8 + 0.4 * 0.5; // = 1.2
  approx(banditScore(x, st, { alpha: 0 }), expect, 1e-9, '冷启动 = 先验打分');
}

// ── 3. 反馈学习:奖励某类特征后,该类分升 ──
{
  const prior = [0, 0, 0]; // 全零先验,纯从反馈学
  let st = createBanditState(prior, { lambda: 1 });
  const xLead = [1, 1, 0]; // 「先后」类
  const xCorr = [1, 0, 1]; // 「相关」类
  const before = banditScore(xLead, st, { alpha: 0 });
  // 反复奖励先后类(reward=1)、惩罚相关类(reward=0)
  for (let i = 0; i < 15; i++) { st = banditUpdate(xLead, 1, st); st = banditUpdate(xCorr, 0, st); }
  const afterLead = banditScore(xLead, st, { alpha: 0 });
  const afterCorr = banditScore(xCorr, st, { alpha: 0 });
  assert.ok(afterLead > before, '被奖励的类分应升');
  assert.ok(afterLead > afterCorr, '偏好的类应排在前');
}

// ── 4. UCB 探索:少见的候选拿到探索加成(分 > 纯利用)──
{
  const st = createBanditState([0, 0, 0], { lambda: 1 });
  const x = [1, 1, 1];
  const exploit = banditScore(x, st, { alpha: 0 });
  const withUcb = banditScore(x, st, { alpha: 0.5 });
  assert.ok(withUcb > exploit, 'α>0 时 UCB 给未探索候选正的探索加成');
}

// ── 5. rankByBandit:按 UCB 分降序 ──
{
  const prior = [0, 1, 0]; // 第二维权重高
  const st = createBanditState(prior, { lambda: 1 });
  const cands = [
    { id: 'low', x: [1, 0.2, 0] },
    { id: 'high', x: [1, 0.9, 0] },
    { id: 'mid', x: [1, 0.5, 0] },
  ];
  const ranked = rankByBandit(cands, st, { alpha: 0 });
  assert.deepEqual(ranked.map((c) => c.id), ['high', 'mid', 'low'], '按利用分降序');
}

console.log('cross-region bandit (LinUCB): OK');
