/**
 * Project Insights — 按时间 / 标签 / 类型 / 任务四个维度分析项目数据。
 *
 * 纯计算，无副作用，无外部依赖。
 * UI 层按需调用，渲染交给 ProjectInsightsView 组件。
 */

import type { LifeNode } from './life-graph';

// ── 时间维度 ─────────────────────────────────────────────────────────────────

export interface WeekBucket {
  label: string;   // "7/1"
  count: number;
  weekStart: Date;
}

/** 把节点按周分组，返回最近 8 周的桶（无数据的周也保留）。 */
export function bucketByWeek(nodes: LifeNode[]): WeekBucket[] {
  const now = new Date();
  const buckets: WeekBucket[] = [];

  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - i * 7 - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
    const count = nodes.filter((n) => {
      const t = new Date(n.createdAt);
      return t >= weekStart && t < weekEnd;
    }).length;
    buckets.push({ label, count, weekStart });
  }
  return buckets;
}

/** 过滤最近 N 天的节点。 */
export function filterByDays(nodes: LifeNode[], days: number): LifeNode[] {
  const cutoff = Date.now() - days * 24 * 3_600_000;
  return nodes.filter((n) => new Date(n.createdAt).getTime() >= cutoff);
}

// ── 标签维度 ─────────────────────────────────────────────────────────────────

export interface TagCount {
  tag: string;
  count: number;
  pct: number; // 0-100
}

/** 返回按频率排序的 top N 标签。 */
export function topTags(nodes: LifeNode[], n = 8): TagCount[] {
  const freq: Record<string, number> = {};
  for (const node of nodes) {
    for (const tag of node.tags ?? []) {
      freq[tag] = (freq[tag] ?? 0) + 1;
    }
  }
  const total = Object.values(freq).reduce((s, v) => s + v, 0) || 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([tag, count]) => ({ tag, count, pct: Math.round((count / total) * 100) }));
}

// ── 类型维度 ─────────────────────────────────────────────────────────────────

export interface TypeCount {
  type: string;
  label: string;
  icon: string;
  count: number;
  pct: number;
}

const TYPE_META: Record<string, { label: string; icon: string }> = {
  person:       { label: '人物',   icon: '👤' },
  object:       { label: '物品',   icon: '📦' },
  place:        { label: '地点',   icon: '📍' },
  event:        { label: '事件',   icon: '📅' },
  commitment:   { label: '承诺',   icon: '🤝' },
  health_state: { label: '健康',   icon: '🩷' },
  preference:   { label: '偏好',   icon: '⭐' },
};

export function typeDistribution(nodes: LifeNode[]): TypeCount[] {
  const freq: Record<string, number> = {};
  for (const n of nodes) freq[n.type] = (freq[n.type] ?? 0) + 1;
  const total = nodes.length || 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      type,
      label: TYPE_META[type]?.label ?? type,
      icon: TYPE_META[type]?.icon ?? '📌',
      count,
      pct: Math.round((count / total) * 100),
    }));
}

// ── 任务/承诺维度 ────────────────────────────────────────────────────────────

export type CommitmentStatus = 'overdue' | 'due_soon' | 'pending' | 'no_date';

export interface CommitmentItem {
  node: LifeNode;
  status: CommitmentStatus;
  daysLeft: number | null;
}

export function analyzeCommitments(nodes: LifeNode[]): CommitmentItem[] {
  const commitments = nodes.filter((n) => n.type === 'commitment');
  const now = Date.now();

  return commitments.map((node) => {
    const dueStr = node.attributes?.dueDate as string | undefined
      ?? node.attributes?.due as string | undefined
      ?? node.attributes?.date as string | undefined;

    if (!dueStr) return { node, status: 'no_date' as CommitmentStatus, daysLeft: null };

    const daysLeft = Math.ceil((new Date(dueStr).getTime() - now) / (24 * 3_600_000));
    let status: CommitmentStatus;
    if (daysLeft < 0) status = 'overdue';
    else if (daysLeft <= 3) status = 'due_soon';
    else status = 'pending';

    return { node, status, daysLeft };
  }).sort((a, b) => {
    const order: Record<CommitmentStatus, number> = { overdue: 0, due_soon: 1, pending: 2, no_date: 3 };
    return order[a.status] - order[b.status];
  });
}

// ── 综合摘要 ─────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  nodeCount: number;
  commitmentCount: number;
  overdueCount: number;
  dueSoonCount: number;
  topTags: TagCount[];
  weekBuckets: WeekBucket[];
  typeDistribution: TypeCount[];
  commitments: CommitmentItem[];
  /** 活跃天数（有记录的天数）*/
  activeDays: number;
}

export function buildProjectSummary(nodes: LifeNode[]): ProjectSummary {
  const commitmentItems = analyzeCommitments(nodes);
  const activeDaysSet = new Set(nodes.map((n) => n.createdAt.slice(0, 10)));

  return {
    nodeCount: nodes.length,
    commitmentCount: commitmentItems.length,
    overdueCount: commitmentItems.filter((c) => c.status === 'overdue').length,
    dueSoonCount: commitmentItems.filter((c) => c.status === 'due_soon').length,
    topTags: topTags(nodes),
    weekBuckets: bucketByWeek(nodes),
    typeDistribution: typeDistribution(nodes),
    commitments: commitmentItems,
    activeDays: activeDaysSet.size,
  };
}
