'use client';

/**
 * People ↔ 家庭成员 · 本机配对(item 6)。person 节点是加密、只读自己的云 Signal,
 * 跨账号读不到 → 配对只能在**拥有者自己的设备**上做:本地按邮箱把家庭成员对到 People 的
 * person 节点,映射存本机(私有,不上云、不进别人的家庭行)。
 *
 * 映射:{ [家庭成员 userId]: { personId(本机 person 节点 id), familyId } }。
 */
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';

const LINK_KEY = 'nesio-family-person-link-v1';

type LinkEntry = { personId: string; familyId: string };
type LinkMap = Record<string, LinkEntry>;

function loadMap(): LinkMap {
  try { return JSON.parse(localStorage.getItem(LINK_KEY) || '{}') as LinkMap; } catch { return {}; }
}
function saveMap(m: LinkMap): void {
  try { localStorage.setItem(LINK_KEY, JSON.stringify(m)); } catch { /* 配额/隐私模式:配不上顶多每次重配 */ }
}
/** 一次遍历图谱,建 person 的 邮箱索引 + id 索引(避免在大图谱上反复 getLifeGraph().find 扫爆主线程)。 */
function buildPersonIndex(): { byEmail: Map<string, LifeNode>; byId: Map<string, LifeNode> } {
  const byEmail = new Map<string, LifeNode>();
  const byId = new Map<string, LifeNode>();
  try {
    for (const n of getLifeGraph()) {
      if (n.type !== 'person') continue;
      byId.set(n.id, n);
      const e = typeof n.attributes?.email === 'string' ? n.attributes.email.toLowerCase().trim() : '';
      if (e && !byEmail.has(e)) byEmail.set(e, n);
    }
  } catch { /* 图谱读不了就当没配 */ }
  return { byEmail, byId };
}

/**
 * 把某家庭的成员按邮箱配到本机 person 节点,写入本地映射;返回 {memberUserId → person 节点}。
 * 已配过且 person 仍在 → 沿用;新配上的落盘。图谱只读一遍(大图谱防卡)。
 */
export function autoLinkByEmail(familyId: string, members: Array<{ id: string; email?: string }>): Map<string, LifeNode> {
  const { byEmail, byId } = buildPersonIndex();
  const map = loadMap();
  const out = new Map<string, LifeNode>();
  let changed = false;
  for (const m of members) {
    const prev = map[m.id]?.personId ? byId.get(map[m.id].personId) ?? null : null;
    if (prev) { out.set(m.id, prev); continue; }
    const e = (m.email || '').toLowerCase().trim();
    const hit = e ? byEmail.get(e) : undefined;
    if (hit) { map[m.id] = { personId: hit.id, familyId }; out.set(m.id, hit); changed = true; }
  }
  if (changed) saveMap(map);
  return out;
}

/** 反查:某 person 节点配到了哪个家庭成员(没配返回 null)。供 person 详情显示家务/攒钱。 */
export function memberForPerson(personNodeId: string): { memberId: string; familyId: string } | null {
  const map = loadMap();
  for (const [memberId, entry] of Object.entries(map)) {
    if (entry.personId === personNodeId) return { memberId, familyId: entry.familyId };
  }
  return null;
}
