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
import { MyExperimentWidget, loadExperiments, computeInsight } from '@/components/portal/NesioExperiment';
import LifeCivilizationMap from '@/components/portal/LifeCivilizationMap';
import RelationGraph from '@/components/portal/RelationGraph';
import type { GNode, GEdge } from '@/lib/platform/graph-engine';
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
import { IconBox, IconCheckCircle, IconClock, IconGear, IconSnowflake, IconTarget, IconUser } from './icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { InfoTip } from './InfoTip';
import { TimeBlocksWidget } from './today/TimeBlocksWidget';
import TimelineTab from './insights/TimelineTab';
import FinanceTab from './finance/FinanceTab';
import HealthDashboard from './health/HealthDashboard';
import RelationshipsPanel from './relationships/RelationshipsPanel';
import LearningStatusPanel from './LearningStatusPanel';
import { getFreezeItems } from '@/lib/platform/impulse-guard';

function loadFreezeLedger(): { total: number; skipped: number; bought: number } {
  const items = getFreezeItems();
  return {
    total: items.length,
    skipped: items.filter((x) => x.decision === 'skipped').length,
    bought: items.filter((x) => x.decision === 'bought').length,
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type MainTab = 'reflection' | 'analytics' | 'health' | 'timeline' | 'finance' | 'relationships' | 'living';
type Period = 'today' | 'week' | 'month';

interface FactBullet {
  icon: React.ReactNode;
  text: string;
}

interface DomainStat {
  label: string;
  count: number;
  color: string;
}

// ── Custom Widget Config ──────────────────────────────────────────────────────

export type InsightWidgetId = 'donut' | 'heatmap' | 'week_bar' | 'tag_cloud' | 'commitment_status' | 'my_experiment';

interface WidgetMeta {
  id: InsightWidgetId;
  label: string;
  labelEn: string;
  icon: string;
  description: string;
  descriptionEn: string;
}

const WIDGET_REGISTRY: WidgetMeta[] = [
  { id: 'donut',              label: '记录分布',   labelEn: 'Distribution',      icon: '🥧', description: '各类型记录占比（饼图）', descriptionEn: 'Share of each record type (pie)' },
  { id: 'heatmap',            label: '活动热力图', labelEn: 'Activity heatmap',  icon: '🗓', description: '每周各时段的记录密度', descriptionEn: 'Record density by weekday and time' },
  { id: 'week_bar',           label: '周趋势',     labelEn: 'Weekly trend',      icon: '📊', description: '最近8周记录数量变化', descriptionEn: 'Record count over the last 8 weeks' },
  { id: 'tag_cloud',          label: '高频标签',   labelEn: 'Top tags',          icon: '🏷', description: '出现最多的标签', descriptionEn: 'Most frequent tags' },
  { id: 'commitment_status',  label: '承诺状态',   labelEn: 'Commitments',       icon: '🤝', description: '待完成、即将到期、逾期汇总', descriptionEn: 'Pending, due soon, and overdue summary' },
  { id: 'my_experiment',      label: '我的实验',   labelEn: 'My experiment',     icon: '🧪', description: '自定义变量追踪，用数据说话', descriptionEn: 'Track your own variables — let data speak' },
];

const DEFAULT_WIDGETS: InsightWidgetId[] = ['donut', 'heatmap', 'my_experiment'];
const STORAGE_KEY = 'nesio-insights-widget-config';

function loadWidgetConfig(): InsightWidgetId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WIDGETS;
    const parsed = JSON.parse(raw) as InsightWidgetId[];
    // ensure valid
    const valid = new Set(WIDGET_REGISTRY.map((w) => w.id));
    return parsed.filter((id) => valid.has(id));
  } catch {
    return DEFAULT_WIDGETS;
  }
}

