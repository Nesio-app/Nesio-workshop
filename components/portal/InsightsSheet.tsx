'use client';

/**
 * InsightsSheet — 三层认知架构 UI
 *
 * Tab 1 — 洞察 (Reflection):  规则引擎生成的真实数据事实，无AI
 * Tab 2 — 分析 (Analytics):   分布饼图 + 活动热力图（SVG，无AI）
 * Tab 3 — 认知模型 (Living):  AI 推断的7层认知世界模型 + 证据 + 置信度
 *
 * 设计原则：行为观测 > 自我声明；每条结论可溯源、可校正、可演化。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import type { LifeNode } from '@/lib/portal/life-graph';
import { getMirrorProfile, type MirrorProfile } from '@/lib/portal/mirror-profile';
import { loadProfileSettings } from '@/lib/portal/profile';
import {
  loadLivingModel,
  saveLivingModel,
  shouldRefreshLivingModel,
  saveLivingModelFeedback,
  loadLivingModelFeedbacks,
  summarizeForLivingModel,
  LAYER_META,
  type LivingModel,
  type LivingModelLayer,
  type LivingModelLayerId,
} from '@/lib/platform/living-model';

// ── Types ─────────────────────────────────────────────────────────────────────

type MainTab = 'reflection' | 'analytics' | 'living';
type Period = 'today' | 'week' | 'month';

interface FactBullet {
  icon: string;
  text: string;
}

interface DomainStat {
  label: string;
  count: number;
  color: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = { today: '今日', week: '本周', month: '本月' };

const TYPE_COLOR: Record<string, string> = {
  commitment: '#8b5cf6',
  event:      '#8b5cf6',
  health_state: '#10b981',
  person:     '#f59e0b',
  place:      '#3b82f6',
  object:     '#64748b',
  preference: '#ec4899',
};

const TYPE_LABEL: Record<string, string> = {
  commitment: '承诺/任务',
  event:      '事件',
  health_state: '健康',
  person:     '人物',
  place:      '地点',
  object:     '物品',
  preference: '偏好',
};

const HOUR_GROUPS = [
  { label: '清晨 6-9',  hours: [6, 7, 8] },
  { label: '上午 9-12', hours: [9, 10, 11] },
  { label: '下午 12-18', hours: [12, 13, 14, 15, 16, 17] },
  { label: '晚上 18-23', hours: [18, 19, 20, 21, 22] },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function periodStart(period: Period): Date {
  const now = new Date();
  if (period === 'today') {
    const d = new Date(now); d.setHours(0, 0, 0, 0); return d;
  }
  if (period === 'week') {
    const d = new Date(now); d.setDate(d.getDate() - 7); return d;
  }
  const d = new Date(now); d.setMonth(d.getMonth() - 1); return d;
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

// ── Reflection Engine (pure rules, no AI) ─────────────────────────────────────

function computeReflectionFacts(nodes: LifeNode[], all: LifeNode[], profile: MirrorProfile): FactBullet[] {
  const facts: FactBullet[] = [];

  // 1. Record count
  if (nodes.length > 0) {
    facts.push({ icon: '📦', text: `记录了 ${nodes.length} 件事` });
  } else {
    facts.push({ icon: '📦', text: '这段时间还没有新记录' });
  }

  // 2. Completion rate
  const commitments = nodes.filter((n) => n.type === 'commitment' || n.type === 'event');
  const done = commitments.filter((n) => n.attributes.done === true);
  if (commitments.length > 0) {
    const rate = Math.round((done.length / commitments.length) * 100);
    facts.push({ icon: '✅', text: `承诺完成率 ${rate}%（${done.length}/${commitments.length} 件）` });
  }

  // 3. Top domain
  const domainMap: Record<string, number> = {};
  for (const n of nodes) {
    let domain = '';
    if (typeof n.attributes.context === 'string') {
      try { domain = (JSON.parse(n.attributes.context) as { domain?: string }).domain ?? ''; } catch { /* ignore */ }
    }
    if (!domain && n.tags?.[0]) domain = n.tags[0];
    if (!domain) domain = TYPE_LABEL[n.type] ?? '其他';
    domainMap[domain] = (domainMap[domain] ?? 0) + 1;
  }
  const topDomain = Object.entries(domainMap).sort(([, a], [, b]) => b - a)[0];
  if (topDomain && nodes.length > 1) {
    facts.push({ icon: '🎯', text: `最集中在「${topDomain[0]}」（${topDomain[1]} 条，占 ${Math.round(topDomain[1] / nodes.length * 100)}%）` });
  }

  // 4. Active hour
  const bestGroup = HOUR_GROUPS
    .map((g) => ({ ...g, score: avg(g.hours.map((h) => profile.hourEngagement[h])) }))
    .sort((a, b) => b.score - a.score)[0];
  if (bestGroup && bestGroup.score > 0.5) {
    facts.push({ icon: '⏰', text: `你的黄金时段在${bestGroup.label}` });
  }

  // 5. Top person
  const persons = all.filter((n) => n.type === 'person').slice(0, 3);
  if (persons.length > 0) {
    facts.push({ icon: '👤', text: `最常出现的人：${persons.map((p) => p.name).join('、')}` });
  }

  return facts.slice(0, 5);
}

