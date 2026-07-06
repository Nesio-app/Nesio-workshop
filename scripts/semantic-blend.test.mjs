/**
 * 行为契约:语义重排的混合归一化(直接执行 semantic-blend)。
 *
 * 修复的问题:cosine 相关文本聚在 0.7–0.9 窄带,直接和占满 [0,1] 的 rankScore 等权混合
 * 会被淹没,语义只轻微扰动。归一化后 sim 才能真正参与排序。
 */
import assert from 'node:assert/strict';
import { blendRankSim } from '../lib/portal/semantic-blend.mjs';

// ── 语义显著更相关的项应能反超文本 rank 更高的项 ────────────────────────────
{
  // A:文本 rank 高(1.0)但 sim 一般(0.72);B:rank 低(0.5)但 sim 明显更高(0.90)。
  const items = [
    { rank: 1.0, sim: 0.72, hasVec: true }, // A
    { rank: 0.5, sim: 0.90, hasVec: true }, // B
  ];
  const [a, b] = blendRankSim(items);
  assert.ok(b > a, '归一化后,语义明显更相关的 B 应反超 rank 更高的 A(否则语义被淹没)。');

  // 对照:未归一化的旧口径 0.5*rank+0.5*sim 里 A 会赢 —— 证明归一化改变了结果。
  const oldA = 0.5 * 1.0 + 0.5 * 0.72;
  const oldB = 0.5 * 0.5 + 0.5 * 0.90;
  assert.ok(oldA > oldB, '(对照)旧的未归一化口径里 A 反而赢 —— 正是被修的行为。');
}

// ── 无向量的项退回纯 rank,不被语义拉低 ─────────────────────────────────────
{
  const items = [
    { rank: 0.8, sim: 0, hasVec: false },
    { rank: 0.3, sim: 0.95, hasVec: true },
  ];
  const [noVec] = blendRankSim(items);
  assert.equal(noVec, 0.8, '无向量的项 = 纯 rank(语义未知,不惩罚)。');
}

// ── sim 全相等 → 中性 0.5,由 rank 决定次序 ─────────────────────────────────
{
  const items = [
    { rank: 0.9, sim: 0.8, hasVec: true },
    { rank: 0.2, sim: 0.8, hasVec: true },
  ];
  const [x, y] = blendRankSim(items);
  assert.ok(x > y, 'sim 全相等时归一化取中性,排序由 rank 决定。');
  assert.equal(x, 0.5 * 0.9 + 0.5 * 0.5, '全相等 sim → 归一化为中性 0.5。');
}

console.log('semantic-blend: OK');
