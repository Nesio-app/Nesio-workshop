/**
 * Memory Narrator — generates narrative cards for the Memory首屏.
 *
 * 三种卡片：
 * - remember:     "还记得这件事吗？" — 14-180天前的一条记录，每天轮换
 * - commitment:   "有N个承诺" — 承诺类节点汇总
 * - activity:     "最近你在忙" — 近7天最活跃域的摘要
 */

import { L } from './i18n';

// 领域中文标签 → 英文(domain-taxonomy 的 label 是数据层中文)
const DOMAIN_EN: Record<string, string> = {
  '生活': 'life', '成长': 'growth', '财物': 'assets', '健康': 'health', '能量': 'energy',
};
import type { LifeNode } from './life-graph';
import { nodeDomain } from '@/lib/life-domain';
import { topDomain } from './domain-stats';
import { relativePastLabel, relativeFutureLabel } from './time-labels';

export type NarratorCardType = 'remember' | 'commitment' | 'activity';

export interface NarratorCard {
  type: NarratorCardType;
  title: string;
  body: string;
  sub?: string;
  nodes: LifeNode[];
}

// ── 还记得这件事吗？ ──────────────────────────────────────────────────────────

function buildRememberCard(nodes: LifeNode[], locale: string = 'zh'): NarratorCard | null {
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

  // 情绪/日记内容不在首屏裸奔 — 遮罩为日期摘要,点开才见全文
  const intimate = (node.tags || []).some((t) => ['moment', 'journal', 'feeling'].includes(t));
  const dateStr = new Date(node.createdAt).toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric' });
  const body = intimate
    ? L(locale, `一段 ${dateStr} 的心情记录`, `A mood entry from ${dateStr}`)
    : (node.rawInput || node.name);

  return {
    type: 'remember',
    title: L(locale, '还记得这件事吗？', 'Remember this?'),
    body,
    sub: L(locale, `—— 你 ${relativePastLabel(node.createdAt, now)} 存的`, `— saved ${relativePastLabel(node.createdAt, now, 'en')}`),
    nodes: [node],
  };
}

// ── 承诺 ──────────────────────────────────────────────────────────────────────

function buildCommitmentCard(nodes: LifeNode[], locale: string = 'zh'): NarratorCard | null {
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
      const dueTime = new Date(due).getTime();
      const label = dueTime < now()
        ? relativePastLabel(dueTime, Date.now(), locale)
        : relativeFutureLabel(dueTime, new Date(), locale);
      return `${n.name} · ${label}`;
    }
    return n.name;
  });

  void lines;
  return {
    type: 'commitment',
    // 批次 15:指标卡式——第一行「承诺」,第二行数字(点卡进详情看名单)
    title: L(locale, '承诺', 'Promise'),
    body: String(commitments.length),
    nodes: sorted,
  };
}

// ── 最近你在忙 ────────────────────────────────────────────────────────────────

function buildActivityCard(nodes: LifeNode[], locale: string = 'zh'): NarratorCard | null {
  const SEVEN_DAYS = 7 * 24 * 3_600_000;
  const recent = nodes.filter(
    (n) => now() - new Date(n.createdAt).getTime() < SEVEN_DAYS,
  );
  if (recent.length < 2) return null;

  const top = topDomain(recent);
  if (!top) return null;

  // preview 名单不再上卡(批次 15)
  void 0;
  const preview = recent
    .filter((n) => nodeDomain(n) === top.domain)
    .slice(0, 2)
    .map((n) => n.name)
    .join('、');
  void preview;

  return {
    type: 'activity',
    // 批次 15:指标卡式——第一行「最近」,第二行数字(点卡进详情)
    title: L(locale, '最近', 'Recent'),
    body: String(top.count),
    nodes: recent.slice(0, 3),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function buildNarratorCards(nodes: LifeNode[], locale: string = 'zh'): NarratorCard[] {
  const cards: NarratorCard[] = [];
  const r = buildRememberCard(nodes, locale);
  if (r) cards.push(r);
  const c = buildCommitmentCard(nodes, locale);
  if (c) cards.push(c);
  const a = buildActivityCard(nodes, locale);
  if (a) cards.push(a);
  return cards;
}

function now(): number {
  return Date.now();
}