// ── Analytics: Domain Distribution (SVG donut) ────────────────────────────────

function DonutChart({ data }: { data: DomainStat[] }) {
  if (data.length === 0) return <p className="nesio-insights-empty">暂无数据</p>;

  const total = data.reduce((s, d) => s + d.count, 0);
  const R = 56; const cx = 72; const cy = 72;
  let angle = -Math.PI / 2;
  const slices: Array<{ d: string; color: string; label: string; count: number; pct: number }> = [];

  for (const seg of data) {
    const pct = seg.count / total;
    const sweep = pct * 2 * Math.PI;
    const x1 = cx + R * Math.cos(angle);
    const y1 = cy + R * Math.sin(angle);
    const x2 = cx + R * Math.cos(angle + sweep);
    const y2 = cy + R * Math.sin(angle + sweep);
    const large = sweep > Math.PI ? 1 : 0;
    slices.push({
      d: `M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`,
      color: seg.color,
      label: seg.label,
      count: seg.count,
      pct: Math.round(pct * 100),
    });
    angle += sweep;
  }

  return (
    <div className="nesio-donut-wrap">
      <svg viewBox="0 0 144 144" width="144" height="144" className="nesio-donut-svg">
        {slices.map((s, i) => (
          <path key={i} d={s.d} fill={s.color} opacity={0.85} />
        ))}
        <circle cx={cx} cy={cy} r={34} fill="var(--glass-bg-solid)" />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="11" fill="var(--portal-ink)" fontWeight="700">{total}</text>
        <text x={cx} y={cy + 9} textAnchor="middle" fontSize="8" fill="var(--portal-muted)">条记录</text>
      </svg>
      <div className="nesio-donut-legend">
        {slices.map((s, i) => (
          <div key={i} className="nesio-donut-legend-row">
            <span className="nesio-donut-dot" style={{ background: s.color }} />
            <span className="nesio-donut-legend-label">{s.label}</span>
            <span className="nesio-donut-legend-pct">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Analytics: Activity Heatmap (7-day × time-of-day grid) ───────────────────

function ActivityHeatmap({ nodes }: { nodes: LifeNode[] }) {
  // Grid: rows = day-of-week (Mon–Sun), cols = time buckets (0–5, 6–11, 12–17, 18–23)
  const DAYS = ['一', '二', '三', '四', '五', '六', '日'];
  const SLOTS = ['00-06', '06-12', '12-18', '18-24'];
  const counts: number[][] = Array.from({ length: 7 }, () => Array(4).fill(0));
  let maxVal = 0;

  for (const n of nodes) {
    const d = new Date(n.createdAt);
    const dow = (d.getDay() + 6) % 7; // Mon=0
    const slot = Math.floor(d.getHours() / 6);
    counts[dow][slot]++;
    if (counts[dow][slot] > maxVal) maxVal = counts[dow][slot];
  }

  if (maxVal === 0) return <p className="nesio-insights-empty">暂无活动数据</p>;

  return (
    <div className="nesio-heatmap">
      <div className="nesio-heatmap-labels-top">
        {SLOTS.map((s) => <span key={s} className="nesio-heatmap-col-label">{s}</span>)}
      </div>
      {counts.map((row, di) => (
        <div key={di} className="nesio-heatmap-row">
          <span className="nesio-heatmap-row-label">周{DAYS[di]}</span>
          {row.map((v, si) => {
            const intensity = maxVal > 0 ? v / maxVal : 0;
            const alpha = intensity > 0 ? 0.15 + intensity * 0.75 : 0;
            return (
              <div
                key={si}
                className="nesio-heatmap-cell"
                style={{ background: alpha > 0 ? `rgba(139,92,246,${alpha.toFixed(2)})` : 'var(--portal-line)' }}
                title={`周${DAYS[di]} ${SLOTS[si]}: ${v} 条`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Living Model: Confidence Bar ──────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 85 ? '#10b981' : value >= 70 ? '#8b5cf6' : value >= 55 ? '#f59e0b' : '#94a3b8';
  return (
    <div className="nesio-lm-confidence">
      <div className="nesio-lm-conf-track">
        <div className="nesio-lm-conf-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="nesio-lm-conf-label" style={{ color }}>{value}%</span>
    </div>
  );
}

// ── Living Model Tab ──────────────────────────────────────────────────────────

function LivingModelTab({
  model,
  loading,
  onRefresh,
  onFeedback,
}: {
  model: LivingModel | null;
  loading: boolean;
  onRefresh: () => void;
  onFeedback: (insightId: string, verified: boolean) => void;
}) {
  const [expandedLayer, setExpandedLayer] = useState<LivingModelLayerId | null>('identity');

  if (loading) {
    return (
      <div className="nesio-lm-loading">
        <span className="nesio-focus-decompose-spinner" />
        <span>Nesio 正在深度思考你的认知模型…</span>
      </div>
    );
  }

  const layerIds: LivingModelLayerId[] = ['identity', 'motivation', 'principles', 'patterns', 'blind_spots', 'evolution', 'prediction'];
  const layers = model
    ? model.layers
    : layerIds.map((id) => ({ id, label: LAYER_META[id].label, icon: LAYER_META[id].icon, insights: [], minConfidenceToShow: LAYER_META[id].minConfidence }));

  const hasAnyInsight = layers.some((l) => l.insights.length > 0);

  return (
    <div className="nesio-lm-tab">
      <div className="nesio-lm-header-row">
        <p className="nesio-lm-subtitle">
          {hasAnyInsight
            ? 'Nesio 对你的认知世界模型 · 每条结论均可校正'
            : '积累更多记录后，Nesio 将推断你的认知模型'}
        </p>
        <button type="button" className="nesio-lm-refresh-btn" onClick={onRefresh} title="重新生成">
          ↺
        </button>
      </div>

      {!hasAnyInsight && (
        <div className="nesio-lm-empty">
          <p>📊 记录更多内容，Nesio 会发现你的模式和规律。</p>
          <p className="nesio-lm-empty-hint">通常需要 10+ 条记录才能生成有意义的洞察。</p>
        </div>
      )}

      {layers.map((layer) => {
        const visibleInsights = layer.insights.filter((i) => i.confidence >= layer.minConfidenceToShow);
        const isExpanded = expandedLayer === layer.id;

        return (
          <div key={layer.id} className={`nesio-lm-layer${isExpanded ? ' nesio-lm-layer--expanded' : ''}`}>
            <button
              type="button"
              className="nesio-lm-layer-header"
              onClick={() => setExpandedLayer(isExpanded ? null : layer.id)}
            >
              <span className="nesio-lm-layer-icon">{layer.icon}</span>
              <span className="nesio-lm-layer-label">{layer.label}</span>
              {visibleInsights.length > 0 && (
                <span className="nesio-lm-layer-count">{visibleInsights.length}</span>
              )}
              {visibleInsights.length === 0 && (
                <span className="nesio-lm-layer-empty-badge">积累中</span>
              )}
              <span className="nesio-lm-layer-chevron">{isExpanded ? '▴' : '▾'}</span>
            </button>

            {isExpanded && (
              <div className="nesio-lm-layer-body">
                {visibleInsights.length === 0 ? (
                  <p className="nesio-lm-insight-empty">
                    {layer.id === 'blind_spots'
                      ? '盲区需要更高的置信度（90%+）才会展示'
                      : '这一层还在观察中，继续记录你的生活'}
                  </p>
                ) : (
                  visibleInsights.map((insight) => (
                    <div key={insight.id} className="nesio-lm-insight">
                      <p className="nesio-lm-insight-content">{insight.content}</p>
                      <ConfidenceBar value={insight.confidence} />
                      {insight.evidenceRefs.length > 0 && (
                        <div className="nesio-lm-evidence">
                          <span className="nesio-lm-evidence-label">证据：</span>
                          {insight.evidenceRefs.map((ref, i) => (
                            <span key={i} className="nesio-lm-evidence-tag">{ref}</span>
                          ))}
                        </div>
                      )}
                      <div className="nesio-lm-insight-footer">
                        <span className="nesio-lm-insight-date">
                          更新于 {new Date(insight.lastUpdatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                        </span>
                        <div className="nesio-lm-feedback-btns">
                          <button
                            type="button"
                            className={`nesio-lm-fb-btn${insight.userVerified === true ? ' nesio-lm-fb-btn--yes' : ''}`}
                            onClick={() => onFeedback(insight.id, true)}
                            title="说得对"
                          >✓</button>
                          <button
                            type="button"
                            className={`nesio-lm-fb-btn${insight.userVerified === false ? ' nesio-lm-fb-btn--no' : ''}`}
                            onClick={() => onFeedback(insight.id, false)}
                            title="不对"
                          >✗</button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      {model && (
        <p className="nesio-lm-gen-time">
          模型生成于 {new Date(model.generatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function InsightsSheet({ onClose }: { onClose: () => void }) {
  const [mainTab, setMainTab] = useState<MainTab>('reflection');
  const [period, setPeriod] = useState<Period>('week');
  const [profile, setProfile] = useState<MirrorProfile | null>(null);
  const [allNodes, setAllNodes] = useState<LifeNode[]>([]);
  const [periodNodes, setPeriodNodes] = useState<LifeNode[]>([]);

  // Reflection
  const [facts, setFacts] = useState<FactBullet[]>([]);
  const [domainStats, setDomainStats] = useState<DomainStat[]>([]);

  // Living Model
  const [livingModel, setLivingModel] = useState<LivingModel | null>(null);
  const [livingLoading, setLivingLoading] = useState(false);
  const livingFetchedRef = useRef(false);

  // Load base data
  useEffect(() => {
    const p = getMirrorProfile();
    setProfile(p);
    const all = getLifeGraph();
    setAllNodes(all);
  }, []);

  // Recompute when period changes
  useEffect(() => {
    if (!profile) return;
    const all = getLifeGraph();
    const since = periodStart(period);
    const filtered = all.filter((n) => new Date(n.createdAt) >= since);
    setPeriodNodes(filtered);

    // Reflection facts
    setFacts(computeReflectionFacts(filtered, all, profile));

    // Domain distribution
    const domainMap: Record<string, { count: number; color: string }> = {};
    for (const n of filtered) {
      const label = TYPE_LABEL[n.type] ?? '其他';
      const color = TYPE_COLOR[n.type] ?? '#94a3b8';
      if (!domainMap[label]) domainMap[label] = { count: 0, color };
      domainMap[label].count++;
    }
    setDomainStats(
      Object.entries(domainMap)
        .map(([label, { count, color }]) => ({ label, count, color }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 7),
    );
  }, [period, profile]);

  // Living Model: load cached or generate
  const fetchLivingModel = useCallback(async (force = false) => {
    const all = getLifeGraph();
    const p = getMirrorProfile();
    const cached = loadLivingModel();

    if (!force && !shouldRefreshLivingModel(cached, all.length)) {
      setLivingModel(cached);
      return;
    }

    setLivingLoading(true);
    try {
      const feedbacks = loadLivingModelFeedbacks();
      const previousInsights = cached?.layers.flatMap((l) =>
        l.insights.map((i) => ({ layerId: l.id, content: i.content, userVerified: feedbacks[i.id] !== undefined ? feedbacks[i.id] : i.userVerified }))
      ) ?? [];

      const summary = summarizeForLivingModel({ nodes: all, mirrorProfile: p, previousInsights });

      const res = await fetch('/api/portal/living-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...summary, userName: loadProfileSettings().displayName }),
      });
      const data = await res.json() as { ok: boolean; layers: LivingModelLayer[] };
      if (data.ok && data.layers) {
        const model: LivingModel = {
          layers: data.layers,
          generatedAt: new Date().toISOString(),
          nodeCountAtGen: all.length,
        };
        saveLivingModel(model);
        setLivingModel(model);
      }
    } catch {
      /* show cached or empty */
      if (cached) setLivingModel(cached);
    } finally {
      setLivingLoading(false);
    }
  }, []);

  // Fetch living model when tab is first opened
  useEffect(() => {
    if (mainTab === 'living' && !livingFetchedRef.current) {
      livingFetchedRef.current = true;
      void fetchLivingModel();
    }
  }, [mainTab, fetchLivingModel]);

  const handleFeedback = useCallback((insightId: string, verified: boolean) => {
    saveLivingModelFeedback(insightId, verified);
    setLivingModel((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        layers: prev.layers.map((l) => ({
          ...l,
          insights: l.insights.map((i) => i.id === insightId ? { ...i, userVerified: verified } : i),
        })),
      };
    });
  }, []);

  const handleRefreshLiving = useCallback(() => {
    livingFetchedRef.current = true;
    void fetchLivingModel(true);
  }, [fetchLivingModel]);

  return (
    <div className="nesio-insights-sheet">
      {/* Header */}
      <div className="nesio-insights-header">
        <div className="nesio-insights-title-row">
          <span className="nesio-insights-icon">✦</span>
          <h2 className="nesio-insights-title">Nesio 的了解</h2>
        </div>
        <button type="button" className="nesio-insights-close" onClick={onClose} aria-label="关闭">✕</button>
      </div>

      {/* Main tabs */}
      <div className="nesio-insights-main-tabs">
        {(['reflection', 'analytics', 'living'] as MainTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`nesio-insights-main-tab${mainTab === t ? ' nesio-insights-main-tab--active' : ''}`}
            onClick={() => setMainTab(t)}
          >
            {t === 'reflection' ? '洞察' : t === 'analytics' ? '分析' : '认知模型'}
          </button>
        ))}
      </div>

      <div className="nesio-insights-body">

        {/* ── Tab 1: Reflection ── */}
        {mainTab === 'reflection' && (
          <div className="nesio-reflection-tab">
            {/* Period switcher */}
            <div className="nesio-insights-period-tabs" style={{ marginBottom: '1rem' }}>
              {(['today', 'week', 'month'] as Period[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`nesio-insights-tab${period === p ? ' nesio-insights-tab--active' : ''}`}
                  onClick={() => setPeriod(p)}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>

            {/* Fact bullets */}
            <div className="nesio-reflection-facts">
              {facts.length === 0 ? (
                <p className="nesio-insights-empty">暂无数据 · 多记录一些内容</p>
              ) : (
                facts.map((f, i) => (
                  <div key={i} className="nesio-reflection-fact">
                    <span className="nesio-reflection-fact-icon">{f.icon}</span>
                    <span className="nesio-reflection-fact-text">{f.text}</span>
                  </div>
                ))
              )}
            </div>

            {/* Stats row */}
            <div className="nesio-insights-stats-row" style={{ marginTop: '1.25rem' }}>
              <div className="nesio-insights-stat">
                <span className="nesio-insights-stat-num">{periodNodes.length}</span>
                <span className="nesio-insights-stat-label">{PERIOD_LABELS[period]}记录</span>
              </div>
              <div className="nesio-insights-stat-divider" />
              <div className="nesio-insights-stat">
                <span className="nesio-insights-stat-num">{allNodes.length}</span>
                <span className="nesio-insights-stat-label">总记忆</span>
              </div>
              <div className="nesio-insights-stat-divider" />
              <div className="nesio-insights-stat">
                <span className="nesio-insights-stat-num">{profile?.feedbackCount ?? 0}</span>
                <span className="nesio-insights-stat-label">次互动</span>
              </div>
            </div>

            <p className="nesio-insights-cloud-note" style={{ marginTop: '1.25rem' }}>
              ↕ 以上数据来自本地记录 · 无AI推断
            </p>
          </div>
        )}

        {/* ── Tab 2: Analytics ── */}
        {mainTab === 'analytics' && (
          <div className="nesio-analytics-tab">
            {/* Period switcher */}
            <div className="nesio-insights-period-tabs" style={{ marginBottom: '1rem' }}>
              {(['today', 'week', 'month'] as Period[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`nesio-insights-tab${period === p ? ' nesio-insights-tab--active' : ''}`}
                  onClick={() => setPeriod(p)}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>

            <div className="nesio-insights-section">
              <p className="nesio-insights-section-label">记录分布</p>
              <DonutChart data={domainStats} />
            </div>

            <div className="nesio-insights-section">
              <p className="nesio-insights-section-label">活动热力图（过去30天）</p>
              <ActivityHeatmap nodes={allNodes.filter((n) => {
                const d = new Date(n.createdAt);
                return (Date.now() - d.getTime()) <= 30 * 86_400_000;
              })} />
            </div>
          </div>
        )}

        {/* ── Tab 3: Living Model ── */}
        {mainTab === 'living' && (
          <LivingModelTab
            model={livingModel}
            loading={livingLoading}
            onRefresh={handleRefreshLiving}
            onFeedback={handleFeedback}
          />
        )}

      </div>
    </div>
  );
}
