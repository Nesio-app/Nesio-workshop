/**
 * health-signals — 把临床数据接回主事实表(健康镜头 H1)。
 *
 * 为什么有这个文件:临床数据在仓里已经存在很久了,但它是一条**盲肠** ——
 * `providers/cda-parse.ts` 从 Apple 健康记录里解析出化验单/用药/诊断,
 * `clinical-store.ts` 把它整包存成一个 blob(`nesio-clinical-v1`),
 * `HealthDashboard` 在 Lab 模式下渲染成一张卡,然后就断了:
 *   · 问一问看不见(`searchSignalsSemantically` 只搜 Signal);
 *   · 时间线看不见;
 *   · 跨域相关性看不见;
 *   · 不能按家人分。
 *
 * 这里把那包 blob **投影成 Signal**,四种类型:
 *   health.lab     一次化验的一项指标(带参考区间 —— CDA 里本来就有,别扔)
 *   health.med     一种在用/停用的药(带起始日 —— 指标详情屏的虚线竖线靠它)
 *   health.symptom 一次症状记录
 *   health.visit   一次就诊
 *
 * 三条硬约束:
 *   ① 只走 `createSignal()`,绝不碰 `addLifeNode` —— 写入闸门契约(scripts/write-gate-addLifeNode.test.mjs)。
 *   ② `sensitivity: 'health'` + `retentionPolicy: 'AlwaysAlive'`,一条都不许漏(健康是核心事实,不该被剪枝)。
 *   ③ id 由 `externalId` 定死 → 同一条化验重复投影得到同一个 id,IDB 是 put(upsert),
 *      所以 `projectClinicalToSignals()` 可以随便重跑,不会长出重复。
 *
 * 落点:仅本机。Signal 主事实表本身是 device-authoritative(见 locality.ts),
 * 健康 Signal 不额外上云 —— RLS 补完前不进云同步(规格红线)。
 */

import { createSignal } from '@/lib/life-domain/create-signal';
import type { Signal } from '@/lib/life-domain/signal';
import { getSignals } from '@/lib/life-domain/signal';
import { logDropped } from '@/lib/portal/storage-health';
import type { LabResult } from '@/lib/portal/providers/cda-parse';

export const HEALTH_LAB = 'health.lab';
export const HEALTH_MED = 'health.med';
export const HEALTH_SYMPTOM = 'health.symptom';
export const HEALTH_VISIT = 'health.visit';

export const HEALTH_SIGNAL_TYPES = [HEALTH_LAB, HEALTH_MED, HEALTH_SYMPTOM, HEALTH_VISIT] as const;
export type HealthSignalType = (typeof HEALTH_SIGNAL_TYPES)[number];

/** 「这条是谁的」。缺省 = 账户本人;家人用 Contact.key(归一小写名/邮箱)。 */
export const SELF_PERSON_KEY = 'self';

export interface HealthLabPayload {
  personKey: string;
  name: string;              // 指标名(空腹血糖 / HbA1c …)
  value: number;
  unit: string;
  low?: number;              // 参考区间下界
  high?: number;             // 参考区间上界
  /** 相对参考区间的位置。CDA 给了就用它的,没给按 low/high 自己算。 */
  flag?: 'low' | 'high' | 'normal';
  /** 报告名/来源(如「生化全套」「Apple 健康记录」)。 */
  panel?: string;
}

export interface HealthMedPayload {
  personKey: string;
  name: string;
  dose?: string;             // 「0.5g」
  freq?: string;             // 「每日两次」
  /** YYYY-MM-DD。指标详情屏那条虚线竖线靠它 —— 「吃药后有没有用」全指望这个字段。 */
  startedAt?: string;
  stoppedAt?: string;
  note?: string;
}

export interface HealthSymptomPayload {
  personKey: string;
  name: string;
  /** 1 轻 / 2 中 / 3 重。不做医学分级,只做用户自评。 */
  severity?: 1 | 2 | 3;
  note?: string;
}

export interface HealthVisitPayload {
  personKey: string;
  place?: string;            // 医院/诊所
  department?: string;       // 科室
  /** 医生名字。bug3:填的是 people 里的人时,doctorKey 记归一 key,详情才连得回关系页。 */
  doctor?: string;
  /** 关联到 People 的归一 key(小写名/邮箱);手填的陌生医生没有这个字段。 */
  doctorKey?: string;
  reason?: string;
  note?: string;
  /** 保险(名称/计划),bug3:就诊往往连着一笔钱,记在这条上才对得起来。 */
  insurance?: string;
  /** 自付价格。写进 payload 而不是另起一笔账 —— 是不是要进财务由用户在财务页决定。 */
  price?: number;
  currency?: string;
}

// ── 纯函数(可单测,不碰 DOM/存储)────────────────────────────────────────────

/**
 * 参考区间判定。CDA 自带 flag 时以它为准(医院的判定比我们准);
 * 没有 flag 但有区间时自己算;两样都没有 → undefined(**不猜**)。
 */
