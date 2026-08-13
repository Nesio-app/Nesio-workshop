/**
 * memory-event-at — 记忆「何时发生」的统一时间戳(2026-08-08)。
 *
 * 优先事件/创建属性,再退 createdAt(入库/同步时间)。用于列表排序、卡片日期、历史上的今天。
 *
 * 注意:flomo 等源常给 `2025-12-10 23:47:10`(空格分隔)。Safari 对这种字面量
 * `new Date(...)` 会得到 Invalid Date → 误退到同步日。这里先规范化再解析。
 */

import type { LifeNode } from './life-graph';

const EVENT_DATE_KEYS = ['date', 'occurredAt', 'eventAt', 'happenedAt', 'created', 'start'] as const;

/** 把常见外部时间字面量收成可解析的 Date;失败返回 null。 */
export function parseMemoryDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  // `YYYY-MM-DD HH:mm:ss` / `YYYY-MM-DD HH:mm` → ISO 本地无时区歧义用 T
  const spaced = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (spaced) {
    const d = new Date(`${spaced[1]}T${spaced[2]}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

/** 解析节点的事件时间;无效则回退 createdAt。 */
export function memoryEventAt(node: LifeNode): Date {
  const attrs = node.attributes || {};
  for (const key of EVENT_DATE_KEYS) {
    const d = parseMemoryDate(attrs[key]);
    if (d) return d;
  }
  const fallback = parseMemoryDate(node.createdAt) || new Date(node.createdAt);
  return Number.isNaN(fallback.getTime()) ? new Date(0) : fallback;
}

/**
 * 卡片/详情用的相对日标签。
 * 旧逻辑 `t >= dayStart → 今天` 会把**未来**事件(Halloween/夏令时)也标成今天 ——
 * 必须卡在「今天结束之前」。
 */
export function formatMemoryDayLabel(
  t: Date,
  dict: 'zh' | 'en',
  opts: { withTime?: boolean } = {},
): string {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = dayStart.getTime() + 86_400_000;
  const time = opts.withTime
    ? ` ${t.toLocaleTimeString(dict === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
    : '';
  if (t.getTime() >= dayStart.getTime() && t.getTime() < dayEnd) {
    return dict === 'en' ? `Today${time}` : `今天${time}`;
  }
  if (t.getTime() >= dayStart.getTime() - 86_400_000 && t.getTime() < dayStart.getTime()) {
    return dict === 'en' ? `Yesterday${time}` : `昨天${time}`;
  }
  const day = dict === 'en'
    ? t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${t.getMonth() + 1}月${t.getDate()}日`;
  return `${day}${time}`;
}

/** ISO 字符串形式(便于排序比较 / 写回 createdAt)。 */
export function memoryEventAtIso(node: LifeNode): string {
  return memoryEventAt(node).toISOString();
}

export type CreatedAtBackfillPatch = { id: string; patch: { createdAt: string } };

/**
 * 收集需要回填的 createdAt 补丁(不写盘)。
 * 若 attributes 里有源事件时间、且与节点 createdAt 差 > 1 天,把 createdAt 改成源时间。
 */
export function collectCreatedAtBackfillPatches(
  nodes: readonly LifeNode[],
  now = Date.now(),
): CreatedAtBackfillPatch[] {
  const out: CreatedAtBackfillPatch[] = [];
  for (const node of nodes) {
    const attrs = node.attributes || {};
    let event: Date | null = null;
    for (const key of EVENT_DATE_KEYS) {
      event = parseMemoryDate(attrs[key]);
      if (event) break;
    }
    if (!event) continue;
    const stored = parseMemoryDate(node.createdAt);
    if (stored && Math.abs(stored.getTime() - event.getTime()) < 86_400_000) continue;
    // 源时间不能离谱地在未来一年以外(防坏数据)
    if (event.getTime() > now + 366 * 86_400_000) continue;
    out.push({ id: node.id, patch: { createdAt: event.toISOString() } });
  }
  return out;
}

/**
 * @deprecated 易被误用成「逐条 updateLifeNode」导致卡死。
 * 请用 collectCreatedAtBackfillPatches + batchPatchLifeNodes(..., { syncCloud: false })。
 */
export function backfillMemoryCreatedAtFromAttrs(
  nodes: readonly LifeNode[],
  update: (id: string, patch: { createdAt: string }) => void,
  now = Date.now(),
): number {
  const patches = collectCreatedAtBackfillPatches(nodes, now);
  for (const p of patches) update(p.id, p.patch);
  return patches.length;
}
