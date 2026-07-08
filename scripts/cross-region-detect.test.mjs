// 跨区检测层(P1)契约:纯统计正确性 —— 对照已知值 + 防伪相关的端到端门控。
import assert from 'node:assert/strict';
import {
  rankData, pearson, spearman, correlationPValue, studentTTwoTailP,
  chiSquare1dfP, firstDiff, dfStationary, benjaminiHochberg,
  alignPair, detectCrossRegion,
} from '../lib/platform/cross-region/detect-core.mjs';

const approx = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

// 确定性噪声(LCG),测试可复现
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296; // [0,1)
  };
}

// ── 1. Spearman 极值与并列 ──
assert.equal(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1, '完全单调升 → ρ=1');
assert.equal(spearman([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]), -1, '完全单调降 → ρ=-1');
// 并列秩:[1,1,2,3] 的秩应是 [1.5,1.5,3,4]
assert.deepEqual(rankData([1, 1, 2, 3]), [1.5, 1.5, 3, 4], '并列取平均秩');
// 已知数据点(对照 scipy spearmanr([1,2,3,4,5],[5,6,7,8,7])≈0.8207)
approx(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7]), 0.8207, 0.001, 'Spearman 含并列对照值');

// ── 2. 相关 p 值(t 近似)对照 ──
// ρ=0.5, n=20 → t=2.449, df=18, 双尾 p≈0.0249
approx(correlationPValue(0.5, 20), 0.0249, 0.001, 'ρ=0.5 n=20 p 值');
// t 分布临界:df=18 双尾 0.05 的临界 t=2.101 → p≈0.05
approx(studentTTwoTailP(2.101, 18), 0.05, 0.002, 't(18) 临界 p');
// 大 df 趋近正态:t=1.96 → p≈0.05
approx(studentTTwoTailP(1.96, 100000), 0.05, 0.003, 't 大 df 趋正态');

// ── 3. 卡方(1 df)尾概率 ──
approx(chiSquare1dfP(3.8415), 0.05, 0.001, 'χ²=3.84 → p=0.05');
approx(chiSquare1dfP(6.635), 0.01, 0.001, 'χ²=6.63 → p=0.01');

// ── 4. 一阶差分 ──
assert.deepEqual(firstDiff([2, 5, 9, 14]), [3, 4, 5], '一阶差分');

// ── 5. DF 平稳性:白噪声平稳 / 随机游走非平稳 ──
{
  const rng = makeRng(42);
  const white = Array.from({ length: 60 }, () => rng() * 2 - 1);
  const rw = [];
  let acc = 0;
  const rng2 = makeRng(7);
  for (let i = 0; i < 60; i++) { acc += rng2() * 2 - 1; rw.push(acc); }
  assert.ok(dfStationary(white).stationary, '白噪声应判平稳');
  assert.ok(!dfStationary(rw).stationary, '随机游走应判非平稳');
}

// ── 6. BH-FDR:经典例子 ──
{
  // 4 个 p 值,q=0.10:排序 [0.01,0.02,0.03,0.5]
  // 阈 (k/4)*0.1: 0.025, 0.05, 0.075, 0.1 → 0.01≤0.025✓ 0.02≤0.05✓ 0.03≤0.075✓ 0.5>0.1✗
  // 最大通过 k=3 → 前三存活
  const pass = benjaminiHochberg([0.5, 0.01, 0.03, 0.02], 0.1);
  assert.deepEqual(pass, [false, true, true, true], 'BH-FDR 前三存活');
  // 全大 p → 全不过
  assert.deepEqual(benjaminiHochberg([0.4, 0.6, 0.9], 0.1), [false, false, false], 'BH-FDR 无存活');
}

// ── 7. 对齐:内连接只留两列都有值的天 ──
{
  const rows = [
    { dateKey: '2026-01-03', m: { x: 3, y: 30 } },
    { dateKey: '2026-01-01', m: { x: 1 } }, // y 缺 → 丢
    { dateKey: '2026-01-02', m: { x: 2, y: 20 } },
  ];
  const { a, b, dates } = alignPair(rows, 'x', 'y');
  assert.deepEqual(a, [2, 3], '对齐后按日期升序、只留双方都有的');
  assert.deepEqual(b, [20, 30]);
  assert.deepEqual(dates, ['2026-01-02', '2026-01-03']);
}

// ── 8. 端到端:真跨域相关出、纯噪声不出、趋势伪相关被差分挡掉 ──
{
  const columns = [
    { key: 'spend', domain: 'finance', kind: 'continuous' },
    { key: 'mood', domain: 'mood', kind: 'continuous' },
    { key: 'noise', domain: 'weather', kind: 'continuous' },
  ];
  const rng = makeRng(123);
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const dk = `2026-02-${String(i + 1).padStart(2, '0')}`;
    const base = rng() * 100; // 平稳随机
    rows.push({
      dateKey: dk,
      m: {
        spend: base,
        mood: -0.9 * base + (rng() * 6 - 3), // 与 spend 强负相关(花得多心情差)
        noise: rng() * 100, // 与谁都无关
      },
    });
  }
  const rels = detectCrossRegion(rows, columns);
  const sm = rels.find((r) => (r.a === 'spend' && r.b === 'mood') || (r.a === 'mood' && r.b === 'spend'));
  assert.ok(sm, 'spend×mood 真相关应被检出');
  assert.ok(sm.strength < -0.5, `方向应为强负相关,得 ${sm.strength}`);
  assert.ok(sm.pValue < 0.05, 'p 值应显著');
  const noisePair = rels.find((r) => r.a === 'noise' || r.b === 'noise');
  assert.ok(!noisePair, '纯噪声列不应产生跨区关系');
}

// ── 9. 趋势伪相关:两列各自单调上升但日间变化无关 → 差分后不出 ──
{
  const columns = [
    { key: 'a', domain: 'finance', kind: 'continuous' },
    { key: 'b', domain: 'health', kind: 'continuous' },
  ];
  const rng = makeRng(555);
  const rows = [];
  for (let i = 0; i < 40; i++) {
    rows.push({
      dateKey: `2026-03-${String(i + 1).padStart(2, '0')}`,
      m: { a: i + rng() * 2, b: i * 1.3 + rng() * 2 }, // 都随 i 上升(共同趋势),日间增量独立
    });
  }
  const rels = detectCrossRegion(rows, columns);
  const spurious = rels.find((r) => r.differenced === false && Math.abs(r.strength) > 0.8);
  assert.ok(!spurious, '共同趋势不应作为水平相关出;应被平稳化差分处理');
}

console.log('cross-region detect: OK');
