/**
 * Guidance Engine — core types
 *
 * GuidanceEvent: a raw event from any source (calendar, email, memory, weather)
 * GuidanceCard:  a card that has passed all pipeline layers and is ready to show
 */

export type GuidanceEventType =
  | 'flight' | 'medical' | 'deadline' | 'birthday' | 'anniversary'
  | 'expiry'           // 物品有效期(批次 65)—— 不是任务截止,口吻是「记得用掉」而非「完成第一步」
  | 'renewal'          // 证件续期/保修到期(批次197)—— 长周期(提前半年催),口吻是「趁早续/送修」
  | 'travel' | 'meeting' | 'holiday'
  | 'email_signal' | 'health_habit'
  | 'domain_insight'   // 各域判定(健康/财务/…)接地成的主动卡 — 全部 payload 驱动(domain/icon/severity/双语文案),新增域零管线改动
  | 'weather_cold' | 'weather_rain'
  | 'object_context'   // 物品关联情境 — owned item relevant to an upcoming context
  | 'dec_insight';     // DEC 域引擎推荐卡(证据门控,PRD TODAY-002)

export type GuidanceSource = 'calendar' | 'email' | 'memory' | 'weather' | 'habit' | 'llm_sweep';

export interface GuidanceEvent {
  id: string;
  type: GuidanceEventType;
  title: string;
  scheduledAt?: Date;  // when the thing happens (flight time, birthday, meeting start, etc.)
  source: GuidanceSource;
  payload: Record<string, unknown>;  // source-specific data for action building
  // Confidence in the data source (0-100). Drives Priority Engine Layer 4.
  // calendar/email/user-created=90, weather=65, habit=60, AI inference=30.
  // Events below 50 are suppressed from Future Guidance.
  confidence?: number;
}

// How bad is it if the user does nothing?
// 0 = no real consequence, 3 = serious (miss flight, miss deadline)
export type ConsequenceSeverity = 0 | 1 | 2 | 3;

// Is the action window currently open?
// 'closed' = not the right time yet (or already too late)
export type WindowUrgency = 'closed' | 'low' | 'medium' | 'high' | 'critical';

// How much of today's attention is already committed to calendar events
export type AttentionBudget = 'ample' | 'limited' | 'exhausted';

export interface GuidanceAction {
  label: string;       // 1-minute first step, shown in card body
  cta: string;         // button text
  actionType: 'dismiss' | 'snooze' | 'done';
}

import type { EvidenceRef } from '@/lib/portal/reasoning-engine';

export interface GuidanceCard {
  id: string;
  eventId: string;
  type: GuidanceEventType;
  icon: string;
  title: string;
  body: string;
  action: GuidanceAction;
  priority: number;    // 0–10, derived from consequence × urgency matrix
  nodeId?: string;
  // When the action window closes and this card becomes irrelevant (Google Now principle).
  // Cards past their expiry are filtered out before rendering, even if cooling hasn't expired.
  expiresAt?: Date;
  /** Traceable evidence behind this card (PRD TODAY-002) — expandable in UI. */
  evidence?: EvidenceRef[];
  /** One-line 为什么现在出现 explanation. */
  reason?: string;
}
