/**
 * Smart Search — entity-boosted ranking over the Life Graph.
 *
 * Phase 1 (current): rule-based entity extraction via extractContext.
 *   Query "Linda 的礼物" → understood {people:["Linda"], objects:["礼物"]}
 *   → nodes with those entities in their context score higher.
 *
 * Phase 2 (implemented): semantic re-rank via lib/portal/semantic-rerank.ts —
 *   callers pass smartSearch results to semanticRerank(query, nodes) to blend
 *   embedding cosine similarity with the text rank (fails open to text order).
 */

import { getLifeGraph, type LifeNode } from './life-graph';
import { extractContext, nodeDomain, readNodeContext, type FrontDomain } from '@/lib/life-domain';
import { parseTemporalQuery, isInSpan } from './temporal-query';
import { emailFulltextScore } from './email-fulltext-index';
import { tokenizeCJK } from './cjk-tokenize';

export interface SearchUnderstood {
  people: string[];
  places: string[];
  objects: string[];
  domain: FrontDomain | null;
}

export interface SmartSearchResult {
  nodes: LifeNode[];
  /** What the AI parsed from the query — show as hints in the UI. */
  understood: SearchUnderstood;
}

/** Flat searchable text for a node, including context entities and asset summaries. */
function nodeText(node: LifeNode): string {
  const parts: string[] = [
    node.name,
    node.rawInput || '',
    ...(node.tags || []),
    ...Object.values(node.attributes).map((v) => String(v ?? '')),
    // asset labels + vision analysis summaries (populated by future image/PDF connectors)
    ...(node.assets || []).flatMap((a) => [a.label || '', a.analysisSummary || '']),
  ];

  // Parse SignalContext JSON directly — people/places/objects/domain/labels.
  const raw = node.attributes?.context;
  if (typeof raw === 'string') {
    try {
      const ctx = JSON.parse(raw) as {
        domain?: string;
        people?: string[];
        places?: string[];
        objects?: string[];
        intent?: string;
        labels?: string[];
      };
      parts.push(
        ctx.domain || '',
        ctx.intent || '',
        ...(ctx.people || []),
        ...(ctx.places || []),
        ...(ctx.objects || []),
        ...(ctx.labels || []),
      );
    } catch {
      // malformed JSON — ignore
    }
  }

  return parts.join(' ').toLowerCase();
}

// 分词器抽到 cjk-tokenize.ts,与 searchLifeGraphFuzzy(端上简答)共用一份,
// 避免一处修了另一处漏(此前本函数修过、life-graph 漏了 → 端上中文检索全灭)。
const tokenize = tokenizeCJK;

/**
 * Smart entity match: how many query entities appear in the node's context array?
 * Supports partial / substring match in both directions.
 */
function entityMatchScore(queryVals: string[], nodeVals: string[] | undefined, textFallback: string): number {
  if (!queryVals.length) return 0;
  let score = 0;
  for (const qv of queryVals) {
    const qvl = qv.toLowerCase();
    const inContext = nodeVals?.some(
      (nv) => nv.toLowerCase().includes(qvl) || qvl.includes(nv.toLowerCase()),
    );
    if (inContext) {
      score += 10; // strong: matched a confirmed context entity
    } else if (textFallback.includes(qvl)) {
      score += 4;  // weaker: appears somewhere in text
    }
  }
  return score;
}

/**
 * Main entry point.  Pass domainFilter to restrict results to one front-stage domain.
 * If query is empty returns all nodes for the domain, newest first.
 */
export function smartSearch(query: string, domainFilter: FrontDomain | null = null): SmartSearchResult {
  const q = query.trim();
  const emptyUnderstood: SearchUnderstood = { people: [], places: [], objects: [], domain: null };

  if (!q) {
    const all = getLifeGraph().sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const nodes = domainFilter ? all.filter((n) => nodeDomain(n) === domainFilter) : all;
    return { nodes, understood: emptyUnderstood };
  }

  // AI-parse the query (rule-based extractContext — zero API cost).
  const qCtx = extractContext(q);
  const understood: SearchUnderstood = {
    people: qCtx.people || [],
    places: qCtx.places || [],
    objects: qCtx.objects || [],
    domain: (qCtx.domain as FrontDomain | undefined) || null,
  };

  const ql = q.toLowerCase();
  const tokens = tokenize(q);

  // Layer 1: Parse temporal expression from query (date-aware retrieval)
  const temporal = parseTemporalQuery(q);

  const scored = getLifeGraph()
    .filter((node) => (domainFilter ? nodeDomain(node) === domainFilter : true))
    .map((node) => {
      const text = nodeText(node);
      const nodeCtx = readNodeContext(node);
      let score = 0;

      // ── Layer 1: Temporal / date match (highest priority) ────────────────
      if (temporal.hasDate) {
        const startStr = node.attributes.start as string | undefined;
        if (startStr) {
          const startDate = new Date(startStr);
          if (isInSpan(startDate, temporal)) score += 30; // calendar event on this date
        } else {
          // Memory node created on this date
          if (isInSpan(new Date(node.createdAt), temporal)) score += 10;
        }
      }

      // ── Layer 2: Text / entity match ─────────────────────────────────────
      if (node.name.toLowerCase().includes(ql)) score += 14;
      if (node.rawInput?.toLowerCase().includes(ql)) score += 8;
      if (text.includes(ql)) score += 5;

      score += entityMatchScore(understood.people,  nodeCtx?.people,  text);
      score += entityMatchScore(understood.places,  nodeCtx?.places,  text);
      score += entityMatchScore(understood.objects, nodeCtx?.objects, text);

      if (understood.domain && nodeDomain(node) === understood.domain) score += 6;

      for (const token of tokens) {
        if (node.name.toLowerCase().includes(token)) score += 3;
        if (text.includes(token)) score += 1;
      }

      // ── 里程碑 B:邮件全文命中(本机索引,零云)────────────────────────
      // 节点 attributes 只有 ≤1500 的 article 预览;预览之外的正文靠这里的本机全文索引
      // 补分,让「内容在正文里但预览没命中」的邮件也能被搜到。索引未就绪则后台惰性水合。
      if (node.source === 'email') {
        const eid = typeof node.attributes.emailId === 'string' ? node.attributes.emailId : '';
        if (eid) score += emailFulltextScore(eid, tokens, ql);
      }

      return { node, score };
    })
    .filter((e) => e.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        new Date(b.node.createdAt).getTime() - new Date(a.node.createdAt).getTime(),
    )
    .map((e) => e.node);

  return { nodes: scored, understood };
}
