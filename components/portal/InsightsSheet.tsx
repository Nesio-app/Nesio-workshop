'use client';

/**
 * InsightsSheet — "Nesio 的洞察" bottom-sheet, opened via logo tap.
 * Shows AI-generated narrative + stats + patterns by time period.
 * Data comes from local life-graph (already cloud-synced).
 */

import { useEffect, useRef, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { getMirrorProfile, type MirrorProfile } from '@/lib/portal/mirror-profile';
import { loadProfileSettings } from '@/lib/portal/profile';

type Period = 'week' | 'month' | 'all';

interface DomainStat {
  label: string;
  count: number;
  color: string;
}

interface InsightStats {
  memoryCount: number;
  completedTasks: number;
  topDomains: DomainStat[];
  activeHourLabel: string;
}

const TYPE_DOMAIN: Record<string, { label: string; color: string }> = {
  commitment: { label: '成长', color: '#8b5cf6' },
  event:      { label: '成长', color: '#8b5cf6' },
  health_state: { label: '健康', color: '#10b981' },
  person:     { label: '生活', color: '#f59e0b' },
  place:      { label: '生活', color: '#f59e0b' },
  object:     { label: '财物', color: '#3b82f6' },
};

const HOUR_GROUPS = [
  { label: '清晨 6-9', hours: [6, 7, 8] },
  { label: '上午 9-12', hours: [9, 10, 11] },
  { label: '下午 12-18', hours: [12, 13, 14, 15, 16, 17] },
  { label: '晚上 18-23', hours: [18, 19, 20, 21, 22] },
];

function avg(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function periodStart(period: Period): Date {
  const now = new Date();
  if (period === 'week') {
    const d = new Date(now); d.setDate(d.getDate() - 7); return d;
  }
  if (period === 'month') {
    const d = new Date(now); d.setMonth(d.getMonth() - 1); return d;
  }
  return new Date(0);
}

function computeStats(period: Period, profile: MirrorProfile): InsightStats {
  const since = periodStart(period);
  const nodes = getLifeGraph().filter((n) => new Date(n.createdAt) >= since);

  const completedTasks = nodes.filter(
    (n) => (n.type === 'commitment' || n.type === 'event') && n.attributes.done === true,
  ).length;

  const domainMap: Record<string, { count: number; color: string }> = {};
  for (const n of nodes) {
    const ctxDomain = typeof n.attributes.context === 'string'
      ? (() => { try { return (JSON.parse(n.attributes.context as string) as Record<string, string>).domain; } catch { return ''; } })()
      : '';
    const mapped = ctxDomain
      ? { label: ctxDomain, color: '#6b7280' }
      : TYPE_DOMAIN[n.type] ?? { label: '其他', color: '#94a3b8' };
    if (!domainMap[mapped.label]) domainMap[mapped.label] = { count: 0, color: mapped.color };
    domainMap[mapped.label].count++;
  }

  const topDomains: DomainStat[] = Object.entries(domainMap)
    .map(([label, { count, color }]) => ({ label, count, color }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const bestGroup = HOUR_GROUPS
    .map((g) => ({ ...g, score: avg(g.hours.map((h) => profile.hourEngagement[h])) }))
    .sort((a, b) => b.score - a.score)[0];
  const activeHourLabel = bestGroup?.score > 0.5 ? bestGroup.label : '';

  return { memoryCount: nodes.length, completedTasks, topDomains, activeHourLabel };
}

function profileProgress(profile: MirrorProfile, totalMemories: number): number {
  const feedbackScore = Math.min(profile.feedbackCount / 60, 1) * 40;
  const domainScore = Math.min(Object.keys(profile.domainWeights).length / 6, 1) * 35;
  const memoryScore = Math.min(totalMemories / 80, 1) * 25;
  return Math.round(feedbackScore + domainScore + memoryScore);
}

const PERIOD_LABELS: Record<Period, string> = { week: '本周', month: '本月', all: '全部' };

export default function InsightsSheet({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<Period>('week');
  const [profile, setProfile] = useState<MirrorProfile | null>(null);
  const [stats, setStats] = useState<InsightStats | null>(null);
  const [narrative, setNarrative] = useState('');
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const narrativeCacheRef = useRef<Record<string, string>>({});
  const [displayName, setDisplayName] = useState('');

  // Load profile + compute stats when period changes
  useEffect(() => {
    const p = getMirrorProfile();
    setProfile(p);
    setDisplayName(loadProfileSettings().displayName || '');
    setStats(computeStats(period, p));
  }, [period]);

  // Fetch AI narrative (cached per period+date)
  useEffect(() => {
    if (!stats || !profile) return;
    const cacheKey = `${period}-${new Date().toISOString().slice(0, 10)}`;
    if (narrativeCacheRef.current[cacheKey]) {
      setNarrative(narrativeCacheRef.current[cacheKey]);
      return;
    }

    const totalMemories = getLifeGraph().length;
    setNarrativeLoading(true);
    const controller = new AbortController();

    fetch('/api/portal/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        period,
        stats: {
          memoryCount: stats.memoryCount,
          completedTasks: stats.completedTasks,
          topDomains: stats.topDomains.map(({ label, count }) => ({ label, count })),
          activeHourLabel: stats.activeHourLabel,
        },
        recentNames: getLifeGraph()
          .filter((n) => new Date(n.createdAt) >= periodStart(period))
          .slice(0, 8)
          .map((n) => n.name),
        feedbackCount: profile.feedbackCount,
        displayName,
      }),
    })
      .then((r) => r.json())
      .then((data: { ok?: boolean; narrative?: string }) => {
        const text = data.narrative || '';
        narrativeCacheRef.current[cacheKey] = text;
        setNarrative(text);
      })
      .catch(() => undefined)
      .finally(() => setNarrativeLoading(false));

    return () => controller.abort();
  }, [stats, period, profile, displayName]);

  if (!stats || !profile) return null;

  const totalMemories = getLifeGraph().length;
  const progress = profileProgress(profile, totalMemories);
  const maxCount = stats.topDomains[0]?.count || 1;

  const domainLabels: Record<string, string> = {
    '天气 · 外出': '外出', weather: '外出', work: '工作', family: '家庭',
    home: '家', health: '健康', vehicle: '出行', learning: '学习', finance: '财务',
  };

  return (
    <div className="nesio-insights-sheet">
      {/* Header */}
      <div className="nesio-insights-header">
        <div className="nesio-insights-title-row">
          <span className="nesio-insights-icon">✦</span>
          <h2 className="nesio-insights-title">Nesio 的洞察</h2>
        </div>
        <div className="nesio-insights-period-tabs">
          {(['week', 'month', 'all'] as Period[]).map((p) => (
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
        <button type="button" className="nesio-insights-close" onClick={onClose} aria-label="关闭">✕</button>
      </div>

      <div className="nesio-insights-body">
        {/* AI Narrative */}
        <div className="nesio-insights-narrative">
          {narrativeLoading ? (
            <div className="nesio-insights-narrative-loading">
              <span className="nesio-focus-decompose-spinner" />
              <span>Nesio 正在回顾{PERIOD_LABELS[period]}…</span>
            </div>
          ) : narrative ? (
            <p className="nesio-insights-narrative-text">{narrative}</p>
          ) : null}
        </div>

        {/* Stats row */}
        <div className="nesio-insights-stats-row">
          <div className="nesio-insights-stat">
            <span className="nesio-insights-stat-num">{stats.memoryCount}</span>
            <span className="nesio-insights-stat-label">条记忆</span>
          </div>
          <div className="nesio-insights-stat-divider" />
          <div className="nesio-insights-stat">
            <span className="nesio-insights-stat-num">{stats.completedTasks}</span>
            <span className="nesio-insights-stat-label">件完成</span>
          </div>
          <div className="nesio-insights-stat-divider" />
          <div className="nesio-insights-stat">
            <span className="nesio-insights-stat-num">{totalMemories}</span>
            <span className="nesio-insights-stat-label">总记忆</span>
          </div>
        </div>

        {/* Domain breakdown */}
        {stats.topDomains.length > 0 && (
          <div className="nesio-insights-section">
            <p className="nesio-insights-section-label">{PERIOD_LABELS[period]}记录分布</p>
            <div className="nesio-insights-domains">
              {stats.topDomains.map((d) => (
                <div key={d.label} className="nesio-insights-domain-row">
                  <span className="nesio-insights-domain-label">{domainLabels[d.label] || d.label}</span>
                  <div className="nesio-insights-domain-track">
                    <div
                      className="nesio-insights-domain-fill"
                      style={{ width: `${Math.round((d.count / maxCount) * 100)}%`, background: d.color }}
                    />
                  </div>
                  <span className="nesio-insights-domain-count">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Patterns from MirrorProfile */}
        {Object.keys(profile.domainWeights).length > 0 && (
          <div className="nesio-insights-section">
            <p className="nesio-insights-section-label">Nesio 发现的偏好</p>
            {Object.entries(profile.domainWeights)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 4)
              .map(([domain, weight]) => {
                const label = { weather: '天气·外出', work: '工作·会议', family: '家庭·礼物', home: '家·物品', health: '健康', vehicle: '出行·车辆', learning: '学习', finance: '财务' }[domain] || domain;
                const desc = weight >= 0.65 ? '经常出现' : weight >= 0.35 ? '偶尔出现' : '刚开始';
                return (
                  <div key={domain} className="nesio-insights-pattern-row">
                    <span className="nesio-insights-pattern-label">{label}</span>
                    <div className="nesio-insights-pattern-track">
                      <div className="nesio-insights-pattern-fill" style={{ width: `${Math.max(12, Math.round(weight * 100))}%` }} />
                    </div>
                    <span className="nesio-insights-pattern-desc">{desc}</span>
                  </div>
                );
              })}
          </div>
        )}

        {/* Active hours */}
        {stats.activeHourLabel && (
          <div className="nesio-insights-section">
            <p className="nesio-insights-section-label">最活跃时段</p>
            <p className="nesio-insights-active-hour">🕐 {stats.activeHourLabel}</p>
          </div>
        )}

        {/* Progress meter */}
        <div className="nesio-insights-progress-section">
          <div className="nesio-insights-progress-head">
            <span className="nesio-insights-progress-label">Nesio 对你的了解</span>
            <span className="nesio-insights-progress-pct">{progress}%</span>
          </div>
          <div className="nesio-insights-progress-track">
            <div className="nesio-insights-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="nesio-insights-progress-hint">
            {progress < 30
              ? '刚刚开始认识你 · 多存一些事情'
              : progress < 60
              ? '已掌握你的部分节奏 · 持续成长中'
              : progress < 85
              ? '越来越懂你了 · 继续保持'
              : '已经相当了解你了 · 继续记录'}
          </p>
        </div>

        {/* Cloud note */}
        <p className="nesio-insights-cloud-note">↕ 数据来自云端同步 · 所有设备共享</p>
      </div>
    </div>
  );
}
