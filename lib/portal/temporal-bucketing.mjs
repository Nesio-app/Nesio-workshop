/**
 * 时段/夜归属分桶(纯函数,供 place-trail.ts / apple-health.ts 与 node 行为测试共用)。
 */

/** 小时(0-23)→ 时段桶。 */
export function bucketOfHour(h) {
  return h < 5 ? 'night' : h < 8 ? 'dawn' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
}

/**
 * 把一段从 (startHour:startMin) 起、持续 durationMin 分钟的停留,按其跨越的小时
 * 分摊到各时段桶。修「整段时长全记进开始那个时段」(4pm–10pm 晚餐 6h 全算下午)。
 * @returns {Record<string, number>} 各桶分到的分钟数
 */
export function distributeDwell(startHour, startMin, durationMin) {
  const out = {};
  let h = (((startHour | 0) % 24) + 24) % 24;
  let min = Math.max(0, Math.min(59, startMin | 0));
  let remaining = Math.max(0, Math.round(durationMin));
  let guard = 0;
  while (remaining > 0 && guard++ < 100000) {
    const chunk = Math.min(remaining, 60 - min);
    const b = bucketOfHour(h);
    out[b] = (out[b] || 0) + chunk;
    remaining -= chunk;
    h = (h + 1) % 24;
    min = 0;
  }
  return out;
}

/**
 * 睡眠"归属的那一晚":入睡时间早于中午(00–11 时)的段算前一晚,把跨午夜的一觉
 * (23:00→07:00 会被日历切成两天)并回入睡那天。startDate 形如
 * "YYYY-MM-DD HH:MM:SS ±ZZZZ"(Apple 导出的本地时间字符串)。
 */
export function sleepNightKey(startDate) {
  const s = String(startDate);
  const day = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const hour = Number(s.slice(11, 13));
  if (Number.isFinite(hour) && hour < 12) {
    const d = new Date(day + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  return day;
}
