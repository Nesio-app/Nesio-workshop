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
