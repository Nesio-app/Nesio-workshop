'use client';

/**
 * LearningStatusPanel — 学习透明面板(批次 55)。
 * 把本地学习过程摊开给用户看:引导排序学习器学了多少次、现在最看重哪个信号、
 * 以及 mirror 学到你最爱理提醒的时段。符合 Nesio 一贯的诚实风格 —— 不假装,可见。
 */

import { useEffect, useState } from 'react';
import { getRankerStats } from '@/lib/platform/guidance-engine/guidance-ranker';
import { getBestInterruptionHours } from '@/lib/portal/mirror-profile';
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

export default function LearningStatusPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [stats, setStats] = useState<ReturnType<typeof getRankerStats> | null>(null);
  const [hours, setHours] = useState<number[]>([]);

  useEffect(() => {
    setStats(getRankerStats());
    setHours(getBestInterruptionHours().slice(0, 3).sort((a, b) => a - b));
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

      <p className="nesio-settings-option-hint" style={{ margin: '0.35rem 0 0' }}>
        {L(dict, '全部在本机学习 · 不上传 · 冷启动就等于通用规则,只会越用越贴合你',
          'Learns on-device · never uploaded · starts equal to the default rules, only gets more fitted to you')}
      </p>
    </div>
  );
}
