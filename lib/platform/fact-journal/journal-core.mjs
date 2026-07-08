/**
 * 每日快照 journal 纯逻辑(可单测)—— 跨区 P0 的第二件(反馈日志已由 personalization/ 落地)。
 *
 * PIT(point-in-time)纪律:
 * - 过去某天的行一旦写入即**不可变**(recordedAt 固定)——训练/检测做 as-of 回放时不被后来改写污染。
 * - 今天的行允许持续合并采样(易逝上下文:天气/日历一天内多次采样,后写覆盖),recordedAt 随之更新。
 * - backfilled 标记:该行由历史存储回溯推导(journal 上线前的日子),非当日实录——检测层可用,
 *   训练 as-of 回放时应知道它的 recordedAt 晚于 dateKey。
 */

/**
 * @typedef {{ dateKey: string; recordedAt: string; backfilled?: boolean; m: Record<string, number> }} JournalRow
 */

/**
 * 合并一天的行。规则见文件头。
 * @param {JournalRow | undefined} existing
 * @param {{ dateKey: string; m: Record<string, number>; backfilled?: boolean }} fresh
 * @param {boolean} isPast  dateKey 是否已成为过去(非今天)
 * @param {string} nowIso
 * @returns {JournalRow | undefined} 返回要写入的行;undefined = 不写(PIT 保护)
 */
export function mergeDayRow(existing, fresh, isPast, nowIso) {
  if (existing && isPast) return undefined; // 过去的行不可变
  if (!existing) {
    return { dateKey: fresh.dateKey, recordedAt: nowIso, backfilled: fresh.backfilled || undefined, m: { ...fresh.m } };
  }
  // 今天:合并,新采样覆盖同名列;一旦有过当日实录,不再标 backfilled
  return {
    dateKey: existing.dateKey,
    recordedAt: nowIso,
    backfilled: existing.backfilled && fresh.backfilled ? true : undefined,
    m: { ...existing.m, ...fresh.m },
  };
}

/**
 * 最近 n 天的 dateKey(含今天,新→旧)。
 * @param {number} n
 * @param {Date} [today]
 * @returns {string[]}
 */
export function datesBack(n, today = new Date()) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

/** 今天的 dateKey(设备本地)。 */
export function todayKey(today = new Date()) {
  return datesBack(1, today)[0];
}
