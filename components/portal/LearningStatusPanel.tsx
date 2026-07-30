'use client';

/**
 * LearningStatusPanel — 学习透明面板(批次 55;2026-07-27 收口)。
 * 展示 Preference / Baseline / 反馈事实 —— 不再夸张展示 ranker「学了 N 次」。
 */

import { useEffect, useState } from 'react';
import { getBestInterruptionHours } from '@/lib/portal/mirror-profile';
import { getWeights, baseline, readFeedbackLog } from '@/lib/platform/personalization';
import { readCardVerdicts, clearCardVerdict, type VerdictListing } from '@/lib/portal/card-verdict';
import { aiCacheCount } from '@/lib/portal/ai-cache';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

const DOMAIN_LABEL: Record<string, [string, string]> = {
  health: ['健康', 'Health'], finance: ['财务', 'Finance'], location: ['活动', 'Places'],
  inventory: ['收纳', 'Inventory'], mood: ['心情', 'Mood'],
};

/** guidance 事件类型 → 人话(「别再说」清单里给用户看的,不能露 domain_insight 这种内部词)。 */
const CARD_TYPE_LABEL: Record<string, [string, string]> = {
  domain_insight: ['生活洞察', 'Life insight'], dec_insight: ['深度发现', 'Deep finding'],
  object_context: ['物品提醒', 'Item reminder'], renewal: ['续费到期', 'Renewals'],
  email_signal: ['邮件信号', 'Email signal'], overdue_task: ['待办逾期', 'Overdue task'],
  meeting_prep: ['会议准备', 'Meeting prep'], weather_alert: ['天气提醒', 'Weather'],
};

/** 卡 id → 尽量像人话:管线 id 形如 `guidance-finance-hike-att`,剥掉前缀留可读部分。 */
function cardKeyLabel(key: string, lang: 'zh' | 'en'): string {
  const bare = key.replace(/^guidance-(dec-)?/, '');
  return lang === 'zh' ? `这一条(${bare})` : `This card (${bare})`;
}

export default function LearningStatusPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [hours, setHours] = useState<number[]>([]);
  const [aiLearned, setAiLearned] = useState(0);
  const [topDomain, setTopDomain] = useState<{ key: string; w: number } | null>(null);
  const [energyBase, setEnergyBase] = useState<number | null>(null);
  const [feedbackFacts, setFeedbackFacts] = useState(0);
  // 「别再说」清单 —— 静音必须看得见也解得掉,否则用户点完就再也找不回那条提醒。
  const [verdicts, setVerdicts] = useState<VerdictListing[]>([]);

  useEffect(() => {
    setHours(getBestInterruptionHours().slice(0, 3).sort((a, b) => a - b));
    setAiLearned(aiCacheCount('decompose') + aiCacheCount('draft-reply') + aiCacheCount('guidance-lang'));
    const dw = Object.entries(getWeights('domain')).sort((a, b) => b[1] - a[1])[0];
    setTopDomain(dw && dw[1] >= 0.62 ? { key: dw[0], w: Math.round(dw[1] * 100) / 100 } : null);
    const eb = baseline('energy');
    setEnergyBase(!eb.cold && eb.center != null ? Math.round(eb.center) : null);
    setFeedbackFacts(readFeedbackLog().length);
    setVerdicts(readCardVerdicts());
  }, []);

  function undoVerdict(v: VerdictListing) {
    clearCardVerdict(v.scope, v.key);
    setVerdicts(readCardVerdicts());
  }

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

      {verdicts.length > 0 && (
        <>
          <p className="nesio-settings-section-label">{L(dict, '你让我先别说的', 'Things you asked me to hold')}</p>
          {verdicts.map((v) => (
            <div key={`${v.scope}:${v.key}`} className="nesio-health-story-line" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {v.scope === 'type'
                  ? L(dict, `「${CARD_TYPE_LABEL[v.key]?.[0] ?? v.key}」这一类`, `All "${CARD_TYPE_LABEL[v.key]?.[1] ?? v.key}" cards`)
                  : L(dict, cardKeyLabel(v.key, 'zh'), cardKeyLabel(v.key, 'en'))}
                {v.until ? L(dict, ` · 到 ${v.until.slice(5, 10)}`, ` · until ${v.until.slice(5, 10)}`) : L(dict, ' · 直到内容变化', ' · until it changes')}
              </span>
              <button type="button" className="nesio-unmute-btn" onClick={() => undoVerdict(v)}>
                {L(dict, '重新接收', 'Unmute')}
              </button>
            </div>
          ))}
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
