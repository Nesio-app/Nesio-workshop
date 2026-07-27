'use client';

/**
 * LearningStatusPanel — 学习透明面板(批次 55;2026-07-27 收口)。
 * 展示 Preference / Baseline / 反馈事实 —— 不再夸张展示 ranker「学了 N 次」。
 */

import { useEffect, useState } from 'react';
import { getBestInterruptionHours } from '@/lib/portal/mirror-profile';
import { getWeights, baseline, readFeedbackLog } from '@/lib/platform/personalization';
import { aiCacheCount } from '@/lib/portal/ai-cache';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

const DOMAIN_LABEL: Record<string, [string, string]> = {
  health: ['健康', 'Health'], finance: ['财务', 'Finance'], location: ['活动', 'Places'],
  inventory: ['收纳', 'Inventory'], mood: ['心情', 'Mood'],
};

export default function LearningStatusPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [hours, setHours] = useState<number[]>([]);
  const [aiLearned, setAiLearned] = useState(0);
  const [topDomain, setTopDomain] = useState<{ key: string; w: number } | null>(null);
  const [energyBase, setEnergyBase] = useState<number | null>(null);
  const [feedbackFacts, setFeedbackFacts] = useState(0);

  useEffect(() => {
    setHours(getBestInterruptionHours().slice(0, 3).sort((a, b) => a - b));
    setAiLearned(aiCacheCount('decompose') + aiCacheCount('draft-reply') + aiCacheCount('guidance-lang'));
    const dw = Object.entries(getWeights('domain')).sort((a, b) => b[1] - a[1])[0];
    setTopDomain(dw && dw[1] >= 0.62 ? { key: dw[0], w: Math.round(dw[1] * 100) / 100 } : null);
    const eb = baseline('energy');
    setEnergyBase(!eb.cold && eb.center != null ? Math.round(eb.center) : null);
    setFeedbackFacts(readFeedbackLog().length);
  }, []);

  const hourLabel = hours.map((h) => `${h}:00`).join(' · ');
  const hasAnything = Boolean(hourLabel || topDomain || energyBase != null || aiLearned > 0 || feedbackFacts > 0);

  return (
    <div className="nesio-fit-panel" style={{ marginBottom: 'var(--space-3)' }}>
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, 'Nesio 记得的偏好', 'What Nesio remembers')}</p>

      {!hasAnything ? (
        <p className="nesio-settings-option-hint" style={{ margin: 0 }}>
          {L(dict,
            '对推给你的卡片点几次「有用 / 太多」,题材口味与时段偏好会慢慢成形。排序仍用规则 + 冷却,不会假装「学了几百次」。',
            'Tap Useful / Too much on a few cards and topic + hour preferences gently form. Ranking stays rules + cooling — no fake “learned N times”.')}
        </p>
      ) : (
        <>
          {hourLabel && (
            <p className="nesio-health-story-line" style={{ marginTop: 0 }}>
              {L(dict, `你更愿意被提醒的时段:${hourLabel}。`, `You're more receptive around: ${hourLabel}.`)}
            </p>
          )}
          {topDomain && (
            <p className="nesio-health-story-line">
              {L(dict,
                `题材口味偏「${DOMAIN_LABEL[topDomain.key]?.[0] ?? topDomain.key}」。`,
                `Topic preference leans toward "${DOMAIN_LABEL[topDomain.key]?.[1] ?? topDomain.key}".`)}
            </p>
          )}
          {energyBase != null && (
            <p className="nesio-health-story-line">
              {L(dict, `精力基线 ≈ ${energyBase}(跟自己比)。`, `Energy baseline ≈ ${energyBase} (vs yourself).`)}
            </p>
          )}
          {aiLearned > 0 && (
            <p className="nesio-health-story-line">
              {L(dict,
                `本机缓存了 ${aiLearned} 条 AI 答复(拆任务 / 起草 / 文案),离线可复用。`,
                `Cached ${aiLearned} AI answer${aiLearned > 1 ? 's' : ''} on-device (split / draft / phrase).`)}
            </p>
          )}
        </>
      )}

      <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-2) 0 0' }}>
        {L(dict,
          `全部在本机 · 不上传${feedbackFacts > 0 ? ` · ${feedbackFacts} 条反馈已记成可回放事实` : ''} · Today 排序 = 规则分 + 偏好 + 冷却`,
          `On-device only${feedbackFacts > 0 ? ` · ${feedbackFacts} replayable feedback facts` : ''} · Today rank = rules + preference + cooling`)}
      </p>
    </div>
  );
}
