'use client';

/**
 * InsightsSheet — v1 规格 §2:洞察页(个人数据 = 编辑过的刊物,不是监控台)。
 *
 * 免费层四件套(全本地统计、无 AI、批量导入不计入):
 *   ① 你在想什么(主题门)  ② 没接上的线头  ③ 走走看  ④ 一行节律
 * 生命版图 = 唯一保留的图(≥90 天数据才出现,绝不以示例地形冒充)。
 * 认知 tab = Pro 多面镜月度信(只回看不预测);旧 7 层模型 + 节点图移 Lab。
 * 健康/足迹/财务/关系 tab 走功能开关(提审构建不可达)。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MyExperimentWidget } from '@/components/portal/NesioExperiment';
import { useFeatureEnabled } from '@/components/portal/use-feature-flag';
import LifeCivilizationMap from '@/components/portal/LifeCivilizationMap';
import RelationGraph from '@/components/portal/RelationGraph';
import type { GNode, GEdge } from '@/lib/platform/graph-engine';
import { getLifeGraph, isBulkImported } from '@/lib/portal/life-graph';
import type { LifeNode } from '@/lib/portal/life-graph';
import { getMirrorProfile } from '@/lib/portal/mirror-profile';
import { loadProfileSettings } from '@/lib/portal/profile';
import { isLabModeOn, LAB_MODE_EVENT } from '@/lib/portal/module-overrides';
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
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { InfoTip } from './InfoTip';
import TimelineTab from './insights/TimelineTab';
import MirrorLetterTab from './insights/MirrorLetterTab';
import FinanceTab from './finance/FinanceTab';
import HealthDashboard from './health/HealthDashboard';
import RelationshipsPanel from './relationships/RelationshipsPanel';
import LearningStatusPanel from './LearningStatusPanel';

// ── Types ─────────────────────────────────────────────────────────────────────

type MainTab = 'reflection' | 'health' | 'timeline' | 'finance' | 'relationships' | 'living';

const DAY_MS = 86_400_000;

/** 系统标记(normalizer 系统标 / 导入标),不是主题,永不成门。 */
const SYSTEM_TAGS = new Set(['联系人', '手动记录', '月报', 'Voice', '手写']);

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ── Widget: mini week bars(一行节律的迷你柱线)────────────────────────────────