export function labFlag(lab: { value: number; low?: number; high?: number; flag?: string }): 'low' | 'high' | 'normal' | undefined {
  if (lab.flag === 'low' || lab.flag === 'high' || lab.flag === 'normal') return lab.flag;
  const hasRange = typeof lab.low === 'number' || typeof lab.high === 'number';
  if (!hasRange || !Number.isFinite(lab.value)) return undefined;
  if (typeof lab.low === 'number' && lab.value < lab.low) return 'low';
  if (typeof lab.high === 'number' && lab.value > lab.high) return 'high';
  return 'normal';
}

/**
 * 稳定外部 id —— 决定去重粒度。
 * 化验:同一个人 + 同一指标 + 同一天 = 同一条(一天两次抽血是罕见情况,合并可接受,
 * 强过每次导入都翻倍)。用药:人 + 药名。就诊/症状:人 + 日期 + 名目。
 */
export function healthExternalId(type: HealthSignalType, personKey: string, parts: Array<string | undefined>): string {
  const tail = parts.filter((p) => p != null && p !== '').map((p) => String(p).trim().toLowerCase()).join('|');
  return `${type}:${personKey}:${tail}`;
}

/** 一条化验的显示标题:「空腹血糖 5.4 mmol/L」。 */
export function labTitle(lab: { name: string; value: number; unit?: string }): string {
  return `${lab.name} ${lab.value}${lab.unit ? ` ${lab.unit}` : ''}`.trim();
}

/**
 * 老数据升级:`ClinicalRecords.medications` 只有药名(string[])。
 * 剂量/频次/起始日一律留空 —— **不编**。用户在药物卡里补,补完才画得出那条虚线。
 */
export function medFromLegacyName(name: string, personKey: string): HealthMedPayload {
  return { personKey, name: name.trim() };
}

/** 这条 Signal 是不是健康镜头管的四类之一。 */
export function isHealthSignal(s: { type: string }): s is Signal & { type: HealthSignalType } {
  return (HEALTH_SIGNAL_TYPES as readonly string[]).includes(s.type);
}

/** 从 payload 里读归属人;缺省算本人(老数据没有这个字段)。 */
export function personKeyOf(s: { payload?: Record<string, unknown> }): string {
  const k = s.payload?.personKey;
  return typeof k === 'string' && k ? k : SELF_PERSON_KEY;
}

// ── 写入(唯一入口是 createSignal)──────────────────────────────────────────

function writeHealth(
  type: HealthSignalType,
  title: string,
  payload: Record<string, unknown>,
  occurredAt: string | undefined,
  externalId: string,
  opts: { confidence?: number; generator?: string; raw?: string } = {},
): Signal {
  return createSignal({
    source: 'health',
    type,
    title,
    occurredAt,
    payload,
    externalId,
    // 健康是核心事实:不许被剪枝引擎当过期内容清掉。
    sensitivity: 'health',
    retentionPolicy: 'AlwaysAlive',
    confidence: opts.confidence ?? 0.9,
    generator: opts.generator ?? 'user',
    raw: opts.raw,
    context: { domain: 'health', people: payload.personKey === SELF_PERSON_KEY ? [] : [String(payload.personKey)] },
  });
}

export function recordLab(input: Omit<HealthLabPayload, 'personKey'> & { personKey?: string; date?: string }): Signal {
  const personKey = input.personKey || SELF_PERSON_KEY;
  const flag = labFlag(input);
  const payload: HealthLabPayload = {
    personKey, name: input.name, value: input.value, unit: input.unit,
    ...(input.low != null ? { low: input.low } : {}),
    ...(input.high != null ? { high: input.high } : {}),
    ...(flag ? { flag } : {}),
    ...(input.panel ? { panel: input.panel } : {}),
  };
  return writeHealth(
    HEALTH_LAB, labTitle(input), payload as unknown as Record<string, unknown>, input.date,
    healthExternalId(HEALTH_LAB, personKey, [input.name, input.date]),
  );
}

export function recordMed(input: Omit<HealthMedPayload, 'personKey'> & { personKey?: string }): Signal {
  const personKey = input.personKey || SELF_PERSON_KEY;
  const payload: HealthMedPayload = { ...input, personKey };
  return writeHealth(
    HEALTH_MED, input.name, payload as unknown as Record<string, unknown>, input.startedAt,
    healthExternalId(HEALTH_MED, personKey, [input.name]),
  );
}

