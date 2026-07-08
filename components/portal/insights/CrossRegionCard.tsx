'use client';

/**
 * 跨区洞察卡 —— 洞察 tab 跨区明细(输出口定稿 §7 + cross-region-reasoning.md P1/P1.5)。
 * 纯统计跨域关系:Spearman 秩相关 + DF 平稳性 + 共现 + BH-FDR;P1.5 再加先后线索
 * (lead-lag,滞后互相关)。每条带证据(样本天数 + p 值 [+ 滞后天数])可人工复核。
 * 相关/先后都≠因果,文案里说明。
 */

import { useEffect, useState } from 'react';
import { buildCrossRegionInsights, buildLeadLagInsights, type CrossRegionInsight } from '@/lib/platform/cross-region/detect';
import { getConsentedDomains, setDomainConsent, SENSITIVE_DELIVERY_DOMAINS } from '@/lib/platform/cross-region/consent';
import { getCrossRegionBanditStats } from '@/lib/platform/cross-region/bandit';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { InfoTip } from '../InfoTip';

function InsightList({ items, privateTip }: { items: CrossRegionInsight[]; privateTip: string }) {
  return (
    <ul className="nesio-xr-list">
      {items.map((it) => (
        <li key={it.id} className={`nesio-xr-item${it.strength >= 0 ? ' is-pos' : ' is-neg'}`}>
          <div className="nesio-xr-head">
            <span className="nesio-xr-title">{it.headline}</span>
            {it.sensitive && <span className="nesio-xr-tag" title={privateTip}>{privateTip.split('(')[0]}</span>}
          </div>
          <p className="nesio-xr-detail">{it.detail}</p>
          <p className="nesio-xr-evidence">{it.evidence}</p>
        </li>
      ))}
    </ul>
  );
}

