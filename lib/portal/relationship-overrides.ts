/**
 * 关系手动修改(图4)—— 联系人的亲疏/关系词是从记忆和邮件推出来的,推错时用户能改。
 * 覆盖存本地(key = 联系人 key),应用在 buildRelationships 输出层,推断之上叠一层用户校正。
 * 全本机,不上传。
 */

export type OverrideCloseness = 'core' | 'close' | 'acquaintance';
export interface RelationOverride {
  closeness?: OverrideCloseness;
  relation?: string;
  /**
   * 用户把这个人从关系里移除了。
   * 推出来的联系人删不掉(下次 buildRelationships 重算又会冒出来)—— 只能记一条,让推导层跳过。
   * 存的是 false 而不是 delete,因为「撤销移除」要能把它显式关掉。
   */
  hidden?: boolean;
}

import { reportStorageDropped } from '@/lib/portal/storage-health';

const KEY = 'nesio-relationship-overrides-v1';
export const RELATIONSHIP_OVERRIDES_EVENT = 'nesio-relationship-overrides-updated';

export function loadRelationshipOverrides(): Record<string, RelationOverride> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, RelationOverride>; } catch { return {}; }
}

/** 写入/合并某人的关系修改;传 relation='' 表示清掉关系词覆盖。 */
export function setRelationshipOverride(key: string, patch: RelationOverride): void {
  if (typeof window === 'undefined' || !key) return;
  const map = loadRelationshipOverrides();
  const next = { ...(map[key] || {}), ...patch };
  if (next.relation === '') delete next.relation;
  if (next.closeness === undefined && !next.relation && !next.hidden) delete map[key];
  else map[key] = next;
  // 用户亲手校正的关系,配额满丢了必须可见(红线);别在失败后还照发 updated 事件骗 UI。
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { reportStorageDropped(); }
  window.dispatchEvent(new CustomEvent(RELATIONSHIP_OVERRIDES_EVENT));
  // 关系派生自 life-graph;用同一事件让面板/详情就地重算
  window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
}

/** 把某人从关系里移除 / 撤销移除。见 RelationOverride.hidden。 */
export function setContactHidden(key: string, hidden: boolean): void {
  setRelationshipOverride(key, { hidden });
}

/** 被用户移除的联系人 key 集合(供 buildRelationships 跳过)。 */
export function hiddenContactKeys(): Set<string> {
  const out = new Set<string>();
  for (const [key, ov] of Object.entries(loadRelationshipOverrides())) {
    if (ov?.hidden) out.add(key);
  }
  return out;
}
