/**
 * 逐模块本地开关(Module overrides)——用户在设置里精确控哪些工具模块开/关,
 * 不改线上默认 SKU。存 localStorage(本机、按设备),shell-runtime / launch-surface
 * resolver 读它并优先于 launchStatus/viewerRole:显式关 → 隐,显式开 → 显(即使 gated)。
 *
 * 与 Lab 总开关的关系:Lab 是「全解锁」总闸;这里是「逐个精调」。两者叠加时覆盖优先
 * (你可以开 Lab 再单独关掉某个不想要的工具)。
 */

const KEY = 'nesio-module-overrides-v1';
export const MODULE_OVERRIDES_EVENT = 'nesio-module-overrides-updated';

/**
 * 可逐个开关的工具模块目录(稳定集,与 launch-surface 的分级对齐)。核心 7 面(拍/说/
 * 分享/问/洞察/预测/今日聚焦)是外壳常驻、不在此列。default = 该模块在默认 SKU 里是否
 * 对免费用户可见(仅供 UI 说明「跟随默认」时的实际效果)。
 */
export interface ToggleableModule { id: string; zh: string; en: string; defaultPublic: boolean }
export const TOGGLEABLE_MODULES: readonly ToggleableModule[] = Object.freeze([
  { id: 'inventory', zh: '物品收纳', en: 'Inventory', defaultPublic: true },
  { id: 'plan', zh: '计划', en: 'Plans', defaultPublic: true },
  { id: 'reading', zh: '阅读器', en: 'Reader', defaultPublic: false },
  { id: 'fitness', zh: '健身', en: 'Fitness', defaultPublic: false },
  { id: 'finance', zh: '财务', en: 'Finance', defaultPublic: false },
  { id: 'health', zh: '健康', en: 'Health', defaultPublic: false },
  { id: 'secretary', zh: '秘书', en: 'Secretary', defaultPublic: false },
  { id: 'psychoanalysis', zh: '心理分析', en: 'Psychoanalysis', defaultPublic: false },
  { id: 'sanctuary', zh: '心灵圣所', en: 'Sanctuary', defaultPublic: false },
  { id: 'quiz', zh: '测验', en: 'Quiz', defaultPublic: false },
  { id: 'lifesim', zh: '人生模拟', en: 'Life sim', defaultPublic: false },
]);

export type ModuleOverride = 'on' | 'off';
export type ModuleOverrideMap = Record<string, ModuleOverride>;

export function loadModuleOverrides(): ModuleOverrideMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
    const out: ModuleOverrideMap = {};
    for (const [id, v] of Object.entries(raw)) {
      if (v === 'on' || v === 'off') out[id] = v;
    }
    return out;
  } catch { return {}; }
}

/** 设某模块覆盖为 on/off;传 null 清除该模块的覆盖(回到默认 SKU 行为)。 */
export function setModuleOverride(moduleId: string, state: ModuleOverride | null): void {
  if (typeof window === 'undefined' || !moduleId) return;
  const all = loadModuleOverrides();
  if (state === 'on' || state === 'off') all[moduleId] = state;
  else delete all[moduleId];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent(MODULE_OVERRIDES_EVENT));
  } catch { /* quota — 覆盖是小对象,基本不会满 */ }
}

/** 清空所有逐模块覆盖(回到默认)。 */
export function clearModuleOverrides(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(MODULE_OVERRIDES_EVENT));
  } catch { /* ignore */ }
}
