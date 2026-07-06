/**
 * 基线学习测试 —— 鲁棒统计 + z-score 异常判定。
 */
import assert from 'node:assert/strict';
import { robustStats, anomaly } from '../lib/portal/analyst-baseline.mjs';

// 中位数/MAD 对离群点稳健:一个尖峰不该带偏中心
{
  const s = robustStats([100, 102, 98, 101, 99, 100, 5000]);
  assert.ok(s.median >= 99 && s.median <= 101, `median 应≈100,得 ${s.median}`);
  assert.ok(s.sigma > 0);
}

// 样本不足 → cold(调用方退回固定阈值)
{
  const a = anomaly(40, [100, 100, 100], { minSamples: 7 });
  assert.equal(a.cold, true);
  assert.equal(a.isAnomaly, false);
}

// 稳定历史 + 今日暴跌 → 判为向下异常
{
  const hist = Array.from({ length: 20 }, (_, i) => 100 + (i % 3)); // ~100,小波动
  const a = anomaly(40, hist, { k: 3, minSamples: 10 });
  assert.equal(a.cold, false);
  assert.equal(a.isAnomaly, true);
  assert.equal(a.direction, 'down');
  assert.ok(a.z < -3, `z 应显著为负,得 ${a.z}`);
}

// 稳定历史 + 今日在常态内 → 不报
{
  const hist = Array.from({ length: 20 }, (_, i) => 100 + (i % 5));
  const a = anomaly(102, hist, { k: 3, minSamples: 10 });
  assert.equal(a.isAnomaly, false);
}

// 历史无波动(全 100)+ 今日 100 → 不报;今日 300 → 报
{
  const flat = Array.from({ length: 15 }, () => 100);
  assert.equal(anomaly(100, flat, { minSamples: 7 }).isAnomaly, false);
  assert.equal(anomaly(300, flat, { minSamples: 7 }).isAnomaly, true);
}

console.log('analyst-baseline: OK');
