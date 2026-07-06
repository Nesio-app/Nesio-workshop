/**
 * 行为契约:训练"本周次数"周边界用本地日键,不经 UTC。
 *
 * 修「周一边界用 toISOString → 东八区把上周日算进本周,抬高本周负荷」。
 */
import assert from 'node:assert/strict';
import { localDayKey, mondayKeyLocal, countSessionsThisWeek } from '../lib/platform/training-week.mjs';

// localDayKey 用本地字段拼串,不经 UTC。
{
  const d = new Date(2026, 6, 6, 9, 30); // 本地 2026-07-06 09:30(周一)
  assert.equal(localDayKey(d), '2026-07-06');
}

// mondayKeyLocal:周一当天 → 自己;周日 → 本周一(上一个周一)。
{
  const mon = new Date(2026, 6, 6, 9, 0);  // 周一
  assert.equal(mondayKeyLocal(mon), '2026-07-06');
  const wed = new Date(2026, 6, 8, 23, 0); // 周三深夜
  assert.equal(mondayKeyLocal(wed), '2026-07-06', '周三 → 本周一仍是 07-06。');
  const sun = new Date(2026, 6, 12, 10, 0); // 周日
  assert.equal(mondayKeyLocal(sun), '2026-07-06', '周日属于以 07-06 开头的这一周。');
}

// 关键回归:上周日的训练不算进本周(本地键 07-05 < 周一键 07-06)。
{
  const now = new Date(2026, 6, 6, 9, 0); // 周一早上
  const log = [
    { date: '2026-07-05', protocolId: 'p', sessionId: 's1' }, // 上周日 —— 不算
    { date: '2026-07-06', protocolId: 'p', sessionId: 's2' }, // 本周一 —— 算
  ];
  assert.equal(countSessionsThisWeek(log, now), 1, '上周日那次被正确排除。');
}

// 一周内多次都算;空/脏数据安全。
{
  const now = new Date(2026, 6, 8, 12, 0); // 周三
  const log = [
    { date: '2026-07-06' }, { date: '2026-07-07' }, { date: '2026-07-08' },
    { date: '2026-06-30' }, // 更早的周,不算
    null, { foo: 1 },
  ];
  assert.equal(countSessionsThisWeek(log, now), 3);
  assert.equal(countSessionsThisWeek([], now), 0);
  assert.equal(countSessionsThisWeek(null, now), 0);
}

console.log('training-week: OK');
