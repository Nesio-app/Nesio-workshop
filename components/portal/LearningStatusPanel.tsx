'use client';

/**
 * LearningStatusPanel — 学习透明面板(批次 55;A 计划收尾扩成全局「app 学到了什么」)。
 * 把本地学习过程摊开给用户看:排序学习器/题材口味(Preference)/精力基线(Baseline)/
 * 反馈事实日志(可回放可删)/情境分化证据。符合 Nesio 一贯的诚实风格 —— 不假装,可见。
 */

import { useEffect, useState } from 'react';
import { getRankerStats, rankerContextEvidence, type ContextEvidence } from '@/lib/platform/guidance-engine/guidance-ranker';
import { getBestInterruptionHours } from '@/lib/portal/mirror-profile';
import { getWeights, baseline, readFeedbackLog } from '@/lib/platform/personalization';
import { aiCacheCount } from '@/lib/portal/ai-cache';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

const FEATURE_LABEL: Record<string, [string, string]> = {
  risk: ['风险严重度', 'Risk severity'],
  time: ['时效紧迫', 'Time-sensitivity'],
  prep: ['提前价值', 'Prep value'],
  confidence: ['数据可靠度', 'Data confidence'],
  relevance: ['来源相关', 'Source relevance'],
  hourFit: ['你的活跃时段', 'Your active hours'],
  domainFit: ['这类卡你爱不爱理', 'How you engage this type'],
};
// 冷启动先验(和 ranker 一致):偏移=当前权重-先验,用来说"它学到了什么"
const PRIOR: Record<string, number> = { risk: 0.30, time: 0.25, prep: 0.20, confidence: 0.15, relevance: 0.10, hourFit: 0, domainFit: 0 };

// 域标签(与 domain-insights 的口径一致)
const DOMAIN_LABEL: Record<string, [string, string]> = {
  health: ['健康', 'Health'], finance: ['财务', 'Finance'], location: ['活动', 'Places'],
  inventory: ['收纳', 'Inventory'], mood: ['心情', 'Mood'],
};

