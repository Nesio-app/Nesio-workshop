/**
 * 训练"本周次数"的纯周边界逻辑。
 *
 * 修「本周次数周一边界用 toISOString → 东八区把上周日算进本周」。
 * 根因:logSession 存 UTC 日键、sessionsThisWeek 把本地周一零点又转成 UTC,
 * UTC+ 时区本地周一 00:00 = 上周日 16:00 UTC → mondayKey 落到周日 → 多算一天。
 * 解法:入库与比较都用同一套"本地日键",不再经 UTC。
 */

/** 一个 Date 的本地 YYYY-MM-DD(不经 UTC)。 */
export function localDayKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 给定"现在",返回本周周一(本地)的日键。周一为周初。 */
export function mondayKeyLocal(now) {
  const day = (now.getDay() + 6) % 7; // 周一=0
  const monday = new Date(now);
  monday.setDate(now.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  return localDayKey(monday);
}

/**
 * 本周(本地)已完成训练次数。log 项的 date 是本地日键(见 logSession)。
 * @param {Array<{date: string}>} log
 * @param {Date} now
 */
export function countSessionsThisWeek(log, now) {
  const mondayKey = mondayKeyLocal(now);
  return (log || []).filter((e) => e && typeof e.date === 'string' && e.date >= mondayKey).length;
}
