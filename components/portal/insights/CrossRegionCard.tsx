'use client';

/**
 * 跨区洞察卡 —— 洞察 tab 跨区明细(输出口定稿 §7 + cross-region-reasoning.md P1)。
 * 纯统计跨域关系:Spearman 秩相关 + DF 平稳性 + 共现 + BH-FDR 多重检验,每条带
 * 证据(样本天数 + p 值)可人工复核。相关≠因果,文案里说明。
 */

import { useEffect, useState } from 'react';
import { buildCrossRegionInsights, type CrossRegionInsight } from '@/lib/platform/cross-region/detect';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { InfoTip } from '../InfoTip';

export default function CrossRegionCard() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [ready, setReady] = useState(false);
  const [insights, setInsights] = useState<CrossRegionInsight[]>([]);

  useEffect(() => {
    // ensureFactJournal 会读足迹/银行/心情等历史,放到 effect 里避免阻塞首屏渲染。
    let alive = true;
    const id = window.setTimeout(() => {
      try {
        const out = buildCrossRegionInsights(dict === 'en' ? 'en' : 'zh');
        if (alive) setInsights(out);
      } catch {
        if (alive) setInsights([]);
      } finally {
        if (alive) setReady(true);
      }
    }, 60);
    return () => { alive = false; window.clearTimeout(id); };
  }, [dict]);

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
        <ul className="nesio-xr-list">
          {insights.map((it) => (
            <li key={it.id} className={`nesio-xr-item${it.strength >= 0 ? ' is-pos' : ' is-neg'}`}>
              <div className="nesio-xr-head">
                <span className="nesio-xr-title">{it.headline}</span>
                {it.sensitive && (
                  <span className="nesio-xr-tag" title={L(dict, '涉及敏感域(健康/财务/位置),仅本机本人可见', 'Involves a sensitive domain (health/finance/location); on-device, yours only')}>
                    {L(dict, '私密', 'private')}
                  </span>
                )}
              </div>
              <p className="nesio-xr-detail">{it.detail}</p>
              <p className="nesio-xr-evidence">{it.evidence}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
