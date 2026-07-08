/**
 * 人物档案(人缘㊁)—— 详情页的读出层(L1)。给一个联系人 key,把「这个人是谁 + 你们的
 * 联系状态 + 挂在他身上的记忆 + 关系网」汇成一份结构化档案,供详情页读,而不是 UI 里现算。
 *
 * 复用 ㊀ 的后台:contact 来自 buildRelationships(亲疏/节奏/该联系),ego 图/时间线来自
 * life-graph 节点。纯函数、可单测、local-first。头像:自定义上传(attributes.avatar,
 * data URI)优先,其次 Google 照片(attributes.photo),都没有则由 UI 用首字母兜底。
 */
import type { LifeNode } from './life-graph';
import type { GNode, GEdge } from '@/lib/platform/graph-engine';
import { buildRelationships, parseContactFrom, type Contact } from './relationships';

export interface PersonTimelineItem {
  at: string | null;             // ISO
  kind: 'contact' | 'email' | 'note' | 'relation' | 'created' | 'birthday';
  text: string;
}

export interface PersonProfile {
  key: string;                   // 归一身份(小写名/邮箱)
  displayName: string;
  contact: Contact | null;       // 来自 buildRelationships(亲疏/节奏/该联系)
  nodeId: string | null;         // 对应 person 节点 id(可挂头像/属性);无则 null
  photo?: string;                // Google 照片
  avatar?: string;               // 自定义上传(data URI),优先于 photo
  birthday?: string;
  email?: string;
  tags: string[];
  isFamily: boolean;             // 家庭成员(核心亲疏或家庭标签)—— 重点管理
  timeline: PersonTimelineItem[];
  ego: { nodes: GNode[]; edges: GEdge[] };
}

const NODE_COLOR: Record<string, string> = {
  person: 'var(--portal-accent)', object: 'var(--status-calm)', place: 'var(--status-go)',
  event: 'var(--status-gentle)', commitment: 'var(--portal-cool-accent)',
  health_state: 'var(--status-risk)', preference: 'var(--portal-muted)',
};
const FAMILY_TAG = /家人|家庭|family/i;

/** 一个节点是否就是「这个人」的 person 节点(名字或邮箱归一命中)。 */
function isPersonNode(n: LifeNode, key: string): boolean {
  if (n.type !== 'person' || !n.name) return false;
  if (n.name.trim().toLowerCase() === key) return true;
  const email = typeof n.attributes?.email === 'string' ? n.attributes.email.toLowerCase() : '';
  return !!email && email === key;
}

function nodeDate(n: LifeNode): string | null {
  const raw = n.lastConfirmedAt || (typeof n.attributes?.date === 'string' ? n.attributes.date : null) || n.createdAt;
  if (typeof raw !== 'string') return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** 汇出一个联系人的完整档案;找不到任何线索(既非联系人也无节点)返回 null。 */
export function buildPersonProfile(
  nodes: LifeNode[],
  key: string,
  now = Date.now(),
  contactLog?: Record<string, string>,
): PersonProfile | null {
  const k = key.trim().toLowerCase();
  if (!k) return null;

  const contacts = buildRelationships(nodes, now, contactLog);
  const contact = contacts.find((c) => c.key === k) || null;

  // 对应 person 节点(可能没有:纯关系推出的联系人)
  const personNode = nodes.find((n) => isPersonNode(n, k)) || null;
  const displayName = contact?.name || personNode?.name || key;

  if (!contact && !personNode) return null;

  const photo = personNode && typeof personNode.attributes?.photo === 'string' ? personNode.attributes.photo : undefined;
  const avatar = personNode && typeof personNode.attributes?.avatar === 'string' ? personNode.attributes.avatar : undefined;
  const birthday = personNode && typeof personNode.attributes?.birthday === 'string' ? personNode.attributes.birthday : undefined;
  const email = (personNode && typeof personNode.attributes?.email === 'string' ? personNode.attributes.email : undefined)
    || (k.includes('@') ? k : undefined);
  const tags = personNode?.tags ? [...personNode.tags] : [];
  const isFamily = contact?.closeness === 'core' || tags.some((t) => FAMILY_TAG.test(t))
    || (contact?.relation ? /家人|亲人|父|母|爸|妈|兄|弟|姐|妹|儿|女|配偶|妻|夫|family|parent|sibling|spouse/i.test(contact.relation) : false);

  // ── 时间线:把邮件/记忆/打卡/生日汇成一条流(倒序,取近 8 条)──
  const timeline: PersonTimelineItem[] = [];
  const matchName = displayName.trim().toLowerCase();
  for (const n of nodes) {
    // 邮件:from = 这个人
    if (n.source === 'email' && typeof n.attributes?.from === 'string') {
      const c = parseContactFrom(n.attributes.from);
      if (c && c.key === k) timeline.push({ at: nodeDate(n), kind: 'email', text: n.name || '邮件往来' });
      continue;
    }
    // 记忆/关系:名字出现在 relations targetId
    if ((n.relations || []).some((r) => (r.targetId || '').trim().toLowerCase() === k || (r.targetId || '').trim().toLowerCase() === matchName)) {
      timeline.push({ at: nodeDate(n), kind: 'note', text: n.name || '一条记忆' });
    }
  }
  if (personNode) timeline.push({ at: nodeDate(personNode), kind: 'created', text: '加入联系人' });
  const logged = contactLog?.[k];
  if (logged) timeline.push({ at: logged, kind: 'contact', text: '联系过了' });
  timeline.sort((a, b) => (b.at || '').localeCompare(a.at || ''));

  // ── ego 关系网:以这个人为中心,连出直接相关的人/物 ──
  const centerId = personNode?.id || `key:${k}`;
  const egoNodes: GNode[] = [{ id: centerId, label: displayName, type: 'person', weight: 1, color: NODE_COLOR.person }];
  const egoEdges: GEdge[] = [];
  const seen = new Set<string>([centerId]);
  const pushNeighbor = (id: string, label: string, type: string, relation?: string) => {
    if (!id || seen.has(id) || egoNodes.length > 12) return;
    seen.add(id);
    egoNodes.push({ id, label, type, weight: 0.5, color: NODE_COLOR[type] ?? 'var(--portal-accent)' });
    egoEdges.push({ source: centerId, target: id, label: relation });
  };
  // 这个人自己的 relations(person 节点上)
  for (const r of personNode?.relations || []) {
    if (!r.targetId) continue;
    const t = nodes.find((n) => n.id === r.targetId) || nodes.find((n) => n.name?.trim().toLowerCase() === r.targetId.trim().toLowerCase());
    pushNeighbor(t?.id || `rel:${r.targetId}`, t?.name || r.targetId, t?.type || 'person', r.relation);
  }
  // 别的节点通过 relation 指向这个人 → 也是邻居(取对方节点)
  for (const n of nodes) {
    if (n.id === personNode?.id) continue;
    for (const r of n.relations || []) {
      const tgt = (r.targetId || '').trim().toLowerCase();
      if (tgt === k || tgt === matchName) { pushNeighbor(n.id, n.name || '相关', n.type, r.relation); break; }
    }
  }

  return {
    key: k, displayName, contact, nodeId: personNode?.id || null,
    photo, avatar, birthday, email, tags, isFamily,
    timeline: timeline.slice(0, 8), ego: { nodes: egoNodes, edges: egoEdges },
  };
}
