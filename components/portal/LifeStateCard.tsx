'use client';

/**
 * LifeStateCard — gentle cross-signal workload view.
 * It describes what is taking attention today without scoring the user.
 */

import { useEffect, useState } from 'react';
import {
  computeLifeState,
  dimensionLabel,
  type LifeState,
  type DimensionLevel,
} from '@/lib/life-domain';
import { loadProfileSettings } from '@/lib/portal/profile';

const LEVEL_COLOR: Record<DimensionLevel, string> = {
  good: 'var(--status-go)',
  stable: '#6ee7b7',
  unknown: '#cbd5e1',
  mild_risk: 'var(--status-gentle)',
  high_load: '#f97316',
  low: 'var(--status-risk)',
};

const LEVEL_FACT: Record<DimensionLevel, string> = {
  good: '安排较轻',
  stable: '安排稳定',
  unknown: '线索还少',
  mild_risk: '事项较多',
  high_load: '事项较多',
  low: '需要放慢',
};

export default function LifeStateCard({ canUsePrivateData }: { canUsePrivateData: boolean }) {
  const [state, setState] = useState<LifeState | null>(null);
  const [aiExplanation, setAiExplanation] = useState<string>('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!canUsePrivateData) {
      setState(null);
      setAiExplanation('');
      return undefined;
    }
    const recompute = () => setState(computeLifeState());
    recompute();
    window.addEventListener('nesio-life-graph-updated', recompute);
    window.addEventListener('nesio-connectors-refreshed', recompute);
    return () => {
      window.removeEventListener('nesio-life-graph-updated', recompute);
      window.removeEventListener('nesio-connectors-refreshed', recompute);
    };
  }, [canUsePrivateData]);

  // Fetch a natural-language explanation (PRD: hybrid rules + AI summary).
  // Cached per state snapshot so it does not refetch on every render.
  useEffect(() => {
    if (!canUsePrivateData || !state) return;
    const known = state.dimensions.filter((d) => d.level !== 'unknown');
    if (!known.length) return;

    const cacheKey = `nesio-lifestate-ai-${state.stateId}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) { setAiExplanation(cached); return; }
    } catch { /* ignore */ }

    const controller = new AbortController();
    fetch('/api/portal/life-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        displayName: loadProfileSettings().displayName,
        dimensions: known.map((d) => ({ dimension: d.dimension, label: dimensionLabel(d.dimension), level: d.level, note: d.note })),
        risks: state.risks,
        opportunities: state.opportunities,
        timeWindow: state.timeWindow,
      }),
    })
      .then((r) => r.json())
      .then((data: { ok?: boolean; explanation?: string }) => {
        if (data.ok && data.explanation) {
          setAiExplanation(data.explanation);
          try { sessionStorage.setItem(cacheKey, data.explanation); } catch { /* ignore */ }
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [canUsePrivateData, state?.stateId]);

  if (!state) return null;

  // Only show health/energy dimensions — schedule-based dims are unreliable without full calendar data.
  const healthDims = ['health', 'energy', 'sleep'];
  const known = state.dimensions.filter(
    (d) => d.level !== 'unknown' && healthDims.includes(d.dimension),
  );
  if (known.length === 0) return null;

  const needsAttention = known.filter((d) => d.level === 'high_load' || d.level === 'mild_risk' || d.level === 'low').length;
  const stateTone = needsAttention > 0 ? '有些需要留意' : '状态不错';
  const stateHint = needsAttention > 0 ? '注意休息。' : '继续保持。';
  const leadColor = needsAttention > 0 ? 'var(--status-gentle)' : 'var(--status-go)';

  return (
    <div className="nesio-lifestate-card">
      <button type="button" className="nesio-lifestate-head" onClick={() => setExpanded(!expanded)}>
        <div className="nesio-lifestate-ring" style={{ ['--ring-color' as string]: leadColor, ['--ring-pct' as string]: '64' }}>
          <span className="nesio-lifestate-ring-icon" aria-hidden>◦</span>
        </div>
        <div className="nesio-lifestate-head-text">
          <p className="nesio-lifestate-kicker">今日状态</p>
          <p className="nesio-lifestate-explanation">{stateTone}，{aiExplanation || stateHint}</p>
        </div>
        <svg className={`nesio-lifestate-chevron${expanded ? ' nesio-lifestate-chevron--open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Dimension bars */}
      <div className="nesio-lifestate-dims">
        {known.map((d) => (
          <div key={d.dimension} className="nesio-lifestate-dim">
            <div className="nesio-lifestate-dim-head">
              <span className="nesio-lifestate-dim-label">{dimensionLabel(d.dimension)}</span>
              <span className="nesio-lifestate-dim-level" style={{ color: LEVEL_COLOR[d.level] }}>
                {LEVEL_FACT[d.level]}
              </span>
            </div>
            <div className="nesio-lifestate-dim-track">
              <div className="nesio-lifestate-dim-fill" style={{ width: `${Math.round(d.score * 100)}%`, background: LEVEL_COLOR[d.level] }} />
            </div>
            {expanded && d.note && <p className="nesio-lifestate-dim-note">{d.note}</p>}
          </div>
        ))}
      </div>

      {/* Expanded: risks + opportunities */}
      {expanded && (
        <div className="nesio-lifestate-detail">
          {state.risks.length > 0 && (
            <div className="nesio-lifestate-section">
              <p className="nesio-lifestate-section-label">需要留意</p>
              {state.risks.map((r, i) => <p key={i} className="nesio-lifestate-risk">⚠ {r}</p>)}
            </div>
          )}
          {state.opportunities.length > 0 && (
            <div className="nesio-lifestate-section">
              <p className="nesio-lifestate-section-label">状态不错</p>
              {state.opportunities.map((o, i) => <p key={i} className="nesio-lifestate-opp">✓ {o}</p>)}
            </div>
          )}
          <p className="nesio-lifestate-window">{state.timeWindow} · {state.keyDriverSignalIds.length} 条信号支撑</p>
        </div>
      )}
    </div>
  );
}
