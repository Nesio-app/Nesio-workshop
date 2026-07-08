import assert from 'node:assert/strict';
import { mergeDayRow, datesBack, todayKey } from '../lib/platform/fact-journal/journal-core.mjs';

const NOW = '2026-07-08T12:00:00.000Z';

// 过去的行:不存在 → 写入(标 backfilled)
{
  const row = mergeDayRow(undefined, { dateKey: '2026-07-01', m: { spend: 12 }, backfilled: true }, true, NOW);
  assert.deepEqual(row, { dateKey: '2026-07-01', recordedAt: NOW, backfilled: true, m: { spend: 12 } });
}

// 过去的行:已存在 → PIT 不可变,拒绝覆写
{
  const existing = { dateKey: '2026-07-01', recordedAt: '2026-07-01T20:00:00.000Z', m: { spend: 12 } };
  const row = mergeDayRow(existing, { dateKey: '2026-07-01', m: { spend: 99 } }, true, NOW);
  assert.equal(row, undefined, 'past rows are immutable');
}

// 今天:反复采样合并,新列并入、同列覆盖、recordedAt 更新
{
  const first = mergeDayRow(undefined, { dateKey: '2026-07-08', m: { weatherTempC: 30 } }, false, '2026-07-08T08:00:00.000Z');
  const second = mergeDayRow(first, { dateKey: '2026-07-08', m: { weatherTempC: 33, calendarEvents: 4 } }, false, NOW);
  assert.deepEqual(second.m, { weatherTempC: 33, calendarEvents: 4 });
  assert.equal(second.recordedAt, NOW);
  assert.equal(second.backfilled, undefined);
}

// 今天:曾是回填行,来了当日实录 → 去掉 backfilled 标
{
  const bf = mergeDayRow(undefined, { dateKey: '2026-07-08', m: { spend: 5 }, backfilled: true }, false, '2026-07-08T08:00:00.000Z');
  assert.equal(bf.backfilled, true);
  const live = mergeDayRow(bf, { dateKey: '2026-07-08', m: { weatherTempC: 31 } }, false, NOW);
  assert.equal(live.backfilled, undefined);
  assert.deepEqual(live.m, { spend: 5, weatherTempC: 31 });
}

// datesBack:含今天、新→旧、跨月正确
{
  const days = datesBack(3, new Date(2026, 6, 1)); // 2026-07-01
  assert.deepEqual(days, ['2026-07-01', '2026-06-30', '2026-06-29']);
  assert.equal(todayKey(new Date(2026, 6, 8)), '2026-07-08');
}

console.log('fact journal core tests passed');
