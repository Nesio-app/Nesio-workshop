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
/**
 * 节点上表示时间的键。**按真实在用的来**,不是想象。
 *
 * 2026-07-31 修正:原名单里 `due` / `deadline` / `datetime` / `scheduledAt` / `remindAt`
 * 这五个**在全仓 attributes 里一次都没出现过** —— 当时不确定有哪些名字,就把能想到的都列上了。
 * 而真在用的 `occurredAt`(2 处)和 `takenAt`(2 处)**反而不在名单里**,只能靠下面
 * 「扫所有字符串字段猜日期」那层兜住。
 *
 * ## 标准名是 `occurredAt`
 *
 * 「这件事发生的时候」这一个概念,现在有四个名字:`date` / `occurredAt` / `takenAt`
 * / `start`(当它不表示区间时)。**新代码一律用 `occurredAt`** —— 语义最准,
 * `date` 太泛(什么的日期?),`takenAt` 只说得通拍照。
 *
 * 存量不动:老数据里的 `date` / `takenAt` 由这份名单继续认。但不许再长第五个名字,
 * 由 scripts/node-date-keys.test.mjs 守着。
 */
export const NODE_DATE_KEYS = [
  // 「事情发生的时候」—— 同一个概念的历史名字,新代码只用 occurredAt
  'occurredAt', 'date', 'takenAt',
  // 区间两端(和上面是不同概念,不是重复)
  'start', 'end',
  // 截止(不同概念)
  'dueDate',
] as const;

/** 新代码写「事情发生的时候」时该用的键。 */
export const CANONICAL_OCCURRED_KEY = 'occurredAt';

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
// 批次 75(用户实锤「刚记完就已过期」):写入瞬间的系统戳(capturedAt/occurredAt…)
// 是流水线元数据,不是"这件事发生的日子" —— 被全属性扫描当成节点日期后,
// 渲染时已过去几秒 → 新记录秒变「已过期」还进了今日聚焦。
const INTERNAL_TS_KEYS = new Set([
  'occuredAt', 'occurredAt', 'capturedAt', 'receivedAt', 'updatedAt', 'syncedAt',
  'doneAt', 'importedAt', 'createdAt', 'lastSeen', 'takenAt',
  // 批次 83:准入凭据「加入今日焦点的那天」不是事件日期 —— 它被扫成
  // "离现在最近的日期"后,未来的计划条目照样挂「已过期」(第三个源头)。
  'focusPinnedOn',
]);

export function nearestNodeDate(attributes: AttrBag, now: number = Date.now()): Date | null {
  let nearest: Date | null = null;
  const consider = (d: Date | null) => {
    if (d && (!nearest || Math.abs(d.getTime() - now) < Math.abs(nearest.getTime() - now))) {
      nearest = d;
    }
  };
  for (const key of NODE_DATE_KEYS) consider(parseDateValue(attributes[key]));
  for (const [k, v] of Object.entries(attributes)) {
    if (INTERNAL_TS_KEYS.has(k)) continue;
    consider(parseDateValue(v));
  }
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
