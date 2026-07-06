/**
 * 记忆节点的稳定外部 id(纯函数,供 life-graph.ts 与 node 行为测试共用)。
 *
 * 各连接器给节点带不同的稳定 id 键(Gmail=emailId、Notion=notionPageId、
 * Calendar=calendarId、Flomo=flomoSlug、通用=externalId)。ingestLifeNode 用它做
 * 幂等去重:重同步同一条目时更新而非新建,修「同步 100 行 Notion 三次 = 300 个节点」。
 */

export const EXTERNAL_ID_KEYS = ['externalId', 'emailId', 'notionPageId', 'calendarId', 'flomoSlug', 'messageId'];

/** 取稳定外部 id,形如 'emailId:xxx'(带键名,避免不同来源的裸 id 撞车)。无则 ''。 */
export function externalIdOf(attributes) {
  if (!attributes) return '';
  for (const k of EXTERNAL_ID_KEYS) {
    const v = attributes[k];
    if (typeof v === 'string' && v.trim()) return `${k}:${v.trim()}`;
  }
  return '';
}

/** 在节点数组里按 (source + 外部 id) 找已存在的节点;用于重同步幂等。 */
export function findByExternalId(nodes, source, extId) {
  if (!extId) return null;
  return (nodes || []).find((n) => n.source === source && externalIdOf(n.attributes) === extId) ?? null;
}