export default function CrossRegionCard() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [ready, setReady] = useState(false);
  const [insights, setInsights] = useState<CrossRegionInsight[]>([]);
  const [leadLag, setLeadLag] = useState<CrossRegionInsight[]>([]);
  const [pushSensitive, setPushSensitive] = useState(false);
  const [learn, setLearn] = useState<{ updates: number; typeWeights: Record<string, number> } | null>(null);

  useEffect(() => {
    setPushSensitive(SENSITIVE_DELIVERY_DOMAINS.every((d) => getConsentedDomains().has(d)));
    try { setLearn(getCrossRegionBanditStats()); } catch { setLearn(null); }
  }, []);

  function toggleSensitivePush() {
    const next = !pushSensitive;
    setPushSensitive(next);
    for (const d of SENSITIVE_DELIVERY_DOMAINS) setDomainConsent(d, next);
  }

  useEffect(() => {
    // ensureFactJournal 会读足迹/银行/心情等历史,放到 effect 里避免阻塞首屏渲染。
    let alive = true;
    const id = window.setTimeout(() => {
      const loc = dict === 'en' ? 'en' : 'zh';
      try {
        const out = buildCrossRegionInsights(loc);
        if (alive) setInsights(out);
      } catch { if (alive) setInsights([]); }
      try {
        const ll = buildLeadLagInsights(loc);
        if (alive) setLeadLag(ll);
      } catch { if (alive) setLeadLag([]); }
      if (alive) setReady(true);
    }, 60);
    return () => { alive = false; window.clearTimeout(id); };
  }, [dict]);

  const privateTip = L(dict, '私密(涉及敏感域:健康/财务/位置,仅本机本人可见)', 'private (sensitive domain: health/finance/location; on-device, yours only)');

  return (
    <div className="nesio-xr">
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>
        {L(dict, '跨区洞察', 'Cross-domain patterns')}
        <InfoTip text={L(dict,
          '把地点/支出/心情/健康/训练等各域拉成每日序列,用统计(Spearman 相关 + 平稳性检验 + 共现 + 多重检验校正)找真正跨域的关联。每条带样本天数与 p 值可复核;相关不代表因果,只是值得留意的线索。数据攒够(≥14 天两域都有)才会出。',
          'It aligns each domain (places / spending / mood / health / workouts) into daily series and uses statistics (Spearman correlation + stationarity test + co-occurrence + multiple-testing correction) to surface genuine cross-domain links. Each shows sample days and a p-value for review; correlation is not causation. Appears once there are ≥14 days with both domains present.')} />
      </p>

      {!ready ? (
        <p className="nesio-settings-option-hint">{L(dict, '正在分析跨区关联…', 'Analyzing cross-domain links…')}</p>
      ) : insights.length === 0 ? (
        <p className="nesio-settings-option-hint">
          {L(dict,
            '还没发现稳定的跨区关联。需要至少 14 天里两个不同领域都有数据(比如足迹 + 心情、支出 + 训练);积累够了这里会自动出现,并附样本量和显著性。',
            'No stable cross-domain links yet. Needs ≥14 days where two different domains both have data (e.g. places + mood, spending + workouts). They appear here automatically once there is enough, with sample size and significance.')}
        </p>
      ) : (
        <InsightList items={insights} privateTip={privateTip} />
      )}

      {/* P1.5 先后线索(lead-lag)——有才显示,不占空位 */}
      {ready && leadLag.length > 0 && (
        <>
          <p className="nesio-settings-section-label">
            {L(dict, '先后线索', 'Lead-lag hints')}
            <InfoTip text={L(dict,
              '在跨域关联里进一步找「一个域先变、另一个域约几天后跟着变」的时序线索(滞后互相关 + 平稳化 + 显著性校正,且滞后关联须强于同期)。先后≠因果——它只提示值得观察的方向,不证明谁导致谁。',
              'Within cross-domain links, this looks for timing hints — one domain shifts, another follows a few days later (lagged correlation + stationarization + significance correction; the lag must beat the same-day correlation). Lead-lag is not causation — it only points at a direction worth watching.')} />
          </p>
          <InsightList items={leadLag} privateTip={privateTip} />
        </>
      )}

      {/* P3 透明面板:bandit 从你的反馈学到更爱看哪类跨区 */}
      {ready && learn && (insights.length > 0 || leadLag.length > 0) && (() => {
        const entries = Object.entries(learn.typeWeights);
        const top = entries.reduce((a, b) => (b[1] > a[1] ? b : a), ['', -Infinity] as [string, number]);
        const topEn: Record<string, string> = { 相关: 'correlations', 共现: 'co-occurrences', 先后: 'lead-lag hints' };
        return (
          <p className="nesio-xr-learn">
            <InfoTip text={L(dict,
              '这块按你的「有用/没用」反馈,用一个可解释的老虎机(LinUCB)学你更在乎哪类跨区,并据此排序主动投递。第一天按关联强弱排(不更差),你反馈越多它越懂你。全在本机、可随时被覆盖。',
              'This uses an explainable bandit (LinUCB) to learn which kinds of cross-domain links you care about from your useful/dismiss feedback, and orders proactive delivery accordingly. Day one it ranks by strength (no worse); the more you react, the better it fits. On-device, always correctable.')} />
            {learn.updates <= 0
              ? L(dict, '跨区偏好还在观察你的反馈 —— 你点「有用/没用」,它会学着优先给你看你在乎的那类。',
                  'Cross-domain preference is still watching your feedback — react useful/dismiss and it learns to prioritize what you care about.')
              : (top[1] > 0.01
                ? L(dict, `已从 ${learn.updates} 次反馈学习:目前你更常留意「${top[0]}」类关联。`,
                    `Learned from ${learn.updates} reaction(s): you engage most with ${topEn[top[0]] || top[0]}.`)
                : L(dict, `已从 ${learn.updates} 次反馈学习;各类还看不出明显偏好。`,
                    `Learned from ${learn.updates} reaction(s); no clear type preference yet.`))}
          </p>
        );
      })()}

      {/* 同意门(P2 §2.2):默认只在这里能看;开启后才把涉及健康/财务/位置的跨区关联主动推到今天 */}
      {ready && (insights.length > 0 || leadLag.length > 0) && (
        <button type="button" className="nesio-xr-consent" onClick={toggleSensitivePush} aria-pressed={pushSensitive}>
          <span className="nesio-xr-consent-box" aria-hidden>{pushSensitive ? '✓' : ''}</span>
          <span>{L(dict,
            '把涉及健康/财务/位置的跨区关联也主动推到「今天」(默认只在这里看)',
            'Also surface health/finance/location cross-domain links on Today (off by default; view-only here)')}</span>
        </button>
      )}
    </div>
  );
}
