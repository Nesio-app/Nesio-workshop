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
  const d = new Date(v);
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
