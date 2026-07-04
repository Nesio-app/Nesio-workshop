/**
 * A/B 实验基建(入口版)。
 *
 * 用法(注册即用):
 *   1. 在 EXPERIMENTS 里注册实验并把 enabled 设 true
 *   2. 组件里 const v = getVariant('exp_id'); v === 'b' 走新分支
 *   3. 渲染处调一次 trackExposure('exp_id') —— 曝光进遥测,
 *      /admin 的「实验」区自动出各 variant 的曝光/设备数
 *
 * 分桶:设备 id + 实验 id 稳定哈希 → 同一设备永远同一组;
 * 清站点数据 = 重新分桶(与遥测 deviceId 同生命周期,隐私一致)。
 * 效果指标:把关键行为事件带上 { exp, variant } props,
 * 面板即可按组对比(v1 先看曝光,指标对比是下一步)。
 */

import { track } from './telemetry';

export interface Experiment {
  id: string;
  name: string;
  variants: readonly string[];
  enabled: boolean;
}

export const EXPERIMENTS: readonly Experiment[] = [
  // 示例注册(未启用):首访欢迎文案两版对比
  { id: 'onboarding_copy_v1', name: 'Onboarding 欢迎文案', variants: ['a', 'b'], enabled: false },
] as const;

const DEVICE_KEY = 'nesio-telemetry-device-v1'; // 与遥测同一设备 id
const exposed = new Set<string>();

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 稳定分桶。实验未注册/未启用/服务端 → 恒返回第一个 variant(默认组)。 */
export function getVariant(experimentId: string): string {
  const exp = EXPERIMENTS.find((e) => e.id === experimentId);
  if (!exp || !exp.enabled || exp.variants.length === 0) return exp?.variants[0] ?? 'a';
  if (typeof window === 'undefined') return exp.variants[0];
  let device = 'no-storage';
  try { device = localStorage.getItem(DEVICE_KEY) || 'no-storage'; } catch { /* keep */ }
  return exp.variants[hash(`${device}:${experimentId}`) % exp.variants.length];
}

/** 曝光埋点(每会话每实验一次)。 */
export function trackExposure(experimentId: string): void {
  if (typeof window === 'undefined' || exposed.has(experimentId)) return;
  exposed.add(experimentId);
  track('exp_exposure', { exp: experimentId, variant: getVariant(experimentId) });
}
