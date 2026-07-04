/**
 * Temporal Query Parser — converts natural language time expressions to Date ranges.
 *
 * Supports Chinese and English:
 *   "7月9号" / "7月9日" → exact date
 *   "今天" / "明天" / "后天" / "昨天"
 *   "这周" / "本周" / "下周"
 *   "最近" / "这几天"
 *   "July 9" / "Jul 9"
 *
 * Based on IA-RAG (Interval Algebra Driven Temporal Reasoning, 2025) and
 * Chronos multi-resolution temporal normalization principles.
 */

export interface TemporalSpan {
  /** Exact single day */
  exact?: Date;
  /** Range: [start, end] inclusive */
  rangeStart?: Date;
  rangeEnd?: Date;
  /** True when any date was extracted */
  hasDate: boolean;
  /** Human-readable label for this span, e.g. "7月9日" */
  label: string;
}

const MONTH_NAMES = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function mondayOf(d: Date): Date {
  const dow = d.getDay() || 7; // 1=Mon ... 7=Sun
  return addDays(dayStart(d), 1 - dow);
}

export function parseTemporalQuery(query: string): TemporalSpan {
  const now = new Date();
  const today = dayStart(now);

  // ── Relative single days ───────────────────────────────────────────────────
  if (/今天|今日/.test(query)) {
    return { exact: today, hasDate: true, label: '今天' };
  }
  if (/明天|明日/.test(query)) {
    const d = addDays(today, 1);
    return { exact: d, hasDate: true, label: '明天' };
  }
  if (/后天/.test(query)) {
    const d = addDays(today, 2);
    return { exact: d, hasDate: true, label: '后天' };
  }
  if (/昨天|昨日/.test(query)) {
    const d = addDays(today, -1);
    return { exact: d, hasDate: true, label: '昨天' };
  }

  // ── Chinese month+day: "X月Y号" / "X月Y日" ─────────────────────────────────
  const myChinese = query.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]/);
  if (myChinese) {
    const month = parseInt(myChinese[1]) - 1; // 0-indexed
    const day = parseInt(myChinese[2]);
    let d = new Date(now.getFullYear(), month, day);
    // If more than 30 days in the past, assume next year
    if (d.getTime() < today.getTime() - 30 * 86_400_000) d = new Date(d.getFullYear() + 1, month, day);
    return {
      exact: dayStart(d),
      hasDate: true,
      label: `${myChinese[1]}月${myChinese[2]}日`,
    };
  }

  // ── English: "July 9", "Jul 9", "july 9th" ────────────────────────────────
  const myEnglish = query.match(
    /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?/i,
  );
  if (myEnglish) {
    const mIdx = MONTH_NAMES.indexOf(myEnglish[0].slice(0, 3).toLowerCase());
    if (mIdx >= 0) {
      let d = new Date(now.getFullYear(), mIdx, parseInt(myEnglish[1]));
      if (d.getTime() < today.getTime() - 30 * 86_400_000) d = new Date(d.getFullYear() + 1, mIdx, parseInt(myEnglish[1]));
      return {
        exact: dayStart(d),
        hasDate: true,
        label: myEnglish[0].replace(/\s+/, ' '),
      };
    }
  }

  // ── Weeks ──────────────────────────────────────────────────────────────────
  if (/下周|下星期|next week/i.test(query)) {
    const monday = addDays(mondayOf(today), 7);
    const sunday = addDays(monday, 6);
    return { rangeStart: monday, rangeEnd: sunday, hasDate: true, label: '下周' };
  }
  if (/这周|本周|这个星期|本星期|this week/i.test(query)) {
    const monday = mondayOf(today);
    const sunday = addDays(monday, 6);
    return { rangeStart: monday, rangeEnd: sunday, hasDate: true, label: '本周' };
  }

  // ── "最近" / "这几天" → last 7 days ────────────────────────────────────────
  if (/最近|这几天|近期/.test(query)) {
    return {
      rangeStart: addDays(today, -7),
      rangeEnd: today,
      hasDate: true,
      label: '最近7天',
    };
  }

  return { hasDate: false, label: '' };
}

// ── Span factories ─────────────────────────────────────────────────────────────
// Use these instead of hand-rolled "tomorrow 00:00 <= d < dayAfter" comparisons.

export function todaySpan(now: Date = new Date()): TemporalSpan {
  return { exact: dayStart(now), hasDate: true, label: '今天' };
}

export function tomorrowSpan(now: Date = new Date()): TemporalSpan {
  return { exact: addDays(dayStart(now), 1), hasDate: true, label: '明天' };
}

/** [today, today+days] inclusive — e.g. nextDaysSpan(7) = the coming week. */
export function nextDaysSpan(days: number, now: Date = new Date()): TemporalSpan {
  const start = dayStart(now);
  return { rangeStart: start, rangeEnd: addDays(start, days), hasDate: true, label: `未来${days}天` };
}

/** True if Date d falls on the same calendar day as target */
export function isSameDay(d: Date, target: Date): boolean {
  return (
    d.getFullYear() === target.getFullYear() &&
    d.getMonth() === target.getMonth() &&
    d.getDate() === target.getDate()
  );
}

/** True if Date d (day-only) is within [start, end] inclusive */
export function isInSpan(d: Date, span: TemporalSpan): boolean {
  const day = dayStart(d);
  if (span.exact) return isSameDay(day, span.exact);
  if (span.rangeStart && span.rangeEnd) {
    return day >= dayStart(span.rangeStart) && day <= dayStart(span.rangeEnd);
  }
  return false;
}
