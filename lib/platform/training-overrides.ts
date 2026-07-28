/**
 * training-overrides — 训练计划的「用户改写层」(2026-07-28,用户标注 PDF2 图8:
 *「训练计划目前是硬编码不可修改」)。
 *
 * PROTOCOL_LIBRARY 是只读的种子计划(代码里写死,升级 app 会跟着变)。要让用户能改组数/次数、
 * 换掉不想练的动作、删掉某个训练日,又不能把种子计划改脏 —— 所以做成**叠加层**:
 *   种子计划 + 本机 override → 实际显示的计划
 * 好处:① 用户随时能「恢复默认」(把 override 删掉就回去了);② 以后种子计划升级,
 * 没被用户碰过的部分自动吃到新版;③ override 很小,存 localStorage 不占地方。
 *
 * 合并逻辑(mergeProtocol)是纯函数,不碰存储/DOM —— 有契约测试
 * (scripts/training-overrides.test.mjs)。读写在下半段,只有它碰 localStorage。
 */

import { reportStorageDropped } from '@/lib/portal/storage-health';

export interface OverrideItem {
  exerciseId: string;
  sets: number;
  reps: number;
  unit?: 'reps' | 'min';
  restSec?: number;
  intensity?: string;
}

/** 一个训练日的改写。items 给了就整组替换;hidden=true 表示这个训练日被删掉了。 */
export interface SessionOverride {
  items?: OverrideItem[];
  hidden?: boolean;
}

/** key = `${protocolId}:${sessionId}` */
export type TrainingOverrides = Record<string, SessionOverride>;

export interface MergeSession {
  id: string;
  name: { zh: string; en: string };
  items: OverrideItem[];
}
export interface MergePhase {
  name: { zh: string; en: string };
  weeks: number;
  sessions: MergeSession[];
}
export interface MergeProtocol {
  id: string;
  name: { zh: string; en: string };
  goal: string;
  sessionsPerWeek: number;
  phases: MergePhase[];
}

export function overrideKey(protocolId: string, sessionId: string): string {
  return `${protocolId}:${sessionId}`;
}

/**
 * 把改写叠到种子计划上。纯函数 —— 传进来什么就算什么,不读存储。
 *
 * 规则:
 *   · hidden 的训练日整个拿掉;
 *   · items 给了就整组换掉(空数组 = 用户把动作删光了,等同于这天没内容 → 也拿掉,
 *     免得留一个点进去空白的训练日);
 *   · 没有 override 的训练日原样保留 —— 种子计划以后升级,这些会自动吃到新版;
 *   · 一个阶段被删空了就不显示这个阶段。
 * 不改入参(不可变),返回新对象。
 */
export function mergeProtocol(base: MergeProtocol, ov: TrainingOverrides): MergeProtocol {
  const phases: MergePhase[] = [];
  for (const ph of base.phases) {
    const sessions: MergeSession[] = [];
    for (const s of ph.sessions) {
      const o = ov[overrideKey(base.id, s.id)];
      if (o?.hidden) continue;
      const items = o?.items ?? s.items;
      if (!items.length) continue;
      sessions.push({ ...s, items });
    }
    if (sessions.length) phases.push({ ...ph, sessions });
  }
  return { ...base, phases };
}

/** 这个计划有没有被改过(UI 据此决定要不要显示「恢复默认」)。 */
export function hasOverrides(protocolId: string, ov: TrainingOverrides): boolean {
  return Object.keys(ov).some((k) => k.startsWith(`${protocolId}:`));
}

/** 组数/次数只在合理区间里调 —— 防手滑点出 0 组或 999 次。 */
export function clampSets(n: number): number { return Math.max(1, Math.min(10, Math.round(n))); }
export function clampReps(n: number, unit?: 'reps' | 'min'): number {
  return unit === 'min' ? Math.max(1, Math.min(120, Math.round(n))) : Math.max(1, Math.min(50, Math.round(n)));
}

// ── 存储(只有下面这段碰 localStorage)────────────────────────────────────────

const KEY = 'nesio-training-overrides-v1';
export const TRAINING_OVERRIDES_UPDATED = 'nesio-training-overrides-updated';

export function loadOverrides(): TrainingOverrides {
  if (typeof window === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    return raw && typeof raw === 'object' ? raw as TrainingOverrides : {};
  } catch { return {}; }
}

/**
 * 取「用户实际在练的那份计划」= 种子 + 用户改写。
 *
 * **任何要读训练内容的地方都必须走这道门。** 直接用 protocolById 拿到的是种子:
 * 用户改过的组数/次数不生效、删掉的动作照样冒出来。第一版就踩过 —— 健身页
 * 走的是 mergeProtocol,今天页的「开始练」却直接拿种子丢进跟练播放器,
 * 编辑功能等于只改了个显示。
 */
export function activeProtocol<T extends MergeProtocol>(seed: T): T {
  return mergeProtocol(seed, loadOverrides()) as T;
}


/**
 * 存改写。写不进去(隐私模式/配额满)返回 false —— 调用方必须显式告诉用户,
 * 不许静默吞掉(CLAUDE.md 红线:存储写入失败不能假装成功)。
 */
function persist(ov: TrainingOverrides): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(ov));
    window.dispatchEvent(new CustomEvent(TRAINING_OVERRIDES_UPDATED));
    return true;
  } catch {
    // 除了把 false 交给调用方显式报错,还要点亮全局「存储满了」横幅 ——
    // 仓里另外二十来个存储模块都走这条,不接就成了暗处。
    reportStorageDropped();
    return false;
  }
}

export function setSessionItems(protocolId: string, sessionId: string, items: OverrideItem[]): boolean {
  const ov = loadOverrides();
  ov[overrideKey(protocolId, sessionId)] = { ...ov[overrideKey(protocolId, sessionId)], items, hidden: false };
  return persist(ov);
}

export function hideSession(protocolId: string, sessionId: string): boolean {
  const ov = loadOverrides();
  ov[overrideKey(protocolId, sessionId)] = { ...ov[overrideKey(protocolId, sessionId)], hidden: true };
  return persist(ov);
}

/** 恢复这个训练日的默认(把它的 override 删掉)。 */
export function resetSession(protocolId: string, sessionId: string): boolean {
  const ov = loadOverrides();
  delete ov[overrideKey(protocolId, sessionId)];
  return persist(ov);
}

/** 恢复整个计划的默认。 */
export function resetProtocol(protocolId: string): boolean {
  const ov = loadOverrides();
  for (const k of Object.keys(ov)) if (k.startsWith(`${protocolId}:`)) delete ov[k];
  return persist(ov);
}
