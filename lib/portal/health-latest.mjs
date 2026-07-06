/**
 * 从按日期升序排好的 (day, value) 序列里挑出用作"最新"数字的那一天。
 *
 * Apple 健康导出常在一天进行到一半时导出 → 序列的最后一天(= 导入当天)是残缺的。
 * 直接把它当"最新"会显示一个偏低的数字 + 一个吓人的负 delta
 * (例如"步数 3200 ▼ −6800")。因此:当最后一天正好是 today 且还有更早的完整日时,
 * 跳过这残缺的当天,用最后一个完整日;delta 用它的前一天。
 *
 * @param {Array<[string, number]>} days  升序排好的 [YYYY-MM-DD, value]
 * @param {string} today  本地今天 YYYY-MM-DD
 * @returns {{ last: [string, number], prev: number | null } | null}
 */
export function pickLatestCompleteDay(days, today) {
  if (!days || days.length === 0) return null;
  let idx = days.length - 1;
  // 只有存在更早的日子时才跳过残缺的今天 —— 唯一一天数据也要显示,不能返回空。
  if (idx > 0 && days[idx][0] === today) idx -= 1;
  const last = days[idx];
  const prev = idx > 0 ? days[idx - 1][1] : null;
  return { last, prev };
}
