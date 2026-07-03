/**
 * Chat Context Builder — assembles all available user data into a compact
 * context string for AI. Designed to be extended as new data sources arrive
 * (notes, fitness, health logs, learning records, etc.).
 *
 * Context can be built client-side (with full localStorage access) and passed
 * in as a pre-built string, or built server-side from whatever data is available.
 */

import { getLifeGraph, type LifeNode } from './life-graph';
import { getMirrorProfile } from './mirror-profile';
import { smartSearch } from './smart-search';

export interface BuiltChatContext {
  /** Injected into the AI system prompt (private, never exposed to client) */
  systemContext: string;
  /** IDs of nodes referenced in the context, so AI can cite them */
  relevantNodeIds: string[];
}

export interface ClientBuiltContext {
  /** Pre-built memory context string from client (has localStorage access) */
  memoryContext?: string;
  /** Pre-built calendar context string from client */
  calendarContext?: string;
}

function formatNode(n: LifeNode): string {
  const attrs = Object.entries(n.attributes)
    .filter(([k, v]) => v !== null && !['subtasksJson', 'done', 'doneAt', 'context'].includes(k))
    .slice(0, 4)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  const date = new Date(n.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  return `• [${n.type}] ${n.name}${attrs ? ` (${attrs})` : ''} ← ${date}`;
}

export function buildChatContext(userQuery: string, clientContext?: ClientBuiltContext): BuiltChatContext {
  // If client sent pre-built context (has localStorage), use it directly
  if (clientContext?.memoryContext) {
    const parts = [clientContext.memoryContext];
    if (clientContext.calendarContext) parts.push('', clientContext.calendarContext);
    return { systemContext: parts.join('\n'), relevantNodeIds: [] };
  }

  // Server-side fallback (localStorage unavailable — returns empty graph in most cases)
  const graph = getLifeGraph();

  const searchResults = smartSearch(userQuery, null).nodes.slice(0, 10);
  const recent = graph.slice(0, 12);

  const nodeMap = new Map<string, LifeNode>();
  for (const n of searchResults) nodeMap.set(n.id, n);
  for (const n of recent) if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
  const nodes = Array.from(nodeMap.values()).slice(0, 20);

  const profile = getMirrorProfile();
  const topDomains = Object.entries(profile.domainWeights)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([k]) => k);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const doneTodayCount = graph.filter(
    (n) => n.attributes.done && n.attributes.doneAt && new Date(n.attributes.doneAt as string) >= today,
  ).length;

  const nodeLines = nodes.map(formatNode).join('\n');

  const systemContext = [
    `【用户记忆库】共 ${graph.length} 条（以下为相关条目）：`,
    nodeLines || '（暂无记录）',
    '',
    `【用户偏好】感兴趣领域：${topDomains.join('、') || '暂未知'}`,
    doneTodayCount > 0 ? `今天已完成 ${doneTodayCount} 件事` : '',
  ].filter(Boolean).join('\n');

  return { systemContext, relevantNodeIds: nodes.map((n) => n.id) };
}
