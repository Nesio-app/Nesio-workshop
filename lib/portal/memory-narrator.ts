/**
 * Memory Narrator — generates narrative cards for the Memory首屏.
 *
 * 三种卡片：
 * - remember:     "还记得这件事吗？" — 14-180天前的一条记录，每天轮换
 * - commitment:   "有N个承诺" — 承诺类节点汇总
 * - activity:     "最近你在忙" — 近7天最活跃域的摘要
 */

import type { LifeNode } from './life-graph';
import { nodeDomain } from '@/lib/life-domain';
import { DOMAINS, type FrontDomain } from '@/lib/life-domain/domain-taxonomy';

export type NarratorCardType = 'remember' | 'commitment' | 'activity';

export interface NarratorCard {
  type: NarratorCardType;
  title: string;
  body: string;
  sub?: string;
  nodes: LifeNode[];
}

// ── 还记得这件事吗？ ──────────────────────────────────────────────────────────

function buildRememberCard(nodes: LifeNode[]): NarratorCard | null {
  const now = Date.now();
  const MIN_AGE = 14 * 24 * 3_600_000;   // 14 天
  const MAX_AGE = 180 * 24 * 3_600_000;  // 6 个月

  const candidates = nodes.filter((n) => {
    const age = now - new Date(n.createdAt).getTime();
    return age >= MIN_AGE && age <= MAX_AGE && (n.rawInput || n.name.length > 4);
  });

  if (!candidates.length) return null;

  // 用日期做种子，每天固定显示同一条，不随机抖动
  const dayIndex = Math.floor(now / (24 * 3_600_000));
  const node = candidates[dayIndex % candidates.length];

  const daysAgo = Math.floor((now - new Date(node.createdAt).getTime()) / (24 * 3_600_000));
  const timeLabel =
    daysAgo < 30
      ? `${daysAgo} 天前`
      : daysAgo < 365
        ? `${Math.floor(daysAgo / 30)} 个月前`
        : `${Math.floor(daysAgo / 365)} 年前`;

  return {
    type: 'remember',
    title: '还记得这件事吗？',
    body: node.rawInput || node.name,
    sub: `—— 你 ${timeLabel} 存的`,
    nodes: [node],
  };
}

// ── 承诺 ──────────────────────────────────────────────────────────────────────

function buildCommitmentCard(nodes: LifeNode[]): NarratorCard | null {
  const commitments = nodes.filter((n) => n.type === 'commitment');
  if (!commitments.length) return null;

  const withDue = commitments.filter((n) => n.attributes?.dueDate);
  const sorted = [
    ...withDue.sort((a, b) =>
      String(a.attributes.dueDate).localeCompare(String(b.attributes.dueDate)),
    ),
    ...commitments.filter((n) => !n.attributes?.dueDate),
  ].slice(0, 3);

  const lines = sorted.map((n) => {
    const due = n.attributes?.dueDate as string | undefined;
    if (due) {
      const days = Math.ceil((new Date(due).getTime() - now()) / (24 * 3_600_000));
      const label =
        days < 0 ? `${Math.abs(days)} 天前` :
        days === 0 ? '今天' :
        days === 1 ? '明天' :
        `${days} 天后`;
      return `${n.name} · ${label}`;
    }
    return n.name;
  });

  return {
    type: 'commitment',
    title: `有 ${commitments.length} 个承诺`,
    body: lines.join('\n'),
    nodes: sorted,
  };
}

// ── 最近你在忙 ────────────────────────────────────────────────────────────────

function buildActivityCard(nodes: LifeNode[]): NarratorCard | null {
  const SEVEN_DAYS = 7 * 24 * 3_600_000;
  const recent = nodes.filter(
    (n) => now() - new Date(n.createdAt).getTime() < SEVEN_DAYS,
  );
  if (recent.length < 2) return null;

  const counts = recent.reduce<Record<string, number>>((acc, n) => {
    const d = nodeDomain(n);
    if (d) acc[d] = (acc[d] ?? 0) + 1;
    return acc;
  }, {});

  const [topId, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!topId) return null;

  const meta = DOMAINS[topId as FrontDomain];
  const preview = recent
    .filter((n) => nodeDomain(n) === topId)
    .slice(0, 2)
    .map((n) => n.name)
    .join('、');

  return {
    type: 'activity',
    title: '最近你在忙',
    body: `${topCount} 条${meta?.label ?? topId}记录`,
    sub: preview || undefined,
    nodes: recent.slice(0, 3),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function buildNarratorCards(nodes: LifeNode[]): NarratorCard[] {
  const cards: NarratorCard[] = [];
  const r = buildRememberCard(nodes);
  if (r) cards.push(r);
  const c = buildCommitmentCard(nodes);
  if (c) cards.push(c);
  const a = buildActivityCard(nodes);
  if (a) cards.push(a);
  return cards;
}

function now(): number {
  return Date.now();
}
