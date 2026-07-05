/**
 * Signal 保留期/敏感度分类(纯函数,供 signal.ts 与 node 行为测试共用)。
 *
 * 契约:写入时(create-signal.ts)已按 source 定分类并存进 node.attributes。
 * 读取时必须**优先用持久化值**,tag 推断只作缺失兜底 —— 否则写成 Normal 的节点
 * 可能被读成 Disposable,而 retentionPolicy 驱动物理删除(pruneDisposableSignals),
 * 造成数据丢失。这里把"持久化优先 + 兜底推断"收成单一事实源,消除写/读分歧。
 */

export const RETENTION_VALUES = ['AlwaysAlive', 'LongLiving', 'Normal', 'Disposable'];
export const SENSITIVITY_VALUES = ['normal', 'private', 'health', 'financial', 'family', 'work'];

function persistedEnum(node, key, allowed) {
  const v = node.attributes ? node.attributes[key] : undefined;
  return typeof v === 'string' && allowed.includes(v) ? v : null;
}

function inferSensitivity(node) {
  const tags = (node.tags || []).join(' ').toLowerCase();
  if (node.type === 'health_state' || tags.includes('健康') || tags.includes('health')) return 'health';
  if (tags.includes('finance') || tags.includes('财务') || tags.includes('账单')) return 'financial';
  if (tags.includes('family') || tags.includes('家庭')) return 'family';
  if (tags.includes('work') || tags.includes('工作') || tags.includes('会议') || node.source === 'calendar') return 'work';
  return 'normal';
}

function inferRetention(node) {
  const tags = (node.tags || []).join(' ').toLowerCase();
  // 兜底方向偏"保命":family/tesla/person → AlwaysAlive(不会导致删除)。
  if (tags.includes('家庭') || tags.includes('family') || tags.includes('tesla') || node.type === 'person') {
    return 'AlwaysAlive';
  }
  if (tags.includes('finance') || tags.includes('财务') || tags.includes('读书') ||
      tags.includes('learning') || tags.includes('notion') || node.type === 'preference') {
    return 'LongLiving';
  }
  const transient = tags.includes('天气') || tags.includes('weather') ||
    (node.source === 'voice' && (node.relations || []).length === 0 && !node.rawInput);
  if (transient) return 'Disposable';
  return 'Normal';
}

/** 敏感度:持久化值优先,缺失走推断。 */
export function resolveSensitivity(node) {
  return persistedEnum(node, 'sensitivity', SENSITIVITY_VALUES) ?? inferSensitivity(node);
}

/** 保留期:持久化值优先,缺失走推断(避免写/读分歧导致误删)。 */
export function resolveRetention(node) {
  return persistedEnum(node, 'retentionPolicy', RETENTION_VALUES) ?? inferRetention(node);
}
