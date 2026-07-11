/**
 * Node Dates — the single implementation of "what date does this node carry?"
 *
 * Previously four copies lived in today-view-model (extractNearestDate),
 * dormant-engine (getDueDate), guidance source-adapters (inline DATE_KEYS loop)
 * and focusTimeHint — with diverging key lists (source-adapters was missing
 * 'start'/'datetime'/'remindAt', so nodes with only a start time became focus
 * items but never produced guidance cards). All consumers now import from here.
 */

/** Known date attribute keys, in priority order. */
export const NODE_DATE_KEYS = [
  'start', 'end', 'date', 'dueDate', 'due', 'deadline', 'datetime', 'scheduledAt', 'remindAt',
] as const;

type AttrBag = Record<string, unknown>;

function parseDateValue(v: unknown): Date | null {
  if (typeof v !== 'string' || v.length < 10) return null;
  // 批次 48:纯日期("2026-07-11",全天事件)按**本地日**解析 —— new Date() 会按
  // UTC 午夜,在西半球平移成前一天 20:00,节点被分错日桶、长出假钟点。
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = dm ? new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])) : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  // Reject garbage parses of non-date strings ("Room 12" etc.)
  if (d.getFullYear() <= 2020) return null;
  return d;
}

/**
 * First date found on a known key, in key priority order.
 * Use when "the" due date matters more than the closest one (dormant engine).
 */
export function firstNodeDate(attributes: AttrBag): Date | null {
  for (const key of NODE_DATE_KEYS) {
    const d = parseDateValue(attributes[key]);
    if (d) return d;
  }
  return null;
}

/**
 * The date closest to now — known keys first, then a scan of every string
 * attribute (nodes from AI extraction sometimes park dates on ad-hoc keys).
 * Use for urgency ranking and focus selection.
 */
export function nearestNodeDate(attributes: AttrBag, now: number = Date.now()): Date | null {
  let nearest: Date | null = null;
  const consider = (d: Date | null) => {
    if (d && (!nearest || Math.abs(d.getTime() - now) < Math.abs(nearest.getTime() - now))) {
      nearest = d;
    }
  };
  for (const key of NODE_DATE_KEYS) consider(parseDateValue(attributes[key]));
  for (const v of Object.values(attributes)) consider(parseDateValue(v));
  return nearest;
}

/**
 * 有效期语义(批次 65):`expiry` 不在 NODE_DATE_KEYS 里,此前靠"扫全部属性值"
 * 兜进 nearestNodeDate,纯日期被解析成本地**零点** —— "今天到期"的东西当天白天
 * 就掉出焦点窗口/引导窗口。有效期的正确含义是"到这一天**结束**都还有效",
 * 所以纯日期统一落到当天 23:59:59。
 */
export function nodeExpiryDate(attributes: AttrBag): Date | null {
  const d = parseDateValue(attributes.expiry);
  if (!d) return null;
  if (typeof attributes.expiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(attributes.expiry)) {
    d.setHours(23, 59, 59, 0);
  }
  return d;
}

/** All distinct dates on known keys — for adapters that emit one event per date. */
export function allNodeDates(attributes: AttrBag): Date[] {
  const seen = new Set<number>();
  const out: Date[] = [];
  for (const key of NODE_DATE_KEYS) {
    const d = parseDateValue(attributes[key]);
    if (d && !seen.has(d.getTime())) { seen.add(d.getTime()); out.push(d); }
  }
  return out;
}
