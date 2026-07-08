/**
 * 阅读域（N-4:第一个生活域模板 —— 样板间)。
 *
 * 数据来源:N-3 折叠映射把 Notion 读书库变成「一本书 = 一条记忆,划线/笔记折进 attributes」;
 * 另兼容「微信读书」手动粘贴导入(一条划线一节点,按 attributes.book 归并)。
 * 本模块把这些「书」记忆汇成阅读概览,并出确定性 Today 洞察(「在读《X》,最近划了这句」)。
 *
 * 定位同其它域:reading-domain = 数据层(抽书/汇总)+ 判定层(readingFindings)。
 * warm-coach:阅读是好数据,只轻提示、只 attention、绝不出红。
 */
import type { LifeNode } from './life-graph';
import { evaluateRules, type DomainRule, type RuleSeverity } from './domain-rules';

export interface BookSummary {
  key: string;              // notionPageId 或 书名
  name: string;
  status?: string;          // 在读 / 读完
  progress?: string;        // 36(%)
  highlightCount: number;
  latestHighlight?: string;
  origin: 'notion' | 'wechat';
}

export interface ReadingOverview {
  books: BookSummary[];
  inReading: number;        // 在读本数
  totalHighlights: number;
}

export interface ReadingFinding {
  id: string;
  severity: RuleSeverity;
  title: [string, string];
  detail: [string, string];
}

export interface ReadingInsightInput {
  nodes: LifeNode[];
  now: Date;
}

const FOLD_KEY_RE = /划线|笔记|highlight|note/i;
const READING_STATUS_RE = /在读|reading/i;

/** 从 attributes 里按关键词模糊找一个值(状态/进度列名在不同模板叫法不同)。 */
function pickAttr(attrs: Record<string, string>, re: RegExp): string | undefined {
  for (const [k, v] of Object.entries(attrs)) {
    if (re.test(k) && v) return v;
  }
  return undefined;
}

/** Notion 折叠出来的「书」记忆:source=Notion 且带折叠列表(划线/笔记 + 对应 _count)。 */
function notionBook(node: LifeNode): BookSummary | null {
  const attrs = (node.attributes || {}) as Record<string, string>;
  if (attrs.source !== 'Notion') return null;
  let highlightCount = 0;
  let latestHighlight: string | undefined;
  for (const [k, v] of Object.entries(attrs)) {
    if (!k.endsWith('_count') || !FOLD_KEY_RE.test(k)) continue;
    const base = k.slice(0, -'_count'.length);
    highlightCount += Number(v) || 0;
    if (!latestHighlight && typeof attrs[base] === 'string') {
      // 折叠列表首行(去掉「1. 」序号)
      latestHighlight = attrs[base].split('\n')[0]?.replace(/^\d+\.\s*/, '');
    }
  }
  if (highlightCount === 0 && !FOLD_KEY_RE.test(Object.keys(attrs).join(' '))) return null;
  return {
    key: attrs.notionPageId || node.name,
    name: node.name,
    status: pickAttr(attrs, /状态|status/i),
    progress: pickAttr(attrs, /进度|progress/i),
    highlightCount,
    latestHighlight,
    origin: 'notion',
  };
}

/** 微信读书手动导入:tag 含「微信读书」、attributes.book 存在,一条划线一节点 → 按 book 归并。 */
function wechatBooks(nodes: LifeNode[]): BookSummary[] {
  const byBook = new Map<string, { count: number; latest?: string; latestT: number }>();
  for (const n of nodes) {
    const attrs = (n.attributes || {}) as Record<string, string>;
    const book = attrs.book;
    if (!book || !(n.tags || []).some((t) => /微信读书/.test(t))) continue;
    const cur = byBook.get(book) || { count: 0, latest: undefined, latestT: 0 };
    cur.count += 1;
    const t = Date.parse(n.createdAt || '') || 0;
    if (t >= cur.latestT) { cur.latestT = t; cur.latest = n.rawInput || n.name; }
    byBook.set(book, cur);
  }
  return Array.from(byBook.entries()).map(([book, v]) => ({
    key: `wechat:${book}`,
    name: book,
    highlightCount: v.count,
    latestHighlight: v.latest,
    origin: 'wechat' as const,
  }));
}

/** 阅读概览:抽书 + 汇总(在读本数 / 划线总数)。 */
export function buildReadingOverview(nodes: LifeNode[]): ReadingOverview {
  const books: BookSummary[] = [];
  for (const n of nodes) {
    const b = notionBook(n);
    if (b) books.push(b);
  }
  books.push(...wechatBooks(nodes));
  // 按划线数降序(读得深的排前)
  books.sort((a, b) => b.highlightCount - a.highlightCount);
  const inReading = books.filter((b) => b.status && READING_STATUS_RE.test(b.status)).length;
  const totalHighlights = books.reduce((s, b) => s + b.highlightCount, 0);
  return { books, inReading, totalHighlights };
}

const RULES: ReadonlyArray<DomainRule<ReadingInsightInput, ReadingFinding>> = [
  // ── 在读的书 + 最近一条划线:给你一个「回到书里」的温柔钩子。只 attention。 ──
  {
    id: 'reading-latest',
    run: (i) => {
      const ov = buildReadingOverview(i.nodes);
      if (!ov.books.length) return null;
      // 优先在读且有划线的书;否则划线最多的那本
      const pick = ov.books.find((b) => b.status && READING_STATUS_RE.test(b.status) && b.latestHighlight)
        || ov.books.find((b) => b.latestHighlight)
        || ov.books[0];
      const more = ov.books.length - 1;
      const moreZh = more > 0 ? `(在读书架还有 ${more} 本)` : '';
      const moreEn = more > 0 ? ` (+${more} more on your shelf)` : '';
      const quoteZh = pick.latestHighlight ? `最近你划了:「${pick.latestHighlight}」` : `已划 ${pick.highlightCount} 条`;
      const quoteEn = pick.latestHighlight ? `You recently highlighted: “${pick.latestHighlight}”` : `${pick.highlightCount} highlights`;
      return {
        severity: 'attention',
        title: [`在读《${pick.name}》`, `Reading “${pick.name}”`],
        detail: [`${quoteZh}${moreZh}。想的话,翻回去看一眼。`, `${quoteEn}${moreEn}. Dip back in when you like.`],
      };
    },
  },
];

/** 阅读域 findings 总入口(确定性;阅读是好数据,只 attention)。 */
export function readingFindings(input: ReadingInsightInput): ReadingFinding[] {
  if (!input.nodes.length) return [];
  return evaluateRules(RULES, input);
}