function WeekBarChart({ nodes }: { nodes: LifeNode[] }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const now = Date.now();
  const buckets: { label: string; count: number }[] = [];

  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now - i * 7 * DAY_MS);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
    const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
    const count = nodes.filter((n) => {
      const t = new Date(n.createdAt).getTime();
      return t >= weekStart.getTime() && t < weekEnd.getTime();
    }).length;
    buckets.push({ label, count });
  }

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <div className="nesio-week-bar-chart">
      {buckets.map((b, i) => (
        <div key={i} className="nesio-week-bar-col">
          <div className="nesio-week-bar-track">
            <div
              className="nesio-week-bar-fill"
              style={{ height: `${Math.round((b.count / maxCount) * 100)}%` }}
              title={L(dict, `${b.label}: ${b.count} 条`, `${b.label}: ${b.count}`)}
            />
          </div>
          <span className="nesio-week-bar-label">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Living Model(Lab 内部保留):confidence bar + 节点图 builders ───────────────

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 85 ? 'var(--status-go)' : value >= 70 ? 'var(--portal-cool-accent)' : value >= 55 ? 'var(--status-gentle)' : 'var(--portal-muted)';
  return (
    <div className="nesio-lm-confidence">
      <div className="nesio-lm-conf-track">
        <div className="nesio-lm-conf-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="nesio-lm-conf-label" style={{ color }} title="AI 自评置信度(非精确度量)">{value}%</span>
    </div>
  );
}

const LAYER_GRAPH_COLOR: Record<string, string> = {
  identity:    'var(--portal-accent)',
  motivation:  'var(--status-gentle)',
  principles:  'var(--status-go)',
  patterns:    'var(--status-calm)',
  blind_spots: 'var(--status-risk)',
  evolution:   'var(--portal-cool-accent)',
  prediction:  'var(--portal-muted)',
};

function buildModelGraphNodes(model: LivingModel | null): GNode[] {
  if (!model) return [];
  const nodes: GNode[] = [];
  for (const layer of model.layers) {
    const visible = layer.insights.filter(ins => ins.confidence >= 50);
    visible.forEach((insight, i) => {
      nodes.push({
        id: `${layer.id}::${i}`,
        label: insight.content.slice(0, 12),
        type: layer.id,
        weight: insight.confidence / 100,
        color: LAYER_GRAPH_COLOR[layer.id] ?? 'var(--portal-accent)',
        meta: { full: insight.content, layerId: layer.id },
      });
    });
  }
  return nodes;
}

function buildModelGraphEdges(model: LivingModel | null, dict: string = 'zh'): GEdge[] {
  if (!model) return [];
  const edges: GEdge[] = [];
  const seen = new Set<string>();

  for (const layer of model.layers) {
    const layerNodes = layer.insights
      .filter(i => i.confidence >= 50)
      .map((_, idx) => `${layer.id}::${idx}`);
    for (let i = 0; i < layerNodes.length - 1; i++) {
      const key = `${layerNodes[i]}|${layerNodes[i + 1]}`;
      if (!seen.has(key)) { seen.add(key); edges.push({ source: layerNodes[i], target: layerNodes[i + 1], weight: 0.4 }); }
    }
  }

  const allInsights = model.layers.flatMap((l) =>
    l.insights.filter(i => i.confidence >= 50).map((ins, ii) => ({ id: `${l.id}::${ii}`, refs: new Set(ins.evidenceRefs ?? []) })),
  );
  for (let i = 0; i < allInsights.length; i++) {
    for (let j = i + 1; j < allInsights.length; j++) {
      const shared = Array.from(allInsights[i].refs).filter(r => allInsights[j].refs.has(r));
      if (shared.length > 0) {
        const key = `${allInsights[i].id}|${allInsights[j].id}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ source: allInsights[i].id, target: allInsights[j].id, weight: 0.7, label: L(dict, '共同证据', 'Shared evidence') });
        }
      }
    }
  }
  return edges;
}

// ── Living Model Tab(v1 规格 §2.3:退居 Lab;主形态是多面镜月度信)──────────────

function LivingModelTab({
  model,
  loading,
  error,
  nodeCount,
  onRefresh,
  onFeedback,
}: {
  model: LivingModel | null;
  loading: boolean;
  error: 'no-key' | 'ai-error' | 'network' | null;
  nodeCount: number;
  onRefresh: () => void;
  onFeedback: (insightId: string, verified: boolean) => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [expandedLayer, setExpandedLayer] = useState<LivingModelLayerId | null>('identity');

  if (loading) {
    return (
      <div className="nesio-lm-loading">
        <span className="nesio-focus-decompose-spinner" />
        <span>{L(dict, 'Nesio 正在深度思考你的认知模型…', 'Nesio is thinking hard about your mind model…')}</span>
      </div>
    );
  }

  const hasPrior = !!model && model.layers.some((l) => l.insights.length > 0);
  const priorTail = hasPrior
    ? L(dict, '下面是上次的结果。', 'Showing your last result.')
    : '';
  const errorMsg = error === 'no-key'
    ? L(dict, `还没接上 AI —— 认知模型需要 AI 才能生成(去部署里配一个 AI key 即可)。不是没有数据。${priorTail}`, `AI isn't connected yet — the mind model needs it (set an AI key in your deployment). Not a lack of data. ${hasPrior ? 'Showing your last result.' : ''}`)
    : error === 'network'
      ? L(dict, `网络异常,认知模型没刷新出来 —— 不是没有数据。${priorTail}`, `Network issue — the mind model didn't refresh. Not a lack of data. ${hasPrior ? 'Showing your last result.' : ''}`)
      : L(dict, `这次没生成出来(AI 忙或稍有波动)—— 不是没有数据,点重试再试一次。${priorTail}`, `Didn't generate this time (AI busy or a hiccup) — not a lack of data; tap retry. ${hasPrior ? 'Showing your last result.' : ''}`);
  const errorBanner = error ? (
    <div className="nesio-chat-degraded-hint" style={{ margin: '0 0 0.75rem', display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
      <span style={{ flex: 1 }}>{errorMsg}</span>
      {error !== 'no-key' && (
        <button
          type="button"
          onClick={() => onRefresh()}
          style={{ flex: 'none', alignSelf: 'center', fontSize: '0.74rem', fontWeight: 600, padding: '0.28rem 0.7rem', borderRadius: 'var(--radius-sm, 12px)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-accent)', cursor: 'pointer' }}
        >
          {L(dict, '重试', 'Retry')}
        </button>
      )}
    </div>
  ) : null;

  const layerIds: LivingModelLayerId[] = ['identity', 'motivation', 'principles', 'patterns', 'blind_spots', 'evolution', 'prediction'];
  const layers = model
    ? model.layers
    : layerIds.map((id) => ({ id, label: LAYER_META[id].label, icon: LAYER_META[id].icon, insights: [], minConfidenceToShow: LAYER_META[id].minConfidence }));

  const hasAnyInsight = layers.some((l) => l.insights.length > 0);

  if (!hasAnyInsight) {
    const enough = nodeCount >= 10;
    return (
      <div className="nesio-lm-tab">
        {errorBanner}
        <div className="nesio-lm-empty">
          <p>
            {enough
              ? L(dict, '记录够了，点一下生成你的认知模型。', 'Enough notes — tap once to build your mind model.')
              : L(dict, `已记录 ${nodeCount} / 10 条，记满后 Nesio 开始推断。`, `${nodeCount} / 10 notes — Nesio starts inferring at 10.`)}
          </p>
          {enough && (
            <button type="button" className="nesio-lm-perspective-btn" style={{ marginTop: '0.6rem' }} onClick={() => onRefresh()}>
              {L(dict, '生成模型', 'Build model')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const withInsights = layers.filter((l) => l.insights.some((i) => i.confidence >= l.minConfidenceToShow));
  const gathering = layers.filter((l) => !l.insights.some((i) => i.confidence >= l.minConfidenceToShow));

  return (
    <div className="nesio-lm-tab">
      {errorBanner}
      <p className="nesio-lm-subtitle">
        {L(dict, '来自你的记录，每条结论都可校正。', 'From your notes — every conclusion is correctable.')}
      </p>

      {/* 认知关系图(节点图):v1 规格 §4.8 一律 Lab —— 本 tab 已整体 Lab 门 */}
      <div className="nesio-insights-section" style={{ marginTop: 'var(--space-2)' }}>
        <p className="nesio-insights-section-label">{L(dict, '认知关系图', 'Cognition graph')}<InfoTip text={L(dict, '把认知模型的各层结论连成图:点任一节点展开它所属的维度详情。', 'Your mind-model conclusions as a graph — tap a node to expand its layer.')} /></p>
        <RelationGraph
          nodes={buildModelGraphNodes(model)}
          edges={buildModelGraphEdges(model, dict)}
          height={260}
          onNodeClick={(id) => {
            const layerId = id.split('::')[0] as LivingModelLayerId;
            setExpandedLayer(layerId);
          }}
          emptyText={L(dict, '积累中', 'Gathering')}
        />
      </div>

      <div className="nesio-lm-layers-menu">
      {withInsights.map((layer) => {
        const visibleInsights = layer.insights.filter((i) => i.confidence >= layer.minConfidenceToShow);
        const isExpanded = expandedLayer === layer.id;

        return (
          <div key={layer.id} className={`nesio-lm-layer${isExpanded ? ' nesio-lm-layer--expanded' : ''}`}>
            <button
              type="button"
              className="nesio-lm-layer-header"
              onClick={() => setExpandedLayer(isExpanded ? null : layer.id)}
            >
              <span className="nesio-lm-layer-label">{L(dict, LAYER_META[layer.id]?.label ?? layer.label, LAYER_META[layer.id]?.labelEn ?? layer.label)}</span>
              {visibleInsights.length > 0 && (
                <span className="nesio-lm-layer-count">{visibleInsights.length}</span>
              )}
              {visibleInsights.length === 0 && (
                <span className="nesio-lm-layer-empty-badge">{L(dict, '积累中', 'Gathering')}</span>
              )}
              <span className="nesio-lm-layer-chevron">{isExpanded ? '▴' : '▾'}</span>
            </button>

            {isExpanded && (
              <div className="nesio-lm-layer-body">
                {visibleInsights.length === 0 ? (
                  <p className="nesio-lm-insight-empty">
                    {layer.id === 'blind_spots'
                      ? L(dict, '盲区需要更高的置信度（90%+）才会展示', 'Blind spots only show at 90%+ confidence')
                      : L(dict, '这一层还在观察中，继续记录你的生活', 'Still observing this layer — keep recording your life')}
                  </p>
                ) : (
                  visibleInsights.map((insight) => (
                    <div key={insight.id} className="nesio-lm-insight">
                      <p className="nesio-lm-insight-content">{insight.content}</p>
                      <ConfidenceBar value={insight.confidence} />
                      {(insight.evidenceRefs?.length ?? 0) > 0 && (
                        <div className="nesio-lm-evidence">
                          <span className="nesio-lm-evidence-label">{L(dict, '证据：', 'Evidence: ')}</span>
                          {(insight.evidenceRefs ?? []).map((ref, i) => (
                            <span key={i} className="nesio-lm-evidence-tag">{ref}</span>
                          ))}
                        </div>
                      )}
                      <div className="nesio-lm-insight-footer">
                        <span className="nesio-lm-insight-date">
                          {L(dict, '更新于', 'Updated')} {new Date(insight.lastUpdatedAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' })}
                        </span>
                        <div className="nesio-lm-feedback-btns">
                          <button
                            type="button"
                            className={`nesio-lm-fb-btn${insight.userVerified === true ? ' nesio-lm-fb-btn--yes' : ''}`}
                            onClick={() => onFeedback(insight.id, true)}
                            title={L(dict, '说得对', 'Spot on')}
                          >✓</button>
                          <button
                            type="button"
                            className={`nesio-lm-fb-btn${insight.userVerified === false ? ' nesio-lm-fb-btn--no' : ''}`}
                            onClick={() => onFeedback(insight.id, false)}
                            title={L(dict, '不对', 'Not right')}
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
      </div>

      {gathering.length > 0 && (
        <p className="nesio-lm-gathering-row">
          {L(dict, '积累中：', 'Gathering: ')}
          {gathering.map((l) => L(dict, LAYER_META[l.id]?.label ?? l.label, LAYER_META[l.id]?.labelEn ?? l.label)).join(' · ')}
        </p>
      )}

      <div className="nesio-lm-footer-row">
        {model && (
          <p className="nesio-lm-gen-time">
            {L(dict, '模型生成于', 'Model generated')} {new Date(model.generatedAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        <button
          type="button"
          className="nesio-lm-refresh-btn"
          onClick={() => onRefresh()}
          title={L(dict, '重新生成', 'Regenerate')}
        >
          ↺
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function InsightsSheet({ onClose, initialTab }: { onClose: () => void; canUsePrivateData?: boolean; initialTab?: MainTab }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [mainTab, setMainTab] = useState<MainTab>(initialTab ?? 'reflection');
  const showPlaces = useFeatureEnabled('places');
  const showExperiment = useFeatureEnabled('experiment');
  const showHealth = useFeatureEnabled('health');
  const showFinance = useFeatureEnabled('finance');
  const showPeople = useFeatureEnabled('people');
  const tabEnabled = (t: MainTab): boolean =>
    t === 'timeline' ? showPlaces
      : t === 'health' ? showHealth
      : t === 'finance' ? showFinance
      : t === 'relationships' ? showPeople
      : true;
  useEffect(() => { if (!tabEnabled(mainTab)) setMainTab('reflection'); }, [showPlaces, showHealth, showFinance, showPeople, mainTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const [allNodes, setAllNodes] = useState<LifeNode[]>([]);
  const [labOn, setLabOn] = useState(false);
  const [wanderSeed, setWanderSeed] = useState(() => Math.floor(Math.random() * 100_000));

  // Living Model(Lab)
  const [livingModel, setLivingModel] = useState<LivingModel | null>(null);
  const [livingLoading, setLivingLoading] = useState(false);
  const [livingError, setLivingError] = useState<'no-key' | 'ai-error' | 'network' | null>(null);
  const livingFetchedRef = useRef(false);
  const livingSeqRef = useRef(0);

  useEffect(() => {
    setAllNodes(getLifeGraph());
  }, []);

  useEffect(() => {
    const sync = () => setLabOn(isLabModeOn());
    sync();
    window.addEventListener(LAB_MODE_EVENT, sync);
    return () => window.removeEventListener(LAB_MODE_EVENT, sync);
  }, []);

  // 免费四件套 + 生命版图的口径:剔除批量导入(通讯录/系统报告),只统计亲手记的
  const realNodes = useMemo(() => allNodes.filter((n) => !isBulkImported(n)), [allNodes]);

  // ① 主题门:近 30 天同标签 ≥3 条 → 一扇门(与详情页 L3 门同判据;真聚类挂账)
  const doors = useMemo(() => {
    const since = Date.now() - 30 * DAY_MS;
    const freq = new Map<string, number>();
    for (const n of realNodes) {
      if (new Date(n.createdAt).getTime() < since) continue;
      for (const t of n.tags ?? []) {
        if (!t || SYSTEM_TAGS.has(t)) continue;
        freq.set(t, (freq.get(t) ?? 0) + 1);
      }
    }
    return Array.from(freq.entries())
      .filter(([, c]) => c >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [realNodes]);

  // ② 没接上的线头:>30 天没再碰、没完成的想法/承诺(person/place/健康是实体,不算线头)
  const threads = useMemo(() => {
    const now = Date.now();
    return realNodes
      .filter((n) => {
        if (n.type === 'person' || n.type === 'place' || n.type === 'health_state') return false;
        if (n.attributes?.done === true) return false;
        if (n.lastConfirmedAt && n.lastConfirmedAt !== n.createdAt) return false;
        return (now - new Date(n.createdAt).getTime()) > 30 * DAY_MS;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [realNodes]);

  // ③ 走走看:随机翻一条 + 去年今天
  const wanderNode = useMemo(() => {
    if (!realNodes.length) return null;
    return realNodes[(wanderSeed * 31 + 17) % realNodes.length];
  }, [realNodes, wanderSeed]);
  const yearAgoNode = useMemo(() => {
    const target = Date.now() - 365 * DAY_MS;
    return realNodes.find((n) => Math.abs(new Date(n.createdAt).getTime() - target) <= 3 * DAY_MS) ?? null;
  }, [realNodes]);

  // ④ 一行节律:本月 N 条 · 多在晚上 · 说的比打的多
  const rhythm = useMemo(() => {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const monthNodes = realNodes.filter((n) => new Date(n.createdAt) >= start);
    const buckets = [
      { key: 'morning', label: '早上', labelEn: 'mornings', count: 0 },
      { key: 'afternoon', label: '下午', labelEn: 'afternoons', count: 0 },
      { key: 'evening', label: '晚上', labelEn: 'evenings', count: 0 },
      { key: 'night', label: '深夜', labelEn: 'late nights', count: 0 },
    ];
    const src = { voice: 0, manual: 0, photo: 0 };
    for (const n of monthNodes) {
      const h = new Date(n.createdAt).getHours();
      if (h >= 5 && h < 12) buckets[0].count++;
      else if (h >= 12 && h < 18) buckets[1].count++;
      else if (h >= 18) buckets[2].count++;
      else buckets[3].count++;
      if (n.source === 'voice') src.voice++;
      else if (n.source === 'photo') src.photo++;
      else if (n.source === 'manual') src.manual++;
    }
    const peak = [...buckets].sort((a, b) => b.count - a.count)[0];
    const parts: string[] = [L(dict, `本月 ${monthNodes.length} 条`, `${monthNodes.length} this month`)];
    if (monthNodes.length >= 5 && peak.count > monthNodes.length / 3) {
      parts.push(L(dict, `多在${peak.label}`, `mostly ${peak.labelEn}`));
    }
    if (src.voice + src.manual >= 5) {
      if (src.voice > src.manual) parts.push(L(dict, '说的比打的多', 'more spoken than typed'));
      else if (src.manual > src.voice) parts.push(L(dict, '打的比说的多', 'more typed than spoken'));
    }
    return { line: parts.join(' · '), count: monthNodes.length };
  }, [realNodes, dict]);

  // 生命版图门槛:≥90 天 + ≥6 条真实记录才出现;绝不以示例地形冒充
  const mapDays = useMemo(() => {
    if (!realNodes.length) return 0;
    const oldest = Math.min(...realNodes.map((n) => new Date(n.createdAt).getTime()));
    return Math.floor((Date.now() - oldest) / DAY_MS);
  }, [realNodes]);
  // 批次 32 用户拍板:门槛 90 → 21 天(与 21 天试用同节奏,试用结束刚好看到自己的版图)
  const mapEligible = realNodes.length >= 6 && mapDays >= 21;

  // 门/线头/走走看点进记忆页:关掉本 sheet 再广播(Portal 负责切到记忆面)
  const openInMemory = useCallback((query: string) => {
    onClose();
    window.dispatchEvent(new CustomEvent('nesio-memory-search', { detail: { query } }));
  }, [onClose]);

  // Living Model(Lab 块)
  const fetchLivingModel = useCallback(async (force = false) => {
    const all = getLifeGraph();
    const p = getMirrorProfile();
    const cached = loadLivingModel();

    if (!force && !shouldRefreshLivingModel(cached, all.length)) {
      setLivingModel(cached);
      return;
    }

    const mySeq = ++livingSeqRef.current;
    setLivingLoading(true);
    setLivingError(null);
    try {
      const feedbacks = loadLivingModelFeedbacks();
      const previousInsights = cached?.layers.flatMap((l) =>
        l.insights.map((i) => ({ layerId: l.id, content: i.content, userVerified: feedbacks[i.id] !== undefined ? feedbacks[i.id] : i.userVerified }))
      ) ?? [];

      const summary = summarizeForLivingModel({ nodes: all, mirrorProfile: p, previousInsights });

      const res = await fetch('/api/portal/living-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...summary,
          userName: loadProfileSettings().displayName,
        }),
      });
      const data = await res.json() as { ok: boolean; layers: LivingModelLayer[]; reason?: string };
      if (mySeq !== livingSeqRef.current) return;
      if (data.reason === 'no_api_key') {
        setLivingError('no-key');
        if (cached) setLivingModel(cached);
      } else if (data.reason === 'api_error') {
        setLivingError('ai-error');
        if (cached) setLivingModel(cached);
      } else if (data.ok && data.layers) {
        const model: LivingModel = {
          layers: data.layers,
          generatedAt: new Date().toISOString(),
          nodeCountAtGen: all.length,
        };
        saveLivingModel(model);
        setLivingModel(model);
      } else {
        setLivingError('ai-error');
        if (cached) setLivingModel(cached);
      }
    } catch {
      if (mySeq !== livingSeqRef.current) return;
      setLivingError('network');
      if (cached) setLivingModel(cached);
    } finally {
      if (mySeq === livingSeqRef.current) setLivingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mainTab === 'living' && labOn && !livingFetchedRef.current) {
      livingFetchedRef.current = true;
      void fetchLivingModel();
    }
  }, [mainTab, labOn, fetchLivingModel]);

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

  const monthNum = new Date().getMonth() + 1;
  const threadOldest = threads[0];
  const threadAgeLabel = threadOldest ? (() => {
    const days = Math.floor((Date.now() - new Date(threadOldest.createdAt).getTime()) / DAY_MS);
    const months = Math.floor(days / 30);
    return months >= 1 ? L(dict, `${months} 个月前`, `${months} mo ago`) : L(dict, `${days} 天前`, `${days} d ago`);
  })() : '';

  return (
    <div className="nesio-insights-sheet">
      {/* Header */}
      <div className="nesio-insights-header">
        <div className="nesio-insights-title-row">
          <h2 className="nesio-insights-title">{L(dict, '洞察', 'Insight')}</h2>
        </div>
        <button type="button" className="nesio-insights-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
      </div>

      {/* Main tabs */}
      <div className="nesio-insights-main-tabs">
        {(['reflection', 'health', 'timeline', 'finance', 'relationships', 'living'] as MainTab[]).filter(tabEnabled).map((t) => (
          <button
            key={t}
            type="button"
            className={`nesio-insights-main-tab${mainTab === t ? ' nesio-insights-main-tab--active' : ''}`}
            onClick={() => setMainTab(t)}
          >
            {t === 'reflection' ? L(dict, '洞察', 'Insights') : t === 'health' ? L(dict, '健康', 'Health') : t === 'timeline' ? L(dict, '足迹', 'Footprints') : t === 'finance' ? L(dict, '财务', 'Finance') : t === 'relationships' ? L(dict, '关系', 'People') : L(dict, '认知', 'Cognition')}
          </button>
        ))}
      </div>

      <div className="nesio-insights-body">

        {/* ── Tab 1: 免费四件套(v1 规格 §2.1)── */}
        {mainTab === 'reflection' && (
          <div className="nesio-reflection-tab">

            {/* ① 你在想什么(主题门) */}
            {doors.length > 0 && (
              <div className="nesio-insights-section">
                <p className="nesio-serif-voice">
                  {L(dict, `${monthNum} 月,占着你脑子的是 ——`, `${MONTHS_EN[monthNum - 1]} — what's been on your mind:`)}
                </p>
                <div className="nesio-theme-doors">
                  {doors.map(([tag, count]) => (
                    <button key={tag} type="button" className="nesio-theme-door" onClick={() => openInMemory(tag)}>
                      {tag} · {count} {L(dict, '条', '')} ›
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 生命版图:唯一保留的图(§2.2)。≥90 天才出现,不满门槛只说实话,不放示例 */}
            <div className="nesio-insights-section">
              <p className="nesio-insights-section-label">{L(dict, '生命版图', 'Life map')}<InfoTip text={L(dict, '五个领域(关系/事业/健康/成长/自我)的地形图:领土宽度由记录的意义密度决定(置信度+关联数+标签),不是数量;地形随时间演变,自动标出最大迁移。', 'A terrain of five domains (ties/work/health/growth/self). Territory width reflects meaning density (confidence + connections + tags), not count; it evolves over time and flags the biggest shift.')} /></p>
              {mapEligible ? (
                <>
                  <LifeCivilizationMap nodes={realNodes} />
                  <p className="nesio-insights-map-evidence">
                    {L(dict, `基于 ${realNodes.length} 条记录的意义密度`, `Meaning density from ${realNodes.length} notes`)}
                  </p>
                </>
              ) : (
                <p className="nesio-insights-empty">
                  {L(dict, `需要 21 天的记录才能成形 · 已积累 ${mapDays} 天`, `Takes shape after 21 days of notes · ${mapDays} days so far`)}
                </p>
              )}
            </div>

            {/* ② 没接上的线头 */}
            {threads.length > 0 && threadOldest && (
              <div className="nesio-insights-section">
                <p className="nesio-insights-section-label">{L(dict, '没接上的线头', 'Loose threads')}</p>
                <button type="button" className="nesio-thread-row" onClick={() => openInMemory(threadOldest.name)}>
                  {L(dict,
                    `${threads.length} 个想法没再碰,最老:${threadAgeLabel}「${threadOldest.name.slice(0, 18)}」›`,
                    `${threads.length} ideas untouched — oldest: "${threadOldest.name.slice(0, 24)}" ${threadAgeLabel} ›`)}
                </button>
              </div>
            )}

            {/* ③ 走走看 */}
            {wanderNode && (
              <div className="nesio-insights-section">
                <p className="nesio-insights-section-label">{L(dict, '走走看', 'Wander')}</p>
                <div className="nesio-wander-card">
                  <button type="button" className="nesio-wander-main" onClick={() => openInMemory(wanderNode.name)}>
                    <span className="nesio-wander-name">{wanderNode.name}</span>
                    <span className="nesio-wander-date">
                      {new Date(wanderNode.createdAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </button>
                  <button type="button" className="nesio-wander-reroll" onClick={() => setWanderSeed((s) => s + 1)}>
                    {L(dict, '换一条', 'Another')}
                  </button>
                </div>
                {yearAgoNode && (
                  <button type="button" className="nesio-thread-row" style={{ marginTop: '0.45rem' }} onClick={() => openInMemory(yearAgoNode.name)}>
                    {L(dict, `去年今天:「${yearAgoNode.name.slice(0, 18)}」›`, `A year ago today: "${yearAgoNode.name.slice(0, 24)}" ›`)}
                  </button>
                )}
              </div>
            )}

            {/* ④ 一行节律 + 迷你柱线 */}
            <div className="nesio-insights-section">
              <p className="nesio-insights-section-label">{L(dict, '节律', 'Rhythm')}</p>
              <p className="nesio-rhythm-line">{rhythm.line}</p>
              {realNodes.length > 0 && <WeekBarChart nodes={realNodes} />}
            </div>

            {/* 我的实验(Lab 功能开关,与提审隐藏同闸) */}
            {showExperiment && (
              <div className="nesio-insights-section">
                <p className="nesio-insights-section-label">{L(dict, '我的实验', 'My experiment')}</p>
                <MyExperimentWidget />
              </div>
            )}

            {/* NESIO 学到了什么(信任资产,§2.1 移页底) */}
            <LearningStatusPanel />

            {/* 页脚诚实声明 */}
            <p className="nesio-insights-cloud-note" style={{ marginTop: '1.25rem' }}>
              {L(dict, '全部来自本地统计 · 无 AI 推断 · 批量导入不计入', 'All local stats · no AI inference · bulk imports excluded')}
            </p>
          </div>
        )}

        {/* ── Tab: Timeline ── */}
        {mainTab === 'timeline' && showPlaces && (
          <div className="nesio-analytics-tab">
            <TimelineTab />
          </div>
        )}

        {/* ── Tab: Finance ── */}
        {mainTab === 'finance' && showFinance && <FinanceTab />}

        {/* ── Tab: 健康 Dashboard ── */}
        {mainTab === 'health' && showHealth && <HealthDashboard />}

        {/* ── Tab: 关系管理 ── */}
        {mainTab === 'relationships' && showPeople && <RelationshipsPanel />}

        {/* ── Tab: 认知 = 多面镜月度信(Pro);旧 7 层模型 + 节点图移 Lab ── */}
        {mainTab === 'living' && (
          <>
            <MirrorLetterTab />
            {labOn && (
              <div className="nesio-insights-section" style={{ marginTop: '1.4rem' }}>
                <p className="nesio-insights-section-label">{L(dict, 'Lab · 认知模型(内部)', 'Lab · Mind model (internal)')}</p>
                <LivingModelTab
                  model={livingModel}
                  loading={livingLoading}
                  error={livingError}
                  nodeCount={allNodes.length}
                  onRefresh={handleRefreshLiving}
                  onFeedback={handleFeedback}
                />
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
