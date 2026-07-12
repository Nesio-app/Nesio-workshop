/**
 * Memory Narrator — generates narrative cards for the Memory首屏.
 *
 * 三种卡片：
 * - remember:     "还记得这件事吗？" — 14-180天前的一条记录，每天轮换
 * - commitment:   "有N个承诺" — 承诺类节点汇总
 * - activity:     "最近你在忙" — 近7天最活跃域的摘要
 */

import { L } from './i18n';
import type { LifeNode } from './life-graph';
import { relativePastLabel } from './time-labels';

export type NarratorCardType = 'remember';

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

// ── Public API ────────────────────────────────────────────────────────────────

export function buildNarratorCards(nodes: LifeNode[], locale: string = 'zh'): NarratorCard[] {
  const cards: NarratorCard[] = [];
  // 批次 123(用户 X 掉「承诺/最近」统计数字卡,设计「不是『承诺 22』那种统计数字」):
  // 承诺/最近计数已在筛选芯片 + 记忆罐球体现,首屏不再出统计卡。只留「还记得这件事吗」念念叙事。
  const r = buildRememberCard(nodes, locale);
  if (r) cards.push(r);
  return cards;
}