function saveWidgetConfig(ids: InsightWidgetId[]): void {
  // 兜底:配额满 / Safari 隐私模式会抛 QuotaExceededError,别让它从保存处理里冒出去。
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PERIOD_LABELS_ZH: Record<Period, string> = { today: '今日', week: '本周', month: '本月' };
const PERIOD_LABELS_EN: Record<Period, string> = { today: 'Today', week: 'Week', month: 'Month' };

const TYPE_COLOR: Record<string, string> = {
  commitment: 'var(--portal-cool-accent)',
  event:      'var(--portal-cool-accent)',
  health_state: 'var(--status-go)',
  person:     'var(--status-gentle)',
  place:      'var(--accent-info)',
  object:     'var(--accent-slate)',
  preference: 'var(--accent-rose)',
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

const TYPE_LABEL_EN: Record<string, string> = {
  commitment: 'Commitments',
  event:      'Events',
  health_state: 'Health',
  person:     'People',
  place:      'Places',
  object:     'Objects',
  preference: 'Preferences',
};

function typeLabel(dict: string, type: string): string {
  return (dict === 'en' ? TYPE_LABEL_EN[type] : TYPE_LABEL[type]) ?? L(dict, '其他', 'Other');
}

const HOUR_GROUPS = [
  { label: '清晨 6-9',  labelEn: 'early morning 6-9', hours: [6, 7, 8] },
  { label: '上午 9-12', labelEn: 'morning 9-12', hours: [9, 10, 11] },
  { label: '下午 12-18', labelEn: 'afternoon 12-18', hours: [12, 13, 14, 15, 16, 17] },
  { label: '晚上 18-23', labelEn: 'evening 18-23', hours: [18, 19, 20, 21, 22] },
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

function computeReflectionFacts(nodes: LifeNode[], all: LifeNode[], profile: MirrorProfile, dict: string = 'zh'): FactBullet[] {
  const facts: FactBullet[] = [];

  // 1. Record count
  if (nodes.length > 0) {
    facts.push({ icon: <IconBox size={15} />, text: L(dict, `记录了 ${nodes.length} 件事`, `${nodes.length} things noted`) });
  } else {
    facts.push({ icon: <IconBox size={15} />, text: L(dict, '这段时间还没有新记录', 'No new notes in this period') });
  }

  // 2. Completion rate
  const commitments = nodes.filter((n) => n.type === 'commitment' || n.type === 'event');
  const done = commitments.filter((n) => n.attributes.done === true);
  if (commitments.length > 0) {
    const rate = Math.round((done.length / commitments.length) * 100);
    facts.push({ icon: <IconCheckCircle size={15} />, text: L(dict, `承诺完成率 ${rate}%（${done.length}/${commitments.length} 件）`, `Promise completion ${rate}% (${done.length}/${commitments.length})`) });
  }

  // 3. Top domain
  const domainMap: Record<string, number> = {};
  for (const n of nodes) {
    let domain = '';
    if (typeof n.attributes.context === 'string') {
      try { domain = (JSON.parse(n.attributes.context) as { domain?: string }).domain ?? ''; } catch { /* ignore */ }
    }
    if (!domain && n.tags?.[0]) domain = n.tags[0];
    if (!domain) domain = typeLabel(dict, n.type);
    domainMap[domain] = (domainMap[domain] ?? 0) + 1;
  }
  const topDomain = Object.entries(domainMap).sort(([, a], [, b]) => b - a)[0];
  if (topDomain && nodes.length > 1) {
    facts.push({ icon: <IconTarget size={15} />, text: L(dict, `最集中在「${topDomain[0]}」（${topDomain[1]} 条，占 ${Math.round(topDomain[1] / nodes.length * 100)}%）`, `Most focused on "${topDomain[0]}" (${topDomain[1]}, ${Math.round(topDomain[1] / nodes.length * 100)}%)`) });
  }

  // 4. Active hour
  const bestGroup = HOUR_GROUPS
    .map((g) => ({ ...g, score: avg(g.hours.map((h) => profile.hourEngagement[h])) }))
    .sort((a, b) => b.score - a.score)[0];
  if (bestGroup && bestGroup.score > 0.5) {
    facts.push({ icon: <IconClock size={15} />, text: L(dict, `你的黄金时段在${bestGroup.label}`, `Your golden hours: ${bestGroup.labelEn}`) });
  }

  // 4.4 进行中实验(批次 8:打卡数据与洞察关联)
  try {
    for (const exp of loadExperiments().filter((e) => !e.concluded)) {
      if (exp.dataPoints.length < 3) continue;
      const ins = computeInsight(exp, dict);
      facts.push({
        icon: <IconTarget size={15} />,
        text: L(dict, `实验「${exp.name.slice(0, 12)}」已记录 ${exp.dataPoints.length} 天:${ins.text.slice(0, 40)}`, `Experiment "${exp.name.slice(0, 12)}", ${exp.dataPoints.length} days in: ${ins.text.slice(0, 60)}`),
      });
      break; // 洞察区只放一条,详情在 分析→我的实验
    }
  } catch { /* ignore */ }

  // 4.5 冲动冷静账本(批次 7:劝住/没劝住都可见)
  try {
    const freeze = loadFreezeLedger();
    if (freeze.skipped + freeze.bought > 0) {
      facts.push({
        icon: <IconSnowflake size={15} />,
        text: L(dict, `冲动冷静:冻过 ${freeze.total} 次,${freeze.skipped} 次最后没买(省下了),${freeze.bought} 次还是买了`, `Impulse cooling: ${freeze.total} frozen, ${freeze.skipped} skipped (saved), ${freeze.bought} bought anyway`),
      });
    }
  } catch { /* ignore */ }

  // 5. Top person —— 按真实频次排序(被多少条记录的关系指到 + 自身关系数),不是插入顺序。
  const personMentions = (p: LifeNode) =>
    all.reduce((c, n) => c + ((n.relations || []).some((r) => r.targetId === p.id) ? 1 : 0), 0) + (p.relations?.length || 0);
  const persons = all
    .filter((n) => n.type === 'person')
    .map((p) => ({ p, c: personMentions(p) }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 3)
    .map((x) => x.p);
  if (persons.length > 0) {
    facts.push({ icon: <IconUser size={15} />, text: L(dict, `最常出现的人：${persons.map((p) => p.name).join('、')}`, `Most frequent people: ${persons.map((p) => p.name).join(', ')}`) });
  }

  return facts.slice(0, 5);
}

// ── Analytics: Domain Distribution (SVG donut) ────────────────────────────────

function DonutChart({ data }: { data: DomainStat[] }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  if (data.length === 0) return <p className="nesio-insights-empty">{L(dict, '暂无数据', 'No data yet')}</p>;

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
        <text x={cx} y={cy + 9} textAnchor="middle" fontSize="8" fill="var(--portal-muted)">{L(dict, '条记录', 'records')}</text>
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
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  // Grid: rows = day-of-week (Mon–Sun), cols = time buckets (0–5, 6–11, 12–17, 18–23)
  const DAYS = ['一', '二', '三', '四', '五', '六', '日'];
  const DAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayLabel = (di: number) => L(dict, `周${DAYS[di]}`, DAYS_EN[di]);
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

  if (maxVal === 0) return <p className="nesio-insights-empty">{L(dict, '暂无活动数据', 'No activity yet')}</p>;

  return (
    <div className="nesio-heatmap">
      <div className="nesio-heatmap-labels-top">
        {SLOTS.map((s) => <span key={s} className="nesio-heatmap-col-label">{s}</span>)}
      </div>
      {counts.map((row, di) => (
        <div key={di} className="nesio-heatmap-row">
          <span className="nesio-heatmap-row-label">{dayLabel(di)}</span>
          {row.map((v, si) => {
            const intensity = maxVal > 0 ? v / maxVal : 0;
            const alpha = intensity > 0 ? 0.15 + intensity * 0.75 : 0;
            return (
              <div
                key={si}
                className="nesio-heatmap-cell"
                style={{ background: alpha > 0 ? `rgba(88,140,227,${alpha.toFixed(2)})` : 'var(--portal-line)' }}
                title={L(dict, `周${DAYS[di]} ${SLOTS[si]}: ${v} 条`, `${DAYS_EN[di]} ${SLOTS[si]}: ${v}`)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Widget: Week Bar Chart ────────────────────────────────────────────────────

function WeekBarChart({ nodes }: { nodes: LifeNode[] }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const now = Date.now();
  const buckets: { label: string; count: number }[] = [];

  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now - i * 7 * 86_400_000);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
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

// ── Widget: Tag Cloud ─────────────────────────────────────────────────────────

function TagCloud({ nodes }: { nodes: LifeNode[] }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const freq: Record<string, number> = {};
  for (const n of nodes) {
    for (const tag of n.tags ?? []) freq[tag] = (freq[tag] ?? 0) + 1;
  }
  const tags = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12);

  if (!tags.length) return <p className="nesio-insights-empty">{L(dict, '暂无标签数据', 'No tags yet')}</p>;

  const maxFreq = tags[0][1];
  return (
    <div className="nesio-tag-cloud">
      {tags.map(([tag, count]) => {
        const size = 0.75 + (count / maxFreq) * 0.6;
        const opacity = 0.5 + (count / maxFreq) * 0.5;
        return (
          <span
            key={tag}
            className="nesio-tag-cloud-item"
            style={{ fontSize: `${size}rem`, opacity }}
            title={L(dict, `${count} 次`, `${count}×`)}
          >
            {tag}
          </span>
        );
      })}
    </div>
  );
}

// ── Widget: Commitment Status ─────────────────────────────────────────────────

function CommitmentStatusWidget({ nodes }: { nodes: LifeNode[] }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const commitments = nodes.filter((n) => n.type === 'commitment');
  if (!commitments.length) return <p className="nesio-insights-empty">{L(dict, '没有承诺/任务记录', 'No commitments yet')}</p>;

  const now = Date.now();
  const overdue: LifeNode[] = [];
  const dueSoon: LifeNode[] = [];
  const pending: LifeNode[] = [];
  const noDate: LifeNode[] = [];

  for (const n of commitments) {
    const due = n.attributes?.dueDate ?? n.attributes?.due ?? n.attributes?.date;
    if (!due) { noDate.push(n); continue; }
    const daysLeft = Math.ceil((new Date(due as string).getTime() - now) / 86_400_000);
    if (daysLeft < 0) overdue.push(n);
    else if (daysLeft <= 3) dueSoon.push(n);
    else pending.push(n);
  }

  const groups = [
    { label: L(dict, '已逾期', 'Overdue'), items: overdue, accent: 'var(--status-risk)' },
    { label: L(dict, '即将到期（3天内）', 'Due soon (within 3 days)'), items: dueSoon, accent: 'var(--status-gentle)' },
    { label: L(dict, '进行中', 'In progress'), items: pending, accent: 'var(--portal-cool-accent)' },
    { label: L(dict, '无截止日', 'No due date'), items: noDate, accent: 'var(--accent-muted)' },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="nesio-commitment-widget">
      {groups.map((g) => (
        <div key={g.label} className="nesio-commitment-group">
          <div className="nesio-commitment-group-header">
            <span className="nesio-commitment-dot" style={{ background: g.accent }} />
            <span className="nesio-commitment-group-label">{g.label}</span>
            <span className="nesio-commitment-group-count">{g.items.length}</span>
          </div>
          {g.items.slice(0, 3).map((n) => (
            <div key={n.id} className="nesio-commitment-item">{n.name}</div>
          ))}
          {g.items.length > 3 && (
            <div className="nesio-commitment-more">{L(dict, `还有 ${g.items.length - 3} 项…`, `${g.items.length - 3} more…`)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Widget Customizer Sheet ───────────────────────────────────────────────────

function WidgetCustomizerSheet({
  active,
  onClose,
  onSave,
}: {
  active: InsightWidgetId[];
  onClose: () => void;
  onSave: (ids: InsightWidgetId[]) => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [selected, setSelected] = useState<InsightWidgetId[]>(active);

  function toggle(id: InsightWidgetId) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // maintain order: registry order
  const ordered = WIDGET_REGISTRY.map((w) => w.id).filter((id) => selected.includes(id));

  return (
    <div className="nesio-widget-customizer-overlay" onClick={onClose}>
      <div className="nesio-widget-customizer-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="nesio-widget-customizer-header">
          <span className="nesio-widget-customizer-title">{L(dict, '自定义显示', 'Customize display')}</span>
          <button type="button" className="nesio-widget-customizer-close" onClick={onClose}>✕</button>
        </div>
        <p className="nesio-widget-customizer-hint">{L(dict, '选择你想在「分析」中看到的模块', 'Choose the modules to show in Analytics')}</p>
        <div className="nesio-widget-customizer-list">
          {WIDGET_REGISTRY.map((w) => {
            const isOn = selected.includes(w.id);
            return (
              <button
                key={w.id}
                type="button"
                className={`nesio-widget-option${isOn ? ' nesio-widget-option--on' : ''}`}
                onClick={() => toggle(w.id)}
              >
                <div className="nesio-widget-option-text">
                  <span className="nesio-widget-option-label">{L(dict, w.label, w.labelEn)}</span>
                  <span className="nesio-widget-option-desc">{L(dict, w.description, w.descriptionEn)}</span>
                </div>
                <span className="nesio-widget-option-check">{isOn ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="nesio-widget-customizer-save"
          onClick={() => { onSave(ordered); onClose(); }}
          disabled={ordered.length === 0}
        >
          {L(dict, `保存（${ordered.length} 个模块）`, `Save (${ordered.length} modules)`)}
        </button>
      </div>
    </div>
  );
}

// ── Living Model: Perspectives ───────────────────────────────────────────────

interface Perspective { id: string; name: string; nameEn: string; icon: string; desc: string; descEn: string; prompt: string }

// prompt 发给 AI 生成中文认知模型,保留中文(与 CameraSheet 提示词同策略)
const PERSPECTIVES: Perspective[] = [
  { id: 'director',     name: '导演视角',    nameEn: 'Director',        icon: '🎬', desc: '用旁观者视角看自己的剧情',         descEn: 'Watch your own plot as an outsider',            prompt: '从导演的视角分析用户：你是在拍摄用户生活的导演，观察剧情走向、角色动机、潜在的剧情转折点。' },
  { id: 'tasha',        name: '塔莎·尤里奇', nameEn: 'Tasha Eurich',    icon: '🪞', desc: '自我洞察：行为背后的深层动机',     descEn: 'Self-insight: motives behind behavior',         prompt: '运用塔莎·尤里奇的自我洞察框架：聚焦于用户行为背后真实的"为什么"，区分自我感知与他人眼中的实际行为模式。' },
  { id: 'cbt',          name: 'CBT认知行为', nameEn: 'CBT',             icon: '🧠', desc: '识别思维扭曲，建立理性解读',       descEn: 'Spot distortions, build rational reads',        prompt: '从认知行为疗法（CBT）视角：识别用户记录中可能存在的思维扭曲、认知误差，以及更理性的替代解读。' },
  { id: 'second_order', name: '二阶思考',    nameEn: 'Second-order',    icon: '🔗', desc: '行动的后果，后果的后果',           descEn: 'Consequences of consequences',                  prompt: '从二阶思维视角：不只看行为本身，分析其直接后果，以及这些后果带来的次级影响和长远连锁反应。' },
  { id: 'energy',       name: '能量视角',    nameEn: 'Energy',          icon: '⚡', desc: '什么消耗你，什么给你充电',         descEn: 'What drains you, what recharges you',           prompt: '从能量管理视角：分析用户的行为模式哪些在消耗生命能量，哪些在积累能量，如何优化能量分配。' },
  { id: 'stoic',        name: '斯多葛',      nameEn: 'Stoic',           icon: '🏛', desc: '区分你能控制的和不能控制的',       descEn: 'What you control vs. what you cannot',          prompt: '从斯多葛哲学视角：区分用户生活中可以控制的事与不可控制的事，聚焦于前者，接受后者。' },
  { id: 'pareto',       name: '帕累托20/80', nameEn: 'Pareto 20/80',    icon: '📊', desc: '20% 行动带来 80% 结果',           descEn: '20% of actions drive 80% of results',           prompt: '从帕累托原则视角：找出用户行为中最关键的 20%，这部分可能带来了 80% 的正向结果或负向问题。' },
  { id: 'flow',         name: '心流状态',    nameEn: 'Flow',            icon: '🌊', desc: '什么时候你处于最佳状态',           descEn: 'When you are at your best',                     prompt: '从心流（Flow）理论视角：分析用户何时处于最佳心流状态，什么条件触发或打断心流，如何创造更多心流时间。' },
  { id: 'attachment',   name: '依恋理论',    nameEn: 'Attachment',      icon: '❤️', desc: '人际关系中的模式和需求',           descEn: 'Patterns and needs in relationships',           prompt: '从依恋理论视角：分析用户的人际关系模式、依恋风格、亲密关系中的需求与防御机制。' },
  { id: 'somatic',      name: '身体感受',    nameEn: 'Somatic',         icon: '🫀', desc: '身体信号与情绪的连接',             descEn: 'Body signals and emotion links',                prompt: '从身体感受（Somatic）视角：关注用户记录中隐含的身体信号、身心连接、压力的身体化表现。' },
  { id: 'narrative',    name: '叙事疗法',    nameEn: 'Narrative',       icon: '📖', desc: '用故事视角重构自己的经历',         descEn: 'Rewrite your experience as a story',            prompt: '从叙事疗法视角：分析用户为自己的生活构建了怎样的故事，哪些主题反复出现，可以如何重写更有力量的叙事。' },
  { id: 'focus',        name: '专注力',      nameEn: 'Focus',           icon: '🎯', desc: '哪些事分散了注意力',               descEn: 'What scatters your attention',                  prompt: '从注意力管理视角：识别分散用户专注力的因素、注意力消耗模式，以及提升深度专注的机会。' },
  { id: 'reverse',      name: '逆向思维',    nameEn: 'Inversion',       icon: '🔄', desc: '先想最糟情况，再反推预防',         descEn: 'Imagine the worst, then work backwards',        prompt: '从逆向思维（Inversion）视角：先推导用户最不想发生的结果，再分析当前行为模式是否在无意中接近这些结果。' },
];

function PerspectiveSheet({
  current,
  onSelect,
  onClose,
}: {
  current: string;
  onSelect: (p: Perspective | null) => void;
  onClose: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  return (
    <div className="nesio-widget-customizer-overlay" onClick={onClose}>
      <div className="nesio-widget-customizer-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="nesio-widget-customizer-header">
          <span className="nesio-widget-customizer-title">{L(dict, '选择分析视角', 'Choose a lens')}</span>
          <button type="button" className="nesio-widget-customizer-close" onClick={onClose}>✕</button>
        </div>
        <p className="nesio-widget-customizer-hint">{L(dict, '选择一个视角，AI 将从该框架重新分析你的认知模型', 'Pick a lens and the AI will re-analyze your mind model through it')}</p>
        <div className="nesio-widget-customizer-list">
          <button
            type="button"
            className={`nesio-widget-option${!current ? ' nesio-widget-option--on' : ''}`}
            onClick={() => { onSelect(null); onClose(); }}
          >
            <span className="nesio-widget-option-icon">🧩</span>
            <div className="nesio-widget-option-text">
              <span className="nesio-widget-option-label">{L(dict, '默认综合视角', 'Default (holistic)')}</span>
              <span className="nesio-widget-option-desc">{L(dict, '不限定视角，AI 自由推断', 'No fixed lens — AI infers freely')}</span>
            </div>
            {!current && <span className="nesio-widget-option-check">✓</span>}
          </button>
          {PERSPECTIVES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`nesio-widget-option${current === p.id ? ' nesio-widget-option--on' : ''}`}
              onClick={() => { onSelect(p); onClose(); }}
            >
              <div className="nesio-widget-option-text">
                <span className="nesio-widget-option-label">{L(dict, p.name, p.nameEn)}</span>
                <span className="nesio-widget-option-desc">{L(dict, p.desc, p.descEn)}</span>
              </div>
              {current === p.id && <span className="nesio-widget-option-check">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Living Model: Confidence Bar ──────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 85 ? 'var(--status-go)' : value >= 70 ? 'var(--portal-cool-accent)' : value >= 55 ? 'var(--status-gentle)' : 'var(--portal-muted)';
  return (
    <div className="nesio-lm-confidence">
      <div className="nesio-lm-conf-track">
        <div className="nesio-lm-conf-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="nesio-lm-conf-label" style={{ color }}>{value}%</span>
    </div>
  );
}

// ── Model graph builders ──────────────────────────────────────────────────────

const LAYER_GRAPH_COLOR: Record<string, string> = {
  identity:    'var(--portal-accent)',
  motivation:  'var(--status-gentle)',
  principles:  'var(--status-go)',
  patterns:    'var(--status-calm)',
  blind_spots: 'var(--status-risk)',
  evolution:   'var(--portal-cool-accent)',
  prediction:  'var(--portal-muted)',
};

function buildModelGraphNodes(model: LivingModel | null, dict: string = 'zh'): GNode[] {
  if (!model) {
    // Demo nodes for empty state
    return [
      { id: 'identity::0', label: L(dict, '身份认同', 'Identity'), weight: 0.7, color: LAYER_GRAPH_COLOR['identity'] },
      { id: 'motivation::0', label: L(dict, '创造渴望', 'Urge to create'), weight: 0.8, color: LAYER_GRAPH_COLOR['motivation'] },
      { id: 'patterns::0', label: L(dict, '夜晚思考', 'Night thinking'), weight: 0.65, color: LAYER_GRAPH_COLOR['patterns'] },
      { id: 'blind_spots::0', label: L(dict, '低估关系', 'Undervaluing ties'), weight: 0.6, color: LAYER_GRAPH_COLOR['blind_spots'] },
      { id: 'evolution::0', label: L(dict, '健康关注', 'Health focus'), weight: 0.7, color: LAYER_GRAPH_COLOR['evolution'] },
    ];
  }
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
  if (!model) {
    return [
      { source: 'identity::0', target: 'motivation::0', weight: 0.6 },
      { source: 'motivation::0', target: 'evolution::0', weight: 0.4 },
      { source: 'patterns::0', target: 'blind_spots::0', weight: 0.5 },
      { source: 'identity::0', target: 'patterns::0', weight: 0.3 },
    ];
  }
  const edges: GEdge[] = [];
  const seen = new Set<string>();

  // Same-layer pairs (sequential)
  for (const layer of model.layers) {
    const layerNodes = layer.insights
      .filter(i => i.confidence >= 50)
      .map((_, idx) => `${layer.id}::${idx}`);
    for (let i = 0; i < layerNodes.length - 1; i++) {
      const key = `${layerNodes[i]}|${layerNodes[i + 1]}`;
      if (!seen.has(key)) { seen.add(key); edges.push({ source: layerNodes[i], target: layerNodes[i + 1], weight: 0.4 }); }
    }
  }

  // Cross-layer: insights sharing evidenceRefs
  const allInsights = model.layers.flatMap((l, li) =>
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

// ── Living Model Tab ──────────────────────────────────────────────────────────

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
  error: 'ai' | 'network' | null;
  nodeCount: number;
  onRefresh: (perspectiveId?: string, perspectiveName?: string, perspectivePrompt?: string) => void;
  onFeedback: (insightId: string, verified: boolean) => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [expandedLayer, setExpandedLayer] = useState<LivingModelLayerId | null>('identity');
  const [selectedPerspective, setSelectedPerspective] = useState<Perspective | null>(null);
  const [showPerspectiveSheet, setShowPerspectiveSheet] = useState(false);
  // 批次 13:空态下七个维度折叠可展开(用户:「是折叠不是消失,想让人知道有什么」)
  const [dimsOpen, setDimsOpen] = useState(false);

  if (loading) {
    return (
      <div className="nesio-lm-loading">
        <span className="nesio-focus-decompose-spinner" />
        <span>{L(dict, 'Nesio 正在深度思考你的认知模型…', 'Nesio is thinking hard about your mind model…')}</span>
      </div>
    );
  }

  // ⑨ 生成失败的可见态(区分 AI 未配置/失败 vs 网络 vs 没数据);复用降级提示样式
  const errorBanner = error ? (
    <p className="nesio-chat-degraded-hint" style={{ margin: '0 0 0.75rem' }}>
      {error === 'ai'
        ? L(dict, '认知模型这次没生成成功(AI 未配置或暂时不可用)——不是没有数据。下面是上次的结果,稍后可重试。', "Mind model didn't generate (AI not configured or temporarily unavailable) — not a lack of data. Showing your last result; retry later.")
        : L(dict, '网络异常,认知模型没刷新出来——不是没有数据。下面是上次的结果。', "Network issue — the mind model didn't refresh. Not a lack of data; showing your last result.")}
    </p>
  ) : null;

  const layerIds: LivingModelLayerId[] = ['identity', 'motivation', 'principles', 'patterns', 'blind_spots', 'evolution', 'prediction'];
  const layers = model
    ? model.layers
    : layerIds.map((id) => ({ id, label: LAYER_META[id].label, icon: LAYER_META[id].icon, insights: [], minConfidenceToShow: LAYER_META[id].minConfidence }));

  const hasAnyInsight = layers.some((l) => l.insights.length > 0);

  // 批次 11:空态收成一句话(此前四段文案说同一件事),给真实进度而不是空话
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
            <InfoTip text={L(dict, '每条结论都带证据和置信度，可校正;类型分布/领域/完成率/活跃时段等行为统计交给 AI 推断,新增 8 条或 7 天后自动更新。', 'Every conclusion is evidence-backed, confidence-scored and correctable. Behavior stats (types / domains / completion / active hours) go to AI inference; refreshes after 8 new notes or 7 days.')} />
          </p>

          {enough && (
            <button type="button" className="nesio-lm-perspective-btn" style={{ marginTop: '0.6rem' }} onClick={() => onRefresh()}>
              {L(dict, '生成模型', 'Build model')}
            </button>
          )}
        </div>
        {/* 七个维度:折叠组,展开可看每一层是什么 */}
        <div className="nesio-lm-layers-menu" style={{ marginTop: '0.75rem' }}>
          <div className="nesio-lm-layer">
            <button type="button" className="nesio-lm-layer-header" onClick={() => setDimsOpen((v) => !v)} aria-expanded={dimsOpen}>
              <span className="nesio-lm-layer-label">{L(dict, '7 个维度', '7 layers')}</span>
              <span className="nesio-lm-layer-empty-badge">{L(dict, '积累中', 'Gathering')}</span>
              <span className="nesio-lm-layer-chevron">{dimsOpen ? '▴' : '▾'}</span>
            </button>
            {dimsOpen && (
              <div className="nesio-lm-layer-body">
                {layerIds.map((id) => (
                  <div key={id} className="nesio-lm-insight" style={{ padding: '0.4rem 0' }}>
                    <p className="nesio-lm-insight-content" style={{ margin: 0 }}>
                      {L(dict, LAYER_META[id].label, LAYER_META[id].labelEn)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 有洞察的层展开可看;还没攒够的层合并成一行,不再占 7 行「积累中」
  const withInsights = layers.filter((l) => l.insights.some((i) => i.confidence >= l.minConfidenceToShow));
  const gathering = layers.filter((l) => !l.insights.some((i) => i.confidence >= l.minConfidenceToShow));

  return (
    <div className="nesio-lm-tab">
      {errorBanner}
      <p className="nesio-lm-subtitle">
        {L(dict, '来自你的记录，每条结论都可校正。', 'From your notes — every conclusion is correctable.')}
        <InfoTip text={L(dict, '算法：类型分布 / 领域 / 完成率 / 活跃时段等行为统计交给 AI 推断；新增 8 条记录或 7 天后自动更新；你的 ✓ / ✗ 会进入下一次生成。', 'How it works: behavior stats (types / domains / completion / active hours) go to AI inference; refreshes after 8 new notes or 7 days; your ✓ / ✗ feeds the next run.')} />
      </p>

      {/* 认知关系图 */}
      <div className="nesio-insights-section" style={{ marginTop: 'var(--space-2)' }}>
        <p className="nesio-insights-section-label">{L(dict, '认知关系图', 'Cognition graph')}<InfoTip text={L(dict, '把认知模型的各层结论连成图:点任一节点展开它所属的维度详情。', 'Your mind-model conclusions as a graph — tap a node to expand its layer.')} /></p>
        <RelationGraph
          nodes={buildModelGraphNodes(model, dict)}
          edges={buildModelGraphEdges(model, dict)}
          height={260}
          onNodeClick={(id) => {
            // id format: "layerId::insightIdx"
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
            {selectedPerspective && <span className="nesio-lm-perspective-badge"> · {L(dict, selectedPerspective.name, selectedPerspective.nameEn)}</span>}
          </p>
        )}
        <button
          type="button"
          className="nesio-lm-perspective-btn"
          onClick={() => setShowPerspectiveSheet(true)}
          title={L(dict, '选择分析视角', 'Choose a lens')}
        >
          <IconTarget size={13} /> {selectedPerspective ? L(dict, selectedPerspective.name, selectedPerspective.nameEn) : L(dict, '视角', 'Lens')}
        </button>
        <button
          type="button"
          className="nesio-lm-refresh-btn"
          onClick={() => onRefresh(selectedPerspective?.id, selectedPerspective?.name, selectedPerspective?.prompt)}
          title={L(dict, '重新生成', 'Regenerate')}
        >
          ↺
        </button>
      </div>

      {showPerspectiveSheet && (
        <PerspectiveSheet
          current={selectedPerspective?.id ?? ''}
          onSelect={(p) => {
            setSelectedPerspective(p);
            onRefresh(p?.id, p?.name, p?.prompt);
          }}
          onClose={() => setShowPerspectiveSheet(false)}
        />
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function InsightsSheet({ onClose, canUsePrivateData = true, initialTab }: { onClose: () => void; canUsePrivateData?: boolean; initialTab?: MainTab }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [mainTab, setMainTab] = useState<MainTab>(initialTab ?? 'reflection');
  const [period, setPeriod] = useState<Period>('week');
  const [profile, setProfile] = useState<MirrorProfile | null>(null);
  const [allNodes, setAllNodes] = useState<LifeNode[]>([]);
  const [periodNodes, setPeriodNodes] = useState<LifeNode[]>([]);
  const [activeWidgets, setActiveWidgets] = useState<InsightWidgetId[]>(DEFAULT_WIDGETS);
  const [showCustomizer, setShowCustomizer] = useState(false);

  // Reflection
  const [facts, setFacts] = useState<FactBullet[]>([]);
  const [domainStats, setDomainStats] = useState<DomainStat[]>([]);

  // Living Model
  const [livingModel, setLivingModel] = useState<LivingModel | null>(null);
  const [livingLoading, setLivingLoading] = useState(false);
  // ⑨ 认知模型生成失败的可见态:区分「AI 未配置/失败」与「数据不够」(后者由 nodeCount 判)
  const [livingError, setLivingError] = useState<'ai' | 'network' | null>(null);
  const livingFetchedRef = useRef(false);
  const livingSeqRef = useRef(0); // 视角切换会并发发多次请求;只认最新一次的结果,防止旧视角内容错标

  // Load base data
  useEffect(() => {
    const p = getMirrorProfile();
    setProfile(p);
    const all = getLifeGraph();
    setAllNodes(all);
    setActiveWidgets(loadWidgetConfig());
  }, []);

  // Recompute when period changes
  useEffect(() => {
    if (!profile) return;
    const all = getLifeGraph();
    const since = periodStart(period);
    const filtered = all.filter((n) => new Date(n.createdAt) >= since);
    setPeriodNodes(filtered);

    // Reflection facts
    setFacts(computeReflectionFacts(filtered, all, profile, dict));

    // Domain distribution
    const domainMap: Record<string, { count: number; color: string }> = {};
    for (const n of filtered) {
      const label = typeLabel(dict, n.type);
      const color = TYPE_COLOR[n.type] ?? 'var(--portal-muted)';
      if (!domainMap[label]) domainMap[label] = { count: 0, color };
      domainMap[label].count++;
    }
    setDomainStats(
      Object.entries(domainMap)
        .map(([label, { count, color }]) => ({ label, count, color }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 7),
    );
  }, [period, profile, dict]);

  // Living Model: load cached or generate
  const fetchLivingModel = useCallback(async (
    force = false,
    perspectiveId?: string,
    perspectiveName?: string,
    perspectivePrompt?: string,
  ) => {
    const all = getLifeGraph();
    const p = getMirrorProfile();
    const cached = loadLivingModel();

    if (!force && !perspectiveId && !shouldRefreshLivingModel(cached, all.length)) {
      setLivingModel(cached);
      return;
    }

    const mySeq = ++livingSeqRef.current; // 本次请求序号
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
          perspectiveId,
          perspectiveName,
          perspectivePrompt,
        }),
      });
      const data = await res.json() as { ok: boolean; layers: LivingModelLayer[] };
      if (mySeq !== livingSeqRef.current) return; // 已被更晚的视角请求取代 → 丢弃,避免错标/错存
      if (data.ok && data.layers) {
        const model: LivingModel = {
          layers: data.layers,
          generatedAt: new Date().toISOString(),
          nodeCountAtGen: all.length,
        };
        saveLivingModel(model);
        setLivingModel(model);
      } else {
        // AI 生成失败(未配置 key / 上游报错)—— 不是没数据。留住旧结果,显式标失败。
        setLivingError('ai');
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

  const handleRefreshLiving = useCallback((perspectiveId?: string, perspectiveName?: string, perspectivePrompt?: string) => {
    livingFetchedRef.current = true;
    void fetchLivingModel(true, perspectiveId, perspectiveName, perspectivePrompt);
  }, [fetchLivingModel]);

  return (
    <div className="nesio-insights-sheet">
      {/* Header */}
      <div className="nesio-insights-header">
        <div className="nesio-insights-title-row">
          {/* 批次 17:星星去掉,改名「洞察 / Insight」 */}
          <h2 className="nesio-insights-title">{L(dict, '洞察', 'Insight')}</h2>
        </div>
        <button type="button" className="nesio-insights-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
      </div>

      {/* Main tabs */}
      <div className="nesio-insights-main-tabs">
        {(['reflection', 'health', 'timeline', 'finance', 'relationships', 'living'] as MainTab[]).map((t) => (
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
                  {(dict === 'en' ? PERIOD_LABELS_EN : PERIOD_LABELS_ZH)[p]}
                </button>
              ))}
            </div>

            {/* Fact bullets */}
            <div className="nesio-reflection-facts">
              {facts.length === 0 ? (
                <p className="nesio-insights-empty">{L(dict, '暂无数据 · 多记录一些内容', 'No data yet · add a few notes')}</p>
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
                <span className="nesio-insights-stat-label">{(dict === 'en' ? PERIOD_LABELS_EN : PERIOD_LABELS_ZH)[period]}{L(dict, '记录', ' notes')}</span>
              </div>
              <div className="nesio-insights-stat-divider" />
              <div className="nesio-insights-stat">
                <span className="nesio-insights-stat-num">{allNodes.length}</span>
                <span className="nesio-insights-stat-label">{L(dict, '总记忆', 'Total')}</span>
              </div>
              <div className="nesio-insights-stat-divider" />
              <div className="nesio-insights-stat">
                <span className="nesio-insights-stat-num">{profile?.feedbackCount ?? 0}</span>
                <span className="nesio-insights-stat-label">{L(dict, '次互动', 'Interactions')}</span>
              </div>
            </div>

            <p className="nesio-insights-cloud-note" style={{ marginTop: '1.25rem' }}>
              {L(dict, '以上数据来自本地记录 · 无 AI 推断', 'All from local notes · no AI inference')}
            </p>
          </div>
        )}

        {/* ── 批次 40:分析并入洞察(同 tab 内接在洞察下方)── */}
        {mainTab === 'reflection' && (
          <div className="nesio-analytics-tab">
            {/* Header row: period switcher + customize button */}
            <div className="nesio-analytics-header-row">
              <div className="nesio-insights-period-tabs">
                {(['today', 'week', 'month'] as Period[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`nesio-insights-tab${period === p ? ' nesio-insights-tab--active' : ''}`}
                    onClick={() => setPeriod(p)}
                  >
                    {(dict === 'en' ? PERIOD_LABELS_EN : PERIOD_LABELS_ZH)[p]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="nesio-analytics-customize-btn"
                onClick={() => setShowCustomizer(true)}
                title={L(dict, '自定义显示模块', 'Customize modules')}
              >
                <IconGear size={13} /> {L(dict, '自定义', 'Customize')}
              </button>
            </div>

            {/* Life Civilization Map — hero visual */}
            <div className="nesio-insights-section" style={{ marginTop: 'var(--space-3)' }}>
              <p className="nesio-insights-section-label">{L(dict, '生命版图', 'Life map')}<InfoTip text={L(dict, '五个领域(关系/事业/健康/成长/自我)的地形图:领土宽度由记录的意义密度决定(置信度+关联数+标签),不是数量;地形随时间演变,自动标出最大迁移。', 'A terrain of five domains (ties/work/health/growth/self). Territory width reflects meaning density (confidence + connections + tags), not count; it evolves over time and flags the biggest shift.')} /></p>
              <LifeCivilizationMap nodes={allNodes} />
            </div>

            {/* 今日时间块(批次 22):日历事件 + 地点足迹拼成时间线 */}
            <div className="nesio-insights-section">
              <p className="nesio-insights-section-label">{L(dict, '今日时间块', "Today's time blocks")}<InfoTip text={L(dict, '把今天的日历事件和到访地点拼成一条时间线(Toggl 风格),全部本机。连日历、授权位置后自动出现。', "Today's calendar events and visited places lined up into a timeline (Toggl-style), all on-device. Appears once calendar and location are connected.")} /></p>
              <TimeBlocksWidget canUsePrivateData={canUsePrivateData} />
            </div>



            {/* Dynamic widgets */}
            {activeWidgets.length === 0 && (
              <p className="nesio-insights-empty" style={{ marginTop: '2rem' }}>
                {L(dict, '还没有选择任何模块 · 点击「自定义」来添加', 'No modules yet · tap "Customize" to add')}
              </p>
            )}

            {activeWidgets.includes('donut') && (
              <div className="nesio-insights-section">
                <p className="nesio-insights-section-label">{L(dict, '记录分布', 'Distribution')}</p>
                <DonutChart data={domainStats} />
              </div>
            )}

            {activeWidgets.includes('heatmap') && (
              <div className="nesio-insights-section">
                <p className="nesio-insights-section-label">{L(dict, '活动热力图（过去30天）', 'Activity heatmap (last 30 days)')}</p>
                <ActivityHeatmap nodes={allNodes.filter((n) => {
                  const d = new Date(n.createdAt);
                  return (Date.now() - d.getTime()) <= 30 * 86_400_000;
                })} />
              </div>
            )}

            {activeWidgets.includes('week_bar') && (
              <div className="nesio-insights-section">
                <p className="nesio-insights-section-label">{L(dict, '周趋势（近8周）', 'Weekly trend (last 8 weeks)')}</p>
                <WeekBarChart nodes={allNodes} />
              </div>
            )}

            {activeWidgets.includes('tag_cloud') && (
              <div className="nesio-insights-section">
                <p className="nesio-insights-section-label">{L(dict, '高频标签', 'Top tags')}</p>
                <TagCloud nodes={periodNodes} />
              </div>
            )}

            {activeWidgets.includes('commitment_status') && (
              <div className="nesio-insights-section">
                <p className="nesio-insights-section-label">{L(dict, '承诺状态', 'Commitments')}</p>
                <CommitmentStatusWidget nodes={allNodes} />
              </div>
            )}

            {activeWidgets.includes('my_experiment') && (
              <div className="nesio-insights-section">
                <p className="nesio-insights-section-label">{L(dict, '我的实验', 'My experiment')}</p>
                <MyExperimentWidget />
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Timeline(批次 28,放分析后面)── */}
        {mainTab === 'timeline' && (
          <div className="nesio-analytics-tab">
            <TimelineTab />
          </div>
        )}

        {/* ── Tab: Finance(批次 29,放时间线后面)── */}
        {mainTab === 'finance' && <FinanceTab />}

        {/* ── Tab: 健康 Dashboard(批次 39)── */}
        {mainTab === 'health' && <HealthDashboard />}

        {/* ── Tab: 关系管理(批次 41)── */}
        {mainTab === 'relationships' && <RelationshipsPanel />}

        {/* ── Tab 3: Living Model ── */}
        {mainTab === 'living' && (
          <>
            <LearningStatusPanel />
            <LivingModelTab
              model={livingModel}
              loading={livingLoading}
              error={livingError}
              nodeCount={allNodes.length}
              onRefresh={handleRefreshLiving}
              onFeedback={handleFeedback}
            />
          </>
        )}

      </div>

      {showCustomizer && (
        <WidgetCustomizerSheet
          active={activeWidgets}
          onClose={() => setShowCustomizer(false)}
          onSave={(ids) => {
            setActiveWidgets(ids);
            saveWidgetConfig(ids);
          }}
        />
      )}
    </div>
  );
}


