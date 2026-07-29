/**
 * Routines — 用户自设的例行提醒(批次 19)。
 *
 * 模型:到点后在 Today 出卡(拉模型,打开 App 即见),完成/跳过后当天不再出。
 * PWA 没有可靠后台推送,真·锁屏推送等原生壳或 Web Push 接入后补;
 * 这里先把「内容 + 时间 + 重复」的闭环做实,不做假通知。
 */

import { reportStorageDropped } from './storage-health';
const localDayKey = (d: Date = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // 本地日键(vm 测试壳 stub require,lib 层内联不 import)

/** 重复计划分类(批次 45):自定义/健身/家务/吃药。健身可挂训练计划。 */
export type RoutineCategory = 'general' | 'fitness' | 'chore' | 'meds';

export interface Routine {
  id: string;
  text: string;
  /** 'reminder'=普通提醒 / 'ai_brief'=每日 AI 简报(批次 25) */
  kind?: 'reminder' | 'ai_brief';
  /** 计划分类,默认 general */
  category?: RoutineCategory;
  /** 健身分类:挂到 training-protocol-engine 的某个训练计划,Today 卡出「开始练」 */
  protocolId?: string;
  /** 'HH:mm' 24 小时制 */
  time: string;
  /** 0=周日 … 6=周六 */
  days: number[];
  enabled: boolean;
  /** 'YYYY-MM-DD' — 当天完成/跳过后写入,次日自动复活 */
  lastDoneDate?: string;
  createdAt: string;
}

const KEY = 'nesio-routines-v1';
export const ROUTINES_UPDATED_EVENT = 'nesio-routines-updated';

export function loadRoutines(): Routine[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as Routine[]; } catch { return []; }
}

function save(routines: Routine[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(routines)); } catch { reportStorageDropped(); }
  window.dispatchEvent(new CustomEvent(ROUTINES_UPDATED_EVENT));
}

export function addRoutine(input: { text: string; time: string; days: number[]; kind?: 'reminder' | 'ai_brief'; category?: RoutineCategory; protocolId?: string }): Routine {
  const r: Routine = {
    id: `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text: input.text.trim(),
    kind: input.kind || 'reminder',
    category: input.category || 'general',
    protocolId: input.protocolId,
    time: input.time,
    days: input.days.length ? input.days : [0, 1, 2, 3, 4, 5, 6],
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  save([...loadRoutines(), r]);
  return r;
}

export function updateRoutine(id: string, patch: Partial<Routine>): void {
  save(loadRoutines().map((r) => (r.id === id ? { ...r, ...patch } : r)));
}

export function deleteRoutine(id: string): void {
  save(loadRoutines().filter((r) => r.id !== id));
}

function todayStr(now: Date): string {
  return localDayKey(now);
}

/** 到点且今天还没完成/跳过的 routine。 */
export function dueRoutines(now: Date = new Date()): Routine[] {
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = todayStr(now);
  return loadRoutines().filter(
    (r) => r.enabled && r.days.includes(now.getDay()) && r.time <= hhmm && r.lastDoneDate !== today,
  );
}

export function markRoutineDone(id: string, now: Date = new Date()): void {
  updateRoutine(id, { lastDoneDate: todayStr(now) });
}
