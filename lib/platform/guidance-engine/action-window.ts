/**
 * Action Window — Layer 3 of the Guidance Pipeline
 *
 * The key question: "Is NOW the right time to act?"
 * Not "is this important?" — that's Layer 2.
 * Not "should I interrupt?" — that's Layer 4.
 *
 * Each event type has a time-based window. Outside the window → 'closed'.
 * Inside the window, urgency increases as the deadline approaches.
 *
 * Design principle: earlier is usually NOT better.
 * A flight reminder three days before takeoff is noise.
 * A flight reminder 20 hours before is the check-in window — useful.
 */

import type { GuidanceEvent, WindowUrgency } from './types';

export function getActionWindow(event: GuidanceEvent, now: Date): WindowUrgency {
  const { type, scheduledAt } = event;

  // Events without a scheduled time use type-based heuristics
  if (!scheduledAt) return getUnscheduledWindow(event, now);

  const msUntil = scheduledAt.getTime() - now.getTime();
  const hoursUntil = msUntil / 3_600_000;
  const daysUntil = msUntil / 86_400_000;

  switch (type) {
    case 'flight':
      // Too far ahead: user can't act yet (packing, check-in not open)
      // Too close: don't add stress, they're already on the way
      if (hoursUntil < 0 || hoursUntil > 48) return 'closed';
      if (hoursUntil < 2) return 'closed';       // already heading there
      if (hoursUntil < 4) return 'critical';     // must leave now
      if (hoursUntil < 26) return 'high';        // check-in window (24h opens)
      return 'low';                               // 26-48h: light prep nudge

    case 'travel':
      if (daysUntil < 0 || daysUntil > 3) return 'closed';
      if (daysUntil < 0.25) return 'critical';
      if (daysUntil < 1) return 'high';
      return 'medium';

    case 'medical':
    case 'meeting':
      if (hoursUntil < 0) return 'closed';
      if (hoursUntil < 0.5) return 'closed';    // < 30min: no time to act
      if (hoursUntil < 1) return 'critical';    // 30–60min: must prepare now
      if (hoursUntil < 2) return 'high';        // 1–2h: good preparation window
      if (hoursUntil < 4) return 'medium';      // 2–4h: still useful (prep materials, links)
      return 'closed';                           // 4h+: user sees it on their calendar — no nudge needed

    case 'deadline':
      if (daysUntil < 0) return 'closed';       // past due → dormant engine's job
      if (daysUntil < 0.5) return 'critical';
      if (daysUntil < 1) return 'high';
      if (daysUntil < 2) return 'medium';
      return 'closed';                           // 2+ days out: not yet

    case 'expiry':
      // scheduledAt = 有效期当天 23:59(批次 65)—— daysUntil<1 即「今天到期」
      if (daysUntil < 0) return 'closed';        // 已过期 → 不再打扰,回顾的事
      if (daysUntil < 1) return 'critical';      // 今天到期:今天就得用掉/处理
      if (daysUntil < 2) return 'high';          // 明天到期
      return 'closed';

    case 'birthday':
    case 'anniversary':
      if (daysUntil < 0) return 'closed';
      if (daysUntil < 0.5) return 'critical';   // today
      if (daysUntil < 1.5) return 'high';       // tomorrow
      if (daysUntil < 3) return 'medium';       // 2-3 days: time to prepare
      if (daysUntil < 7) return 'low';          // this week: early notice
      return 'closed';

    case 'holiday':
      // 节日提示只在今明两天出现:今天放假(critical 文案=今天是)或明天放假(high=明天是)
      if (daysUntil < -0.5) return 'closed';
      if (daysUntil < 0.5) return 'critical';
      if (daysUntil < 1.5) return 'high';
      return 'closed';

    default:
      // Generic: only if within 24h
      if (daysUntil >= 0 && daysUntil < 1) return 'medium';
      return 'closed';
  }
}

function getUnscheduledWindow(event: GuidanceEvent, now: Date): WindowUrgency {
  const hour = now.getHours();

  switch (event.type) {
    case 'weather_cold':
    case 'weather_rain':
      // Only useful in the morning before leaving the house
      return (hour >= 6 && hour <= 10) ? 'medium' : 'closed';

    case 'email_signal':
      // Email signals are always "just received" — medium urgency for the day
      return 'medium';

    case 'health_habit':
      // Useful during waking hours, not late night
      return (hour >= 7 && hour <= 21) ? 'low' : 'closed';

    case 'dec_insight':
      // Evidence-gated recommendation — relevant through the waking day
      return (hour >= 7 && hour <= 22) ? 'medium' : 'closed';

    case 'domain_insight':
      // 域信号(健康/财务)温和提示,清醒时段出;红旗(payload.severity)白天窗口更高一点
      if (hour < 7 || hour > 22) return 'closed';
      return event.payload.severity === 'flag' ? 'medium' : 'low';

    default:
      return 'low';
  }
}
