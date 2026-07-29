/**
 * local-day — 本地日键统一出口(QA 日期错位批修)。
 * 「今天是几号」必须按用户本地时区算;`new Date().toISOString().slice(0,10)` 是 UTC,
 * 美东晚上 8 点会把「今天」算成明天 —— 打卡、草稿、报告生成日期全体错位一天的根因。
 * 注意:只用于「当前时刻 → 日键」。历史时间戳的分桶(new Date(t).toISOString())
 * 是数据口径,改动会移动已有数据的归属日,不在本 helper 职责内。
 */
export function localDayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
