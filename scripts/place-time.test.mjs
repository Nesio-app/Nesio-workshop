import assert from 'node:assert/strict';
import { explicitWallClock, wallDateKey, wallHour, wallHHMM, dateKeyToLocalDate, clampEndToWallDay } from '../lib/portal/place-time.mjs';

// 带显式偏移 → 按事发地字面钟点(中国晚饭不再被美东时区改成清晨)
{
  const iso = '2024-05-01T19:23:00.000+08:00';
  assert.deepEqual(explicitWallClock(iso), { y: 2024, mo: 5, d: 1, hh: 19, mm: 23 });
  assert.equal(wallDateKey(iso), '2024-05-01');
  assert.equal(wallHour(iso), 19);
  assert.equal(wallHHMM(iso), '19:23');
}

// 负偏移 + 无冒号偏移两种写法都认
{
  assert.equal(wallHHMM('2024-11-03T08:05:00-05:00'), '08:05');
  assert.equal(wallDateKey('2024-11-03T23:59:00-0500'), '2024-11-03');
}

// Z(UTC)→ 不按字面,走设备时区(与 new Date 一致)
{
  const iso = '2024-05-01T02:00:00.000Z';
  assert.equal(explicitWallClock(iso), null);
  const d = new Date(iso);
  assert.equal(wallHour(iso), d.getHours());
  assert.equal(wallDateKey(iso), `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

// 'YYYY-MM-DD' 本地解析:不经 UTC(西半球设备上 getDate 不再偏一天)
{
  const d = dateKeyToLocalDate('2026-07-07');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 7);
}

// 跨天截断:带偏移的段按事发地 23:59 截,截出的时长 = 从开始到当地午夜
{
  const start = '2024-05-01T22:00:00.000+08:00';
  const end = '2024-05-02T09:00:00.000+08:00';
  const clamped = clampEndToWallDay(start, end);
  const durMin = Math.round((new Date(clamped).getTime() - new Date(start).getTime()) / 60000);
  assert.equal(durMin, 119, '22:00 → 23:59 事发地钟点应为 119 分钟');
  // 同天不截
  assert.equal(clampEndToWallDay(start, '2024-05-01T23:30:00.000+08:00'), '2024-05-01T23:30:00.000+08:00');
}

// 设备时区路径的跨天截断仍然成立
{
  const start = new Date();
  start.setHours(22, 0, 0, 0);
  const end = new Date(start.getTime() + 12 * 3_600_000);
  const clamped = new Date(clampEndToWallDay(start.toISOString(), end.toISOString()));
  assert.equal(clamped.getDate(), start.getDate(), '截断点应落在开始那天');
  assert.equal(clamped.getHours(), 23);
}

console.log('place time tests passed');
