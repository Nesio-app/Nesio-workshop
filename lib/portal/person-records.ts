/**
 * person-records — 按人分类的生活数据(人缘㊄)。给一个联系人挂上分类信息:
 * 成绩 / 消费 / 位置 / 医疗 / 药物 / 健康。
 *
 * 设计:不进 life-graph 节点(避免新增 LifeNodeType、避免医疗数据漏进收纳/健康域,也不与
 * 正在进行的架构迁移打架),而是一个独立的本机 store —— 隐私边界清晰、导出/删除靠 nesio- 前缀
 * 自动覆盖(storage-manifest)。敏感三类(医疗/药物/健康)只存本机、绝不喂 AI/洞察。
 * 写入失败派可见事件(storage-health),不静默吞。
 */
import { reportStorageDropped } from './storage-health';

export type PersonRecordCategory = 'achievement' | 'spending' | 'location' | 'medical' | 'medication' | 'health';

export interface PersonRecord {
  id: string;
  personKey: string;          // 归一联系人身份(同 Contact.key)
  category: PersonRecordCategory;
  title: string;
  detail?: string;
  date?: string;              // ISO(可选)
  amount?: number;            // 消费类金额(可选)
  createdAt: string;          // ISO
}

export interface RecordCategoryMeta {
  key: PersonRecordCategory;
  zh: string; en: string;
  icon: string;
  sensitive: boolean;         // 敏感:只存本机、不进 AI/洞察
  money?: boolean;            // 是否带金额
}

export const RECORD_CATEGORIES: RecordCategoryMeta[] = [
  { key: 'achievement', zh: '成绩', en: 'Achievement', icon: '🏅', sensitive: false },
  { key: 'spending', zh: '消费', en: 'Spending', icon: '💳', sensitive: false, money: true },
  { key: 'location', zh: '位置', en: 'Location', icon: '📍', sensitive: false },
  { key: 'medical', zh: '医疗', en: 'Medical', icon: '🩺', sensitive: true },
  { key: 'medication', zh: '药物', en: 'Medication', icon: '💊', sensitive: true },
  { key: 'health', zh: '健康', en: 'Health', icon: '❤️', sensitive: true },
];

export const RECORD_CATEGORY_MAP: Record<PersonRecordCategory, RecordCategoryMeta> =
  Object.fromEntries(RECORD_CATEGORIES.map((c) => [c.key, c])) as Record<PersonRecordCategory, RecordCategoryMeta>;

const STORAGE_KEY = 'nesio-person-records-v1';

export function loadAllPersonRecords(): PersonRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(v) ? (v as PersonRecord[]) : [];
  } catch { return []; }
}

function saveAll(records: PersonRecord[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
  catch { reportStorageDropped(); } // 存储失败可见,不静默丢用户数据
}

/** 某人的记录,按时间倒序(新在前)。 */
export function loadPersonRecords(personKey: string): PersonRecord[] {
  const k = personKey.trim().toLowerCase();
  return loadAllPersonRecords()
    .filter((r) => r.personKey === k)
    .sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt));
}

/** 每类计数(用于详情页瓦片)。 */
export function personRecordCounts(personKey: string): Partial<Record<PersonRecordCategory, number>> {
  const out: Partial<Record<PersonRecordCategory, number>> = {};
  for (const r of loadPersonRecords(personKey)) out[r.category] = (out[r.category] || 0) + 1;
  return out;
}

export function addPersonRecord(rec: Omit<PersonRecord, 'id' | 'createdAt'>): PersonRecord {
  const now = new Date().toISOString();
  const full: PersonRecord = {
    ...rec,
    personKey: rec.personKey.trim().toLowerCase(),
    id: `pr-${now}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
  };
  const all = loadAllPersonRecords();
  all.unshift(full);
  saveAll(all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-person-records-updated'));
  return full;
}

export function deletePersonRecord(id: string): void {
  const all = loadAllPersonRecords().filter((r) => r.id !== id);
  saveAll(all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-person-records-updated'));
}
