/**
 * person-health — 把「按人看健康」的两套数据合成一套读(成员维度打通,2026-07-29)。
 *
 * 仓里有两套按人挂的健康数据,各有各的道理:
 *   · `person-records` 的三个敏感类(医疗/药物/健康)—— 手写的、给**家人**记一笔用的,
 *     文件头明写「只存本机、绝不喂 AI/洞察」;
 *   · `health-signals` 的四类 Signal —— 从化验单/相机进来的结构化事实,进主事实表,
 *     所以问一问答得出来(这正是健康镜头 D 屏的卖点)。
 *
 * 曾经考虑过在 RAG 入口把「家人的健康数据」拦掉(person-records 的三个敏感类
 * 本来就写着「绝不喂 AI」)。**没有做**,是决定不做:workshop 是自用实验室,
 * 「小宝上次血常规怎么样」问不出来才是坏产品。归属人只用来分组和标注,不当闸门。
 *
 * 唯一还在的闸门是「健康 Signal 不进云镜像」,那在 create-signal.isDeviceOnlySignal()。
 * 那条也不是隐私,是云端 Signal 表的 RLS 还没建。
 */

import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { loadPersonRecords, RECORD_CATEGORY_MAP, type PersonRecord, type PersonRecordCategory } from '@/lib/portal/person-records';
import {
  HEALTH_SIGNAL_TYPES, SELF_PERSON_KEY, healthSignals, personKeyOf,
  type HealthSignalType,
} from './health-signals';

/** person-records 里属于健康域的三类。 */
export const HEALTH_RECORD_CATEGORIES: PersonRecordCategory[] = ['medical', 'medication', 'health'];

/**
 * 这个记忆节点是不是**别人的**健康数据(不是本人的)。
 * 用于分组/标注 —— 健康页按成员切换、详情页标「这是谁的」。不是权限判据。
 * 老数据没有 personKey,一律算本人(不是「未知」,更不是「别人的」)。
 */
export function isOthersHealthNode(node: Pick<LifeNode, 'attributes'>): boolean {
  const a = node.attributes || {};
  const type = typeof a.signalType === 'string' ? a.signalType : '';
  const isHealth = (HEALTH_SIGNAL_TYPES as readonly string[]).includes(type) || a.sensitivity === 'health';
  if (!isHealth) return false;
  const who = typeof a.personKey === 'string' && a.personKey ? a.personKey : SELF_PERSON_KEY;
  return who !== SELF_PERSON_KEY;
}

// ── 合并读 ────────────────────────────────────────────────────────────────────

export interface PersonHealthItem {
  id: string;
  /** 来自哪一套 —— UI 据此决定能不能改(手写的能改,化验单来的只读)。 */
  origin: 'record' | 'signal';
  kind: HealthSignalType | PersonRecordCategory;
  title: string;
  detail?: string;
  /** ISO 或 YYYY-MM-DD */
  date?: string;
  /** 化验项相对参考区间的位置(只有 health.lab 有)。 */
  flag?: 'low' | 'high' | 'normal';
}

function fromRecord(r: PersonRecord): PersonHealthItem {
  const meta = RECORD_CATEGORY_MAP[r.category];
  return {
    id: r.id,
    origin: 'record',
    kind: r.category,
    title: r.title,
    detail: [meta ? meta.zh : '', r.detail].filter(Boolean).join(' · ') || undefined,
    date: r.date || r.createdAt,
  };
}

/**
 * 某个人的健康条目 —— 手写记录 + 结构化 Signal 合并,按时间倒序。
 * 本人默认也看得到自己的(personKey 缺省 = self)。
 */
export function personHealthItems(personKey: string): PersonHealthItem[] {
  const records = loadPersonRecords(personKey)
    .filter((r) => HEALTH_RECORD_CATEGORIES.includes(r.category))
    .map(fromRecord);

  const signals: PersonHealthItem[] = healthSignals({ personKey }).map((s) => {
    const p = (s.payload || {}) as Record<string, unknown>;
    const flag = p.flag === 'low' || p.flag === 'high' || p.flag === 'normal' ? p.flag : undefined;
    const bits = [p.dose, p.freq, p.note, p.reason, p.doctor].filter((v) => typeof v === 'string' && v);
    return {
      id: s.id,
      origin: 'signal' as const,
      kind: s.type as HealthSignalType,
      title: s.title,
      detail: bits.length ? bits.join(' · ') : undefined,
      date: s.occurredAt,
      flag,
    };
  });

  return [...records, ...signals].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

/** 某人身上有多少条健康数据(详情页瓦片用,不必把全部条目算出来渲染)。 */
export function personHealthCount(personKey: string): number {
  return personHealthItems(personKey).length;
}

/** 有健康数据的人(供健康页的成员切换)。含本人。 */
export function peopleWithHealth(): string[] {
  const keys = new Set<string>();
  for (const s of healthSignals()) keys.add(personKeyOf(s));
  for (const n of getLifeGraph()) {
    if (isOthersHealthNode(n) && typeof n.attributes?.personKey === 'string') keys.add(n.attributes.personKey);
  }
  return Array.from(keys);
}