export default function LearningStatusPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [stats, setStats] = useState<ReturnType<typeof getRankerStats> | null>(null);
  const [hours, setHours] = useState<number[]>([]);
  const [aiLearned, setAiLearned] = useState(0);
  const [topDomain, setTopDomain] = useState<{ key: string; w: number } | null>(null);
  const [energyBase, setEnergyBase] = useState<number | null>(null);
  const [feedbackFacts, setFeedbackFacts] = useState(0);
  const [ctxDiverged, setCtxDiverged] = useState<ContextEvidence | null>(null);

  useEffect(() => {
    setStats(getRankerStats());
    setHours(getBestInterruptionHours().slice(0, 3).sort((a, b) => a - b));
    // 从 AI 的回复里存下多少条(拆任务/起草/文案)——AI 离线时能直接复用的"外脑记忆"
    setAiLearned(aiCacheCount('decompose') + aiCacheCount('draft-reply') + aiCacheCount('guidance-lang'));
    // Preference:学到的题材口味里,明显高于中性(0.5)的最强一项
    const dw = Object.entries(getWeights('domain')).sort((a, b) => b[1] - a[1])[0];
    setTopDomain(dw && dw[1] >= 0.62 ? { key: dw[0], w: Math.round(dw[1] * 100) / 100 } : null);
    // Baseline:精力个人基线(冷启动不展示 —— 不凭几条记录报数)
    const eb = baseline('energy');
    setEnergyBase(!eb.cold && eb.center != null ? Math.round(eb.center) : null);
    // 反馈事实日志(可回放/可导出/可删除)
    setFeedbackFacts(readFeedbackLog().length);
    // 情境分化证据:有类型亮灯才展示(证据不够不制造"它在分析你"的错觉)
    setCtxDiverged(rankerContextEvidence().find((e) => e.diverges) ?? null);
  }, []);

  if (!stats) return null;

  // 学到最多的:按"相对先验的偏移绝对值"排,偏移最大的就是它从你身上学到的最强信号
  const shifts = Object.entries(stats.weights)
    .map(([k, w]) => ({ k, w, shift: w - (PRIOR[k] ?? 0) }))
    .sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift));
  const top = shifts[0];

  const hourLabel = hours.map((h) => `${h}:00`).join(' · ');

  return (
    <div className="nesio-fit-panel" style={{ marginBottom: '0.75rem' }}>
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, 'Nesio 学到了什么', 'What Nesio has learned')}</p>

      {stats.n === 0 ? (
        <p className="nesio-settings-option-hint" style={{ margin: 0 }}>
          {L(dict,
            '排序学习器还没开始学 —— 对推给你的卡片点几次「有用 / 太多」,它就会从你的反馈里学你的偏好。现在用的是通用规则(和第一天一样)。',
            "The ranker hasn't started learning yet — tap Useful / Too much on a few cards and it'll learn your preferences from your feedback. For now it uses the default rules (same as day one).")}
        </p>
      ) : (
        <>
          <p className="nesio-health-story-line" style={{ marginTop: 0 }}>
            {L(dict, `已从你的 ${stats.n} 次反馈里学习。`, `Learned from your ${stats.n} feedback signal${stats.n > 1 ? 's' : ''}.`)}
          </p>
          {top && Math.abs(top.shift) > 0.05 && (
            <p className="nesio-health-story-line">
              {L(dict,
                `目前它最看重的是「${FEATURE_LABEL[top.k]?.[0] ?? top.k}」(比通用规则${top.shift > 0 ? '更' : '更不'}看重)。`,
                `Right now it weights "${FEATURE_LABEL[top.k]?.[1] ?? top.k}" ${top.shift > 0 ? 'more' : 'less'} than the default.`)}
            </p>
          )}
        </>
      )}

      {hourLabel && (
        <p className="nesio-health-story-line">
          {L(dict, `它觉得你最愿意被提醒的时段:${hourLabel}。`, `It thinks you're most receptive around: ${hourLabel}.`)}
        </p>
      )}

      {topDomain && (
        <p className="nesio-health-story-line">
          {L(dict,
            `最合你口味的题材:「${DOMAIN_LABEL[topDomain.key]?.[0] ?? topDomain.key}」(采纳度 ${topDomain.w})。`,
            `Your most-engaged topic: "${DOMAIN_LABEL[topDomain.key]?.[1] ?? topDomain.key}" (engagement ${topDomain.w}).`)}
        </p>
      )}

      {energyBase != null && (
        <p className="nesio-health-story-line">
          {L(dict, `你的精力基线 ≈ ${energyBase}(跟自己比,不跟别人比)。`, `Your energy baseline ≈ ${energyBase} (compared to yourself, not others).`)}
        </p>
      )}

      {ctxDiverged && (
        <p className="nesio-health-story-line">
          {L(dict,
            `发现「${DOMAIN_LABEL[ctxDiverged.type]?.[0] ?? ctxDiverged.type}」类提醒你在工作日和周末的反应明显不同(证据已够)—— 之后可以按情境分开学。`,
            `"${DOMAIN_LABEL[ctxDiverged.type]?.[1] ?? ctxDiverged.type}" cards get clearly different reactions on weekdays vs weekends (enough evidence) — context-aware learning can come next.`)}
        </p>
      )}

      {aiLearned > 0 && (
        <p className="nesio-health-story-line">
          {L(dict,
            `已从 AI 的回复里存下 ${aiLearned} 条(拆任务 / 起草 / 文案)。AI 离线时,同样的请求直接复用它给过的答案,不掉线。`,
            `Kept ${aiLearned} answer${aiLearned > 1 ? 's' : ''} from the AI (task-splitting / drafting / phrasing). When the AI is offline, the same request reuses what it gave before — no downtime.`)}
        </p>
      )}

      <p className="nesio-settings-option-hint" style={{ margin: '0.35rem 0 0' }}>
        {L(dict,
          `全部在本机学习 · 不上传${feedbackFacts > 0 ? ` · 你的 ${feedbackFacts} 条反馈已记成可回放的事实(随备份可导出,「彻底删除」一并清)` : ''} · 冷启动就等于通用规则,只会越用越贴合你`,
          `Learns on-device · never uploaded${feedbackFacts > 0 ? ` · your ${feedbackFacts} feedback facts are replayable (exported with backups, wiped by Delete all)` : ''} · starts equal to the default rules, only gets more fitted to you`)}
      </p>
    </div>
  );
}