export function recordSymptom(input: Omit<HealthSymptomPayload, 'personKey'> & { personKey?: string; date?: string }): Signal {
  const personKey = input.personKey || SELF_PERSON_KEY;
  const payload: HealthSymptomPayload = {
    personKey, name: input.name,
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  return writeHealth(
    HEALTH_SYMPTOM, input.name, payload as unknown as Record<string, unknown>, input.date,
    healthExternalId(HEALTH_SYMPTOM, personKey, [input.name, input.date]),
  );
}

export function recordVisit(input: Omit<HealthVisitPayload, 'personKey'> & { personKey?: string; date?: string }): Signal {
  const personKey = input.personKey || SELF_PERSON_KEY;
  const { date: _date, personKey: _pk, ...rest } = input;
  const payload: HealthVisitPayload = { ...rest, personKey };
  const title = [input.place, input.department].filter(Boolean).join(' · ') || input.reason || '就诊';
  return writeHealth(
    HEALTH_VISIT, title, payload as unknown as Record<string, unknown>, input.date,
    healthExternalId(HEALTH_VISIT, personKey, [input.place, input.department, input.date]),
  );
}

// ── 老 blob → Signal 的一次性投影(幂等,可重跑)──────────────────────────────

export interface ProjectionResult { labs: number; meds: number; conditions: number }

/**
 * 把 `nesio-clinical-v1` 里已有的临床记录投影成 Signal。
 *
 * 幂等靠 externalId:同一条化验重复投影 → 同一个 Signal id → IDB put 覆盖,不长重复。
 * blob **不删**,继续留着作兼容读(和 LifeGraph 一样的迁移策略:新路先通,旧路后拆)。
 *
 * 诊断(conditions)暂不投影成 Signal —— 它只有一个字符串,既不是化验也不是用药,
 * 硬塞进四类里任何一类都是撒谎。等就诊屏做起来再决定挂哪。
 */
export function projectClinicalToSignals(
  clinical: { labs: LabResult[]; medications: string[]; conditions?: string[] } | null,
  personKey = SELF_PERSON_KEY,
): ProjectionResult {
  if (!clinical) return { labs: 0, meds: 0, conditions: 0 };
  let labs = 0;
  let meds = 0;
  for (const lab of clinical.labs || []) {
    if (!lab?.name || !Number.isFinite(lab.value)) continue;
    recordLab({ ...lab, personKey, panel: 'Apple 健康记录' });
    labs += 1;
  }
  for (const name of clinical.medications || []) {
    if (!name?.trim()) continue;
    recordMed(medFromLegacyName(name, personKey));
    meds += 1;
  }
  return { labs, meds, conditions: (clinical.conditions || []).length };
}

/**
 * 投影闸门 —— 记「这批临床数据已经接过了」。
 *
 * 为什么需要:投影本身幂等(externalId 定死 id,重投是覆盖不是新增),但**不便宜** ——
 * 一份生化全套几十上百项,每项一次 createSignal(= 一次 LifeNode 写 + 一次 IDB 写)。
 * 每次进健康页都重跑一遍,是几百次无谓写入。所以按「导入时间 + 条数」记个水位,
 * 同一批不重投;用户重新导入(importedAt 变了)自然会再投一次。
 */
const PROJECTED_KEY = 'nesio-health-projected-v1';

function projectionMark(clinical: { importedAt?: string; labs?: unknown[]; medications?: unknown[] } | null): string {
  if (!clinical) return '';
  return `${clinical.importedAt || ''}:${clinical.labs?.length || 0}:${clinical.medications?.length || 0}`;
}

/** 这批临床数据投影过没有。 */
export function isClinicalProjected(clinical: { importedAt?: string; labs?: unknown[]; medications?: unknown[] } | null): boolean {
  if (typeof window === 'undefined' || !clinical) return false;
  try { return localStorage.getItem(PROJECTED_KEY) === projectionMark(clinical); } catch { return false; }
}

/**
 * 把这批临床数据接进主事实表。已经接过就直接返回 null(调用方据此显示「已接入」)。
 * `force` 用于用户手动点「重新接入」。
 *
 * 水位写失败**不吞**:宁可下次重投(幂等,不会长重复),也不假装成功。
 */
export function ensureClinicalProjected(
  clinical: ({ importedAt?: string } & Parameters<typeof projectClinicalToSignals>[0]) | null,
  opts: { personKey?: string; force?: boolean } = {},
): ProjectionResult | null {
  if (!clinical) return null;
  if (!opts.force && isClinicalProjected(clinical)) return null;
  const result = projectClinicalToSignals(clinical, opts.personKey);
  try { localStorage.setItem(PROJECTED_KEY, projectionMark(clinical)); }
  catch (err) { logDropped('health.projection_mark', err); }
  return result;
}

// ── 读 ────────────────────────────────────────────────────────────────────────

/** 全部健康 Signal(可按人过滤)。读的是主事实表投影,所以问一问看到的和这里是同一份。 */
export function healthSignals(opts: { personKey?: string; types?: HealthSignalType[] } = {}): Signal[] {
  const types = opts.types ?? [...HEALTH_SIGNAL_TYPES];
  return getSignals({ types })
    .filter((s) => (opts.personKey ? personKeyOf(s) === opts.personKey : true));
}

/** 某个指标的时间序列(旧→新),供指标详情屏画曲线。 */
export function labSeries(name: string, personKey = SELF_PERSON_KEY): Array<{ date: string; value: number; unit: string; low?: number; high?: number; flag?: string }> {
  const want = name.trim().toLowerCase();
  return healthSignals({ personKey, types: [HEALTH_LAB] })
    .filter((s) => String((s.payload as Partial<HealthLabPayload> | undefined)?.name || '').trim().toLowerCase() === want)
    .map((s) => {
      const p = s.payload as unknown as HealthLabPayload;
      return { date: s.occurredAt.slice(0, 10), value: p.value, unit: p.unit, low: p.low, high: p.high, flag: p.flag };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
