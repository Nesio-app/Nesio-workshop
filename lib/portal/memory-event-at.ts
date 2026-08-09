/**
 * memory-event-at — 记忆「何时发生」的统一时间戳(2026-08-08)。
 *
 * 优先事件/创建属性,再退 createdAt(入库时间)。用于列表排序、卡片日期、历史上的今天。
 */

import type { LifeNode } from './life-graph';

const EVENT_DATE_KEYS = ['date', 'occurredAt', 'eventAt', 'happenedAt'] as const;

/** 解析节点的事件时间;无效则回退 createdAt。 */
export function memoryEventAt(node: LifeNode): Date {
  const attrs = node.attributes || {};
  for (const key of EVENT_DATE_KEYS) {
    const v = attrs[key];
    if (typeof v === 'string' && v.trim()) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return new Date(node.createdAt);
}

/** ISO 字符串形式(便于排序比较)。 */
export function memoryEventAtIso(node: LifeNode): string {
  return memoryEventAt(node).toISOString();
}
