/**
 * Proactive card 共享类型与本地存储 helpers(dismiss / snooze / 时间兜底)。
 * 从 TodayFeed 拆出(工程 PRD 组件阈值整改)。
 */

import type { EvidenceRef } from '@/lib/portal/reasoning-engine';
import type { RecommendationCard } from '@/lib/portal/reasoning-engine';

export interface ProactiveAction {
  label: string;
  actionType: 'dismiss' | 'snooze' | 'done';
}

export interface ProactiveCardData {
  id: string;
  title: string;
  body: string;
  confidence: number;
  sourceTags: string[];
  icon: string;
  priority: number;
  cardType?: string;
  nodeId?: string;
  actions?: ProactiveAction[];
  expiresAt?: string;  // ISO — card auto-hides after this time (Google Now lifecycle)
  /** Traceable evidence (PRD TODAY-002) — rendered as an expandable 依据 section. */
  evidence?: EvidenceRef[];
  /** 为什么现在出现 one-liner. */
  reason?: string;
}


// Time-based fallback nudge — only shown when the guidance pipeline produces nothing
export function buildTimeFallback(now: Date): ProactiveCardData | null {
  const dow = now.getDay();
  const hour = now.getHours();
  if (dow === 1 && hour < 11) {
    return { id: 'fallback-week-start', title: '新的一周从规划开始', body: '周一早上，把本周最重要的 3 件事先记下来。', confidence: 70, sourceTags: ['时间·周一'], icon: '🗓', priority: 5 };
  }
  if (dow === 5 && hour >= 15) {
    return { id: 'fallback-week-end', title: '本周还有什么没收尾？', body: '周五下午，快速过一遍本周待办，周末才能真正放松。', confidence: 70, sourceTags: ['时间·周五'], icon: '✅', priority: 5 };
  }
  if (hour >= 21) {
    return { id: 'fallback-evening', title: '今天有什么想记下来的？', body: '睡前花 30 秒，把今天的想法或待办存进来。', confidence: 65, sourceTags: ['时间·晚间'], icon: '🌙', priority: 4 };
  }
  return null;
}


const SNOOZE_KEY = 'nesio-snoozed-overdue';

export function snoozeOverdue(nodeId: string, days: number) {
  try {
    const map: Record<string, string> = JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}');
    const until = new Date();
    until.setDate(until.getDate() + days);
    map[nodeId] = until.toISOString();
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}


// ---- Proactive card dismiss helpers ----

const PROACTIVE_DISMISS_KEY = 'nesio-proactive-dismissed';

export function dismissProactiveById(cardId: string) {
  try {
    const map: Record<string, string> = JSON.parse(localStorage.getItem(PROACTIVE_DISMISS_KEY) || '{}');
    map[cardId] = new Date().toISOString().slice(0, 10);
    localStorage.setItem(PROACTIVE_DISMISS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

export function isProactiveCardDismissed(cardId: string): boolean {
  try {
    const map: Record<string, string> = JSON.parse(localStorage.getItem(PROACTIVE_DISMISS_KEY) || '{}');
    return map[cardId] === new Date().toISOString().slice(0, 10);
  } catch { return false; }
}

// ── DEC 卡登记表(反馈环回写用)─────────────────────────────────────────────
// Today 渲染的是 GuidanceCard 投影,evidenceSignalIds 等字段不进渲染层。
// 反馈(TODAY-004)要写回 signal 反馈环(recordSignalFeedback)需要完整
// RecommendationCard——管线每轮登记,反馈时按 guidance 卡 id 取回,
// evidenceSignalIds 随完整卡保全(契约 todayCardsRequireEvidenceSignalIds)。

const decCardRegistry = new Map<string, RecommendationCard>();

export function registerDecCards(cards: readonly RecommendationCard[]): void {
  decCardRegistry.clear();
  for (const card of cards) decCardRegistry.set(`guidance-dec-${card.id}`, card);
}

export function getRegisteredDecCard(guidanceCardId: string): RecommendationCard | undefined {
  return decCardRegistry.get(guidanceCardId);
}

// ── 主动提醒程度(设置 → 通用):控制 Today 主动卡数量 ─────────────────────
// proactive=3(与 TODAY_CARD_BUDGET 一致)/ minimal=1 / silent=0。
// GeneralSheet 写入并广播 'nesio-proactive-level-changed'。

export const PROACTIVE_LEVEL_KEY = 'nesio-proactive-level-v1';

export function getProactiveCardBudget(): number {
  if (typeof window === 'undefined') return 3;
  try {
    const level = localStorage.getItem(PROACTIVE_LEVEL_KEY);
    if (level === 'silent') return 0;
    if (level === 'minimal') return 1;
  } catch { /* ignore */ }
  return 3;
}
