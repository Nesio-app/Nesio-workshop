/**
 * Time Labels — the single source of relative-time copy.
 *
 * Replaces five scattered implementations (focusTimeHint, memory-narrator's
 * timeLabel + commitment due label, location-store's formatLocationAge,
 * daily-brief fallback copy) so "3 天后 / 2 小时前" reads the same everywhere.
 */

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** "刚刚 / N分钟前 / N小时前 / N天前 / N个月前 / N年前" */
export function relativePastLabel(then: Date | string | number, now: number = Date.now()): string {
  const t = typeof then === 'number' ? then : new Date(then).getTime();
  const diff = Math.max(0, now - t);
  if (diff < 2 * MIN) return '刚刚';
  if (diff < HOUR) return `${Math.round(diff / MIN)} 分钟前`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} 小时前`;
  const days = Math.floor(diff / DAY);
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

/** "已过期 / 今天 / 明天 / 后天 / N天后 / 约N周后" — calendar-day based. */
export function relativeFutureLabel(target: Date | string | number, now: Date = new Date()): string {
  const d = typeof target === 'number' ? new Date(target) : new Date(target);
  if (d.getTime() < now.getTime()) return '已过期';
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayStart(d) - dayStart(now)) / DAY);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '明天';
  if (diffDays === 2) return '后天';
  if (diffDays <= 7) return `${diffDays} 天后`;
  return `约 ${Math.round(diffDays / 7)} 周后`;
}

/**
 * Rich hint for near-term scheduled items: keeps clock time and a countdown
 * when the moment is close ("14:30 · 还有 25 分钟"), falls back to day labels.
 */
export function scheduleHint(target: Date, now: Date = new Date()): string {
  const diffMs = target.getTime() - now.getTime();
  const hasTime = target.getHours() !== 0 || target.getMinutes() !== 0;
  const timeStr = hasTime
    ? target.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '';
  if (diffMs < 0) return '已过期';
  if (hasTime && diffMs < HOUR) {
    return `${timeStr} · 还有 ${Math.round(diffMs / MIN)} 分钟`;
  }
  if (hasTime && diffMs < 8 * HOUR) {
    const hrs = Math.floor(diffMs / HOUR);
    const mins = Math.round((diffMs % HOUR) / MIN);
    return `${timeStr} · 还有 ${hrs > 0 ? `${hrs}h` : ''}${mins > 0 ? `${mins}m` : ''}`;
  }
  const dayLabel = relativeFutureLabel(target, now);
  if ((dayLabel === '今天' || dayLabel === '明天') && hasTime) return `${dayLabel} ${timeStr}`;
  return dayLabel;
}
