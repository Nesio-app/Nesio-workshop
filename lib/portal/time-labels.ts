/**
 * Time Labels — the single source of relative-time copy.
 *
 * Replaces five scattered implementations (focusTimeHint, memory-narrator's
 * timeLabel + commitment due label, location-store's formatLocationAge,
 * daily-brief fallback copy) so "3 天后 / 2 小时前" reads the same everywhere.
 * 批次 9:locale 参数,英文界面输出英文("3 days ago / in 2 hours")。
 */

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** "刚刚 / N分钟前 / N小时前 / N天前 / N个月前 / N年前" */
export function relativePastLabel(then: Date | string | number, now: number = Date.now(), locale: string = 'zh'): string {
  const t = typeof then === 'number' ? then : new Date(then).getTime();
  const diff = Math.max(0, now - t);
  const en = locale === 'en';
  if (diff < 2 * MIN) return en ? 'just now' : '刚刚';
  if (diff < HOUR) { const n = Math.round(diff / MIN); return en ? `${n} min ago` : `${n} 分钟前`; }
  if (diff < DAY) { const n = Math.round(diff / HOUR); return en ? `${n} hr ago` : `${n} 小时前`; }
  const days = Math.floor(diff / DAY);
  if (days < 30) return en ? `${days} day${days > 1 ? 's' : ''} ago` : `${days} 天前`;
  if (days < 365) { const n = Math.floor(days / 30); return en ? `${n} month${n > 1 ? 's' : ''} ago` : `${n} 个月前`; }
  const y = Math.floor(days / 365);
  return en ? `${y} year${y > 1 ? 's' : ''} ago` : `${y} 年前`;
}

/**
 * "已过期 / 今天 / 明天 / 后天 / N天后 / 约N周后" — calendar-day based.
 *
 * 2026-07-30:纯日期串('YYYY-MM-DD')原来会被 `new Date()` 当成 **UTC 零点**解析 ——
 * 在 UTC-5 那就是本地前一天 19:00,于是「今天到期」显示成「已过期」、
 * 「明天」显示成「今天」。日期串必须按**本地自然日**解析,它本来就没有时刻。
 * 带时刻的输入维持原判定(今天早上 9 点、现在下午 3 点 → 确实已过期)。
 */
export function relativeFutureLabel(target: Date | string | number, now: Date = new Date(), locale: string = 'zh'): string {
  const dateOnly = typeof target === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(target);
  const d = dateOnly
    ? new Date(Number(target.slice(0, 4)), Number(target.slice(5, 7)) - 1, Number(target.slice(8, 10)))
    : new Date(target as Date | number);
  const en = locale === 'en';
  if (!dateOnly && d.getTime() < now.getTime()) return en ? 'overdue' : '已过期';
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayStart(d) - dayStart(now)) / DAY);
  if (dateOnly && diffDays < 0) return en ? 'overdue' : '已过期';
  if (diffDays <= 0) return en ? 'today' : '今天';
  if (diffDays === 1) return en ? 'tomorrow' : '明天';
  if (diffDays === 2) return en ? 'in 2 days' : '后天';
  if (diffDays <= 7) return en ? `in ${diffDays} days` : `${diffDays} 天后`;
  const w = Math.round(diffDays / 7);
  return en ? `in ~${w} week${w > 1 ? 's' : ''}` : `约 ${w} 周后`;
}

/**
 * Rich hint for near-term scheduled items: keeps clock time and a countdown
 * when the moment is close ("14:30 · 还有 25 分钟"), falls back to day labels.
 */
export function scheduleHint(target: Date, now: Date = new Date(), locale: string = 'zh'): string {
  const diffMs = target.getTime() - now.getTime();
  const en = locale === 'en';
  const hasTime = target.getHours() !== 0 || target.getMinutes() !== 0;
  const timeStr = hasTime
    ? target.toLocaleTimeString(en ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '';
  if (diffMs < 0) return en ? 'overdue' : '已过期';
  if (hasTime && diffMs < HOUR) {
    const m = Math.round(diffMs / MIN);
    return en ? `${timeStr} · in ${m} min` : `${timeStr} · 还有 ${m} 分钟`;
  }
  if (hasTime && diffMs < 8 * HOUR) {
    const hrs = Math.floor(diffMs / HOUR);
    const mins = Math.round((diffMs % HOUR) / MIN);
    const span = `${hrs > 0 ? `${hrs}h` : ''}${mins > 0 ? `${mins}m` : ''}`;
    return en ? `${timeStr} · in ${span}` : `${timeStr} · 还有 ${span}`;
  }
  const dayLabel = relativeFutureLabel(target, now, locale);
  if ((dayLabel === '今天' || dayLabel === '明天' || dayLabel === 'today' || dayLabel === 'tomorrow') && hasTime) return `${dayLabel} ${timeStr}`;
  return dayLabel;
}
