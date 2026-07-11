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

// 批次 64:纯虚词字 —— 两个字都是虚词的 bigram(我的/是不/了吗)只添噪,不进 token
const CJK_STOP_CHARS = new Set('的了是我你他她它们在有不这那么吗呢吧就都也和跟给对把被让向从到要会能可还很挺再又');

function tokenize(query: string): string[] {
  const out = new Set<string>();
  const base = query
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:："'""''()[\]{}]/g, ' ');
  for (const t of base.split(/\s+/).map((x) => x.trim()).filter(Boolean)) {
    out.add(t);
    // 中文自然语句没有空格,整句曾被当一个 token → 文本层全灭
    // (「我的植物该浇水了」找不到「植物」,问一问被用户实测抓包)。
    // CJK 连续段拆 2/3-gram 作子词 token,「植物」「浇水」「编号」都能命中。
    for (const run of t.match(/[一-鿿]{2,}/g) || []) {
      for (let i = 0; i < run.length - 1; i++) {
        const bi = run.slice(i, i + 2);
        if (!(CJK_STOP_CHARS.has(bi[0]) && CJK_STOP_CHARS.has(bi[1]))) out.add(bi);
      }
      for (let i = 0; i + 3 <= run.length; i++) out.add(run.slice(i, i + 3));
    }
    // 数字串(商品编号/订单号)单独成 token
    for (const d of t.match(/\d{3,}/g) || []) out.add(d);
  }
  return [...out];
}

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
