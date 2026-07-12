/**
 * Pins — 收藏夹(批次 20)。
 * 用户自定义 pin 的重要记忆,Memory 首页与「我的项目」并列展示。
 * 独立 store(不污染节点数据层);随完整备份的 nesio- 前缀自动纳入。
 */

import { reportStorageDropped } from './storage-health';

const KEY = 'nesio-pins-v1';
export const PINS_UPDATED_EVENT = 'nesio-pins-updated';

export function loadPins(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as string[]; } catch { return []; }
}

export function isPinned(nodeId: string): boolean {
  return loadPins().includes(nodeId);
}

export function togglePin(nodeId: string): boolean {
  const pins = loadPins();
  const next = pins.includes(nodeId) ? pins.filter((id) => id !== nodeId) : [nodeId, ...pins];
  try { localStorage.setItem(KEY, JSON.stringify(next.slice(0, 100))); } catch { reportStorageDropped(); }
  window.dispatchEvent(new CustomEvent(PINS_UPDATED_EVENT));
  return next.includes(nodeId);
}

/**
 * 核心记忆(批次 114)——「定义你」的记忆,比收藏更高一档。记忆罐第一颗球。
 * 独立 store,与收藏(pins)平行;长按记忆卡「标为核心」。同样随备份的 nesio- 前缀纳入。
 */
const CORE_KEY = 'nesio-core-memories-v1';
export const CORE_UPDATED_EVENT = 'nesio-core-updated';

export function loadCore(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(CORE_KEY) || '[]') as string[]; } catch { return []; }
}
export function isCore(nodeId: string): boolean {
  return loadCore().includes(nodeId);
}
export function toggleCore(nodeId: string): boolean {
  const core = loadCore();
  const next = core.includes(nodeId) ? core.filter((id) => id !== nodeId) : [nodeId, ...core];
  try { localStorage.setItem(CORE_KEY, JSON.stringify(next.slice(0, 100))); } catch { reportStorageDropped(); }
  window.dispatchEvent(new CustomEvent(CORE_UPDATED_EVENT));
  return next.includes(nodeId);
}
