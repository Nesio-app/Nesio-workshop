/**
 * 逐模块本地开关(Module overrides)——用户在设置里精确控哪些工具模块开/关,
 * 不改线上默认 SKU。存 localStorage(本机、按设备),shell-runtime / launch-surface
 * resolver 读它并优先于 launchStatus/viewerRole:显式关 → 隐,显式开 → 显(即使 gated)。
 *
 * 与 Lab 总开关的关系:Lab 是「全解锁」总闸;这里是「逐个精调」。两者叠加时覆盖优先
 * (你可以开 Lab 再单独关掉某个不想要的工具)。
 */

import { APPSTORE_HIDDEN_IDS, isAppStoreBlocked } from './app-build.mjs';

const KEY = 'nesio-module-overrides-v1';
export const MODULE_OVERRIDES_EVENT = 'nesio-module-overrides-updated';

/**
 * 可逐个开关的工具模块目录(稳定集,与 launch-surface 的分级对齐)。核心 7 面(拍/说/
 * 分享/问/洞察/预测/今日聚焦)是外壳常驻、不在此列。default = 该模块在默认 SKU 里是否
 * 对免费用户可见(仅供 UI 说明「跟随默认」时的实际效果)。
 */
// 功能开关目录。两类:
//  - module:工具箱竖向模块,经 launch-surface resolver 门控(moduleOverrides)。只列
//    **真有实现**的(components/portal 有组件);secretary/心理/圣所/quiz/lifesim 是
//    外部静态包或纯占位,web 端 0 组件、点了打不开,不放进来。
//  - feature:核心之外的子功能(冷冻仓/实验/足迹),入口处 useFeatureEnabled 门控,默认开。
// 真正核心(今日/洞察/记忆/问一问/拍/说/分享)是外壳常驻,不在此列、永远在。
export type FeatureKind = 'module' | 'feature';
export interface FeatureEntry { id: string; zh: string; en: string; kind: FeatureKind; defaultOn: boolean }
export const FEATURE_CATALOG: readonly FeatureEntry[] = Object.freeze([
  { id: 'inventory', zh: '物品收纳', en: 'Inventory', kind: 'module', defaultOn: true },
  { id: 'plan', zh: '计划', en: 'Plans', kind: 'module', defaultOn: true },
  { id: 'reading', zh: '阅读器', en: 'Reader', kind: 'module', defaultOn: false },
  { id: 'fitness', zh: '健身', en: 'Fitness', kind: 'module', defaultOn: false },
  { id: 'finance', zh: '财务', en: 'Finance', kind: 'module', defaultOn: false },
  { id: 'health', zh: '健康', en: 'Health', kind: 'module', defaultOn: false },
  { id: 'freeze', zh: '冷冻仓', en: 'Freeze vault', kind: 'feature', defaultOn: true },
  { id: 'experiment', zh: '我的实验', en: 'Experiments', kind: 'feature', defaultOn: true },
  { id: 'places', zh: '地点足迹', en: 'Footprints', kind: 'feature', defaultOn: true },
]);

export const LAB_MODE_EVENT = 'nesio-lab-mode-updated';

/** Lab 模式(内测全解锁)是否开着。SSR 一律 false(= 公开面)。 */
export function isLabModeOn(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('baohe_personal_lab') === '1' || localStorage.getItem('baohe_lab_mode') === '1';
  } catch { return false; }
}

/**
 * 子功能是否启用。优先级:
 *  1. 提审构建 v1 隐藏集 → 恒关(盖过一切,合规)。
 *  2. 功能开关中心显式 开/关 → 尊重(即使 Lab 关也可单独开某域,反之亦然)。
 *  3. v1 隐藏集(健康/财务/足迹/关系/健身/实验室)默认跟随 **Lab 总闸**:
 *     Lab 开 = 内测全功能;Lab 关 = 公开面,这些域消失 —— 在 PWA 上翻 Lab
 *     即可实时预览提审/公开形态,不用打包(QA 需求)。
 *  4. 其余回落 defaultOn。
 */
export function isFeatureEnabled(id: string, defaultOn = true): boolean {
  if (isAppStoreBlocked(id)) return false; // 提审构建里 v1 隐藏子功能不可达
  const ov = loadModuleOverrides()[id];
  if (ov === 'on') return true;
  if (ov === 'off') return false;
  if (APPSTORE_HIDDEN_IDS.includes(id)) return isLabModeOn();
  return defaultOn;
}

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
