/**
 * manual-contacts — 手动增 / 改 / 删联系人(People 升级,2026-07-29)。
 *
 * 现状:People 里的人**全是推出来的** —— buildRelationships 从 person 节点、邮件发件人、
 * relations 里的人名推。推得挺好,但用户加不了人:认识了一个新朋友、想先把家人录进去、
 * 推错了一个人想删掉 —— 一件都做不到。这个文件补上这三件。
 *
 * 三个设计决定:
 *
 * ① **手动联系人 = 一个 person 节点**,不另起一个平行存储。
 *    person 节点本来就是 buildRelationships 的第一等输入,建一个进去,推导层自然认。
 *    走 `ingestLifeNode`(写入闸门允许的两个入口之一),不碰 addLifeNode。
 *
 * ② **改名必须搬家**。Contact.key 是从名字/邮箱派生的,改名 = 换 key。
 *    挂在旧 key 上的东西(person-records 里的医疗/药物/健康、亲疏覆盖、联系打卡)
 *    会当场失联 —— 用户看到的是「我就改了个名字,TA 的记录全没了」。
 *    所以 renameContact 把这三样一起搬过去,并把旧名登记成别名(未来提及仍收敛到这个人)。
 *
 * ③ **删除分两种**。手动建的人 → 真删节点。推出来的人 → 删不掉(下次重算又会冒出来),
 *    所以记一条 hidden 覆盖,让推导层跳过。两种在 UI 上都叫「移除」,行为不同但结果一致。
 *
 * 全本机。
 */

import { getLifeGraph, updateLifeNode, deleteLifeNode, type LifeNode } from './life-graph';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { normalizeEmail } from './relationships';
import { setRelationshipOverride, loadRelationshipOverrides, setContactHidden } from './relationship-overrides';
import { movePersonRecords } from './person-records';
import { mergeEntity } from './entity-resolution';
import { logDropped } from './storage-health';

export interface ManualContactInput {
  name: string;
  email?: string;
  phone?: string;
  /** YYYY-MM-DD */
  birthday?: string;
  relation?: string;
  note?: string;
  /** 住址(bug3:表单加地址字段,详情/表单里可一键调系统默认地图导航)。 */
  address?: string;
}

/** 联系人身份键:有邮箱用归一邮箱,否则用小写名。与 buildRelationships 的口径一致。 */
export function contactKeyOf(input: { name: string; email?: string }): string {
  const email = input.email?.trim();
  if (email) return normalizeEmail(email);
  return input.name.trim().toLowerCase();
}

function findPersonNode(key: string): LifeNode | undefined {
  const want = key.trim().toLowerCase();
  return getLifeGraph().find((n) => {
    if (n.type !== 'person') return false;
    if (n.name.trim().toLowerCase() === want) return true;
    const em = typeof n.attributes?.email === 'string' ? n.attributes.email : '';
    return Boolean(em) && normalizeEmail(em) === want;
  });
}

function attrsOf(input: ManualContactInput): Record<string, string> {
  const a: Record<string, string> = { epistemic: 'user_asserted', generator: 'user' };
  if (input.email?.trim()) a.email = input.email.trim();
  if (input.phone?.trim()) a.phone = input.phone.trim();
  if (input.birthday?.trim()) a.birthday = input.birthday.trim();
  if (input.note?.trim()) a.note = input.note.trim();
  if (input.address?.trim()) a.address = input.address.trim();
  return a;
}

/**
 * 新建一个联系人。名字为空 → 返回 null(不建空壳)。
 * 已经有同名/同邮箱的 person 节点 → 富化它而不是建第二个(否则一个人两张卡)。
 */
export function addManualContact(input: ManualContactInput): { key: string; nodeId: string } | null {
  const name = input.name.trim();
  if (!name) return null;
  const key = contactKeyOf({ name, email: input.email });
  const existing = findPersonNode(key) || findPersonNode(name);
  if (existing) {
    updateLifeNode(existing.id, { attributes: { ...(existing.attributes || {}), ...attrsOf(input) } });
    if (input.relation?.trim()) setRelationshipOverride(key, { relation: input.relation.trim() });
    notify();
    return { key, nodeId: existing.id };
  }
  const node = ingestLifeNode({
    type: 'person',
    name,
    source: 'manual',
    confidence: 1, // 用户亲手录的,不是推的
    attributes: attrsOf(input),
    relations: [],
    tags: ['联系人'],
  });
  if (input.relation?.trim()) setRelationshipOverride(key, { relation: input.relation.trim() });
  notify();
  return node ? { key, nodeId: node.id } : null;
}

/** 改字段(不含改名 —— 改名走 renameContact,它要搬家)。 */
export function updateManualContact(nodeId: string, patch: ManualContactInput): boolean {
  const node = getLifeGraph().find((n) => n.id === nodeId);
  if (!node) return false;
  const ok = updateLifeNode(nodeId, { attributes: { ...(node.attributes || {}), ...attrsOf(patch) } });
  if (ok) notify();
  return ok;
}

/**
 * 改名 —— 顺带把挂在旧 key 上的东西搬过来。
 *
 * 不搬的后果:改个名字,TA 的医疗/药物/健康记录、亲疏设置、联系打卡全部失联。
 * 用户不会认为这是「换了个人」,只会认为「数据丢了」。
 *
 * 返回新 key。名字没变或新名为空 → 返回旧 key,什么都不做。
 */
export function renameContact(oldKey: string, nodeId: string | null, next: ManualContactInput): string {
  const name = next.name.trim();
  if (!name) return oldKey;
  const newKey = contactKeyOf({ name, email: next.email });
  const node = nodeId ? getLifeGraph().find((n) => n.id === nodeId) : undefined;
  if (node) {
    updateLifeNode(node.id, { name, attributes: { ...(node.attributes || {}), ...attrsOf(next) } });
  } else {
    // 从邮件/relations 推出来的人**没有 person 节点** —— 无处可写,改了名字等于没改。
    // 这时候现建一个:改名这个动作本身就说明用户认领了这个人。
    addManualContact(next);
  }
  if (newKey === oldKey) { notify(); return oldKey; }

  // ① 挂在 TA 身上的记录(含医疗/药物/健康)
  movePersonRecords(oldKey, newKey);
  // ② 亲疏 / 关系词 / 隐藏 覆盖
  const ov = loadRelationshipOverrides()[oldKey];
  if (ov) {
    setRelationshipOverride(newKey, ov);
    setRelationshipOverride(oldKey, { closeness: undefined, relation: '' });
  }
  // ③ 旧名登记成别名 —— 历史记忆里提到旧名的,仍然收敛到这个人
  try { mergeEntity(oldKey, newKey); } catch (err) { logDropped('manual_contacts.alias', err); }
  notify();
  return newKey;
}

/**
 * 移除一个人。
 * 手动建的(有 nodeId)→ 真删节点;推出来的 → 记 hidden,推导层跳过。
 * 两种都**不动**提到 TA 的那些记忆本身。
 */
export function removeContact(key: string, nodeId: string | null): boolean {
  let ok = true;
  if (nodeId) ok = deleteLifeNode(nodeId);
  // 节点删了也要标 hidden:邮件发件人/relations 里还提着这个名字,不标下次照样推出来。
  if (ok) setContactHidden(key, true);
  if (ok) notify();
  return ok;
}

/** 撤销移除。 */
export function restoreContact(key: string): void {
  setContactHidden(key, false);
  notify();
}

function notify(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
}
