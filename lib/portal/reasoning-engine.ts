/**
 * Reasoning view-model types + feedback helpers (leaf module).
 *
 * The reasoning LOGIC now lives in lib/intelligence/dec.ts (the Decision Engine).
 * This file keeps only the UI view-model type (RecommendationCard), scoring, and
 * DEC 生命周期压制读口 —— 反馈事实只认 Signal(`feedback.*` / `readFeedbackLog`)。
 * 2026-07-27:删 `nesio-card-feedback-v1` 双轨。
 */

import { emitFeedback } from '@/lib/platform/personalization/feedback-bus';
import { readFeedbackLog } from '@/lib/platform/personalization/feedback-log';

export type CardDomain = 'weather' | 'work' | 'family' | 'home' | 'health' | 'vehicle' | 'learning' | 'finance';

export interface EvidenceRef {
  source: string;
  label: string;
  value: string;
  /** Traceable pointer to a Signal id when the evidence came from the Life Graph. */
  signalId?: string;
}

export interface RecommendationCard {
  id: string;
  domain: CardDomain;
  domainLabel: string;
  confidence: number;
  urgency: 1 | 2 | 3 | 4 | 5;
  icon: string;
  iconBg: string;
  title: string;
  body: string;
  tags?: string[];
  evidence: EvidenceRef[];
  /** Canonical Signal ids that explain why this card exists. Required before Today publication. */
  evidenceSignalIds?: string[];
  primaryAction: string;
  secondaryAction?: string;
  type: 'standard' | 'audio' | 'compact';
  expiresAt: string;
  sourceStatus?: 'user_record' | 'authorized_calendar' | 'demo_example' | 'needs_input';
  feedback?: 'useful' | 'wrong' | 'not_now' | 'too_much';
}

/** score = urgency * confidence * 0.5 + timing bonus */
export function scoreCard(card: RecommendationCard): number {
  const timingBonus = new Date(card.expiresAt).getTime() - Date.now() < 3_600_000 ? 0.2 : 0;
  return card.urgency * card.confidence * 0.5 + timingBonus;
}

// ── Feedback (Signal 投影) ──────────────────────────────────────

export type FeedbackRecord = { feedback: RecommendationCard['feedback']; at: string };

function reactionToCardFeedback(reaction: string): RecommendationCard['feedback'] | undefined {
  if (reaction === 'useful' || reaction === 'done') return 'useful';
  if (reaction === 'wrong') return 'wrong';
  if (reaction === 'too_much') return 'too_much';
  if (reaction === 'snooze' || reaction === 'dismiss') return 'not_now';
  return undefined;
}

/**
 * DEC 生命周期压制:从 Signal 反馈投影读「这张卡最近怎么说」。
 * 同 cardId 取最新一条;dimension=card 且 surface=today 优先,也认 today_card 投影。
 */
export function readCardFeedbackAll(): Record<string, FeedbackRecord> {
  if (typeof window === 'undefined') return {};
  try {
    const out: Record<string, FeedbackRecord> = {};
    // 日志升序;后写覆盖 → 最新胜
    for (const e of readFeedbackLog()) {
      if (e.dimension !== 'card' || !e.key) continue;
      const feedback = reactionToCardFeedback(e.reaction);
      if (!feedback) continue;
      out[e.key] = { feedback, at: e.at };
      // ProactiveGuidanceCard 会剥 guidance-dec- 前缀;双写一份归一 key
      const bare = e.key.replace(/^guidance-dec-/, '').replace(/^guidance-/, '');
      if (bare !== e.key) out[bare] = { feedback, at: e.at };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * UI 反馈唯一写口:进统一总线 → Signal `feedback.reaction`(及 Today 富路径 `feedback.today_card`)。
 * 不再写 `nesio-card-feedback-v1`。
 */
export function recordCardFeedback(cardId: string, feedback: RecommendationCard['feedback']): void {
  if (typeof window === 'undefined' || !feedback) return;
  const reaction =
    feedback === 'useful' ? 'useful'
      : feedback === 'wrong' ? 'wrong'
        : feedback === 'too_much' ? 'too_much'
          : 'snooze';
  try {
    emitFeedback({
      surface: 'today',
      dimension: 'card',
      key: cardId,
      reaction,
      at: new Date().toISOString(),
    });
    window.dispatchEvent(new CustomEvent('nesio-feedback-recorded', { detail: { cardId, feedback } }));
  } catch {
    /* 反馈失败不拖垮 UI;总线侧另有可见落库路径 */
  }
}
