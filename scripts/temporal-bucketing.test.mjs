/**
 * 行为契约:时段分摊 + 睡眠归夜(直接执行 temporal-bucketing)。
 *
 * ① distributeDwell:整段停留按跨越的小时分摊到各时段桶,而非全记进开始那个时段。
 * ② sleepNightKey:跨午夜的一觉(23:00→07:00)并回入睡那天,不再只统计后半段。
 */
import assert from 'node:assert/strict';
import { bucketOfHour, distributeDwell, sleepNightKey } from '../lib/portal/temporal-bucketing.mjs';

// ── bucketOfHour 边界 ───────────────────────────────────────────────────────
assert.equal(bucketOfHour(4), 'night');
assert.equal(bucketOfHour(6), 'dawn');
assert.equal(bucketOfHour(10), 'morning');
assert.equal(bucketOfHour(16), 'afternoon');
assert.equal(bucketOfHour(20), 'evening');
assert.equal(bucketOfHour(22), 'night');

// ── ① 4pm–10pm 晚餐 6 小时分到 下午/傍晚/夜,而非全算下午 ────────────────────
{
  const d = distributeDwell(16, 0, 360); // 16:00 起 6h
  assert.equal(d.afternoon, 60, '16–17 点 = 下午 60min。');
  assert.equal(d.evening, 240, '17–21 点 = 傍晚 240min。');
  assert.equal(d.night, 60, '21–22 点 = 夜 60min。');
  const total = Object.values(d).reduce((a, b) => a + b, 0);
  assert.equal(total, 360, '分摊后总分钟数守恒。');
}

// ── 起始带分钟 + 跨午夜 ─────────────────────────────────────────────────────
{
  const d = distributeDwell(16, 30, 60); // 16:30 起 1h
  assert.equal(d.afternoon, 30, '16:30–17:00 = 下午 30min。');
  assert.equal(d.evening, 30, '17:00–17:30 = 傍晚 30min。');

  const overnight = distributeDwell(23, 0, 120); // 23:00 起 2h 跨午夜
  assert.equal(overnight.night, 120, '23–01 点全算夜,跨午夜不丢。');
}

// ── ② 跨午夜睡眠归到入睡那天 ────────────────────────────────────────────────
{
  assert.equal(sleepNightKey('2024-01-01 23:00:00 -0800'), '2024-01-01', '入睡 23 点 → 当天。');
  assert.equal(sleepNightKey('2024-01-02 02:00:00 -0800'), '2024-01-01', '凌晨 2 点段 → 前一晚。');
  assert.equal(sleepNightKey('2024-01-02 07:00:00 -0800'), '2024-01-01', '早 7 点醒 → 仍算前一晚。');
  assert.equal(sleepNightKey('2024-01-02 14:00:00 -0800'), '2024-01-02', '下午小睡 → 当天(不并前一晚)。');
  // 月初边界:1 号凌晨 → 上月最后一天
  assert.equal(sleepNightKey('2024-03-01 03:00:00 +0000'), '2024-02-29', '月初凌晨正确回到上月末(闰年)。');
}

console.log('temporal-bucketing: OK');
