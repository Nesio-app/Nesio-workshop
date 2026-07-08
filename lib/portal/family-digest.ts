/**
 * family-digest — 家庭汇总(人缘㊅)。把家庭成员挂在各自身上的分类数据(成绩/健康/消费…)
 * 汇成一处:每个成员的分类计数 + 一条合并的近期动态时间线。重点管理家庭成员的落地读出。
 *
 * 纯函数、只读本机 person-records + 传入的联系人清单。敏感三类仅在本机汇总展示给你本人,
 * 不进 AI、不上传(person-records 本身 local-only)。
 */
import type { Contact } from './relationships';
import { loadAllPersonRecords, type PersonRecord, type PersonRecordCategory } from './person-records';

const FAMILY_RE = /家人|家庭|family/i;

export interface FamilyMemberDigest {
  key: string;
  name: string;
  counts: Partial<Record<PersonRecordCategory, number>>;
  total: number;
}
export interface FamilyRecentItem { personKey: string; personName: string; record: PersonRecord }
export interface FamilyDigest { members: FamilyMemberDigest[]; recent: FamilyRecentItem[] }

/** 谁算家庭成员:Google 家人分组 或 核心亲疏(CORE_RE:父母/兄弟姐妹/配偶…)。 */
export function isFamilyContact(c: Contact): boolean {
  return c.closeness === 'core' || c.groups.some((g) => FAMILY_RE.test(g));
}

/** 汇出家庭成员的分类数据概览 + 合并近期动态(倒序)。只含真正挂了数据的成员。 */
export function buildFamilyDigest(contacts: Contact[], recentLimit = 8): FamilyDigest {
  const family = contacts.filter(isFamilyContact);
  const nameByKey = new Map(family.map((c) => [c.key, c.name]));
  const familyKeys = new Set(family.map((c) => c.key));

  const members = new Map<string, FamilyMemberDigest>();
  for (const c of family) members.set(c.key, { key: c.key, name: c.name, counts: {}, total: 0 });

  const recent: FamilyRecentItem[] = [];
  for (const r of loadAllPersonRecords()) {
    if (!familyKeys.has(r.personKey)) continue;
    const m = members.get(r.personKey);
    if (m) { m.counts[r.category] = (m.counts[r.category] || 0) + 1; m.total += 1; }
    recent.push({ personKey: r.personKey, personName: nameByKey.get(r.personKey) || r.personKey, record: r });
  }
  recent.sort((a, b) => (b.record.date || b.record.createdAt).localeCompare(a.record.date || a.record.createdAt));

  const membersArr = [...members.values()]
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'zh'));

  return { members: membersArr, recent: recent.slice(0, recentLimit) };
}
