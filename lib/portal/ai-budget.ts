/**
 * 全局日成本熔断(批次196 · 手册 §11#3)。默认关(env 未设 → 不熔断,inert-safe)。
 *
 * 目的:限流(isRateLimited)只挡「同一 IP 刷太快」,挡不住「大量真实用户/多 key 一起烧」。
 * 这里再加一道**按天累计的美元级熔断**:当天粗估花费超 NESIO_DAILY_AI_BUDGET_USD 时,
 * 付费云 AI 路由 429，直到跨天归零。
 *
 * 局限(与 isRateLimited 同款,已在 api-auth 头注声明):**per-instance 内存**,非分布式;
 * 多实例/Serverless 下各算各的,是安全网不是精确账单。真分布式待接 Vercel KV/Upstash(手册#2 同源)。
 *
 * 成本按路由**粗估**(数量级,非账单 —— 与 estimateCostUsd 的「not a bill」一致)。
 */
import { envValue } from '@/lib/portal/env';

// 单次调用粗估美元(输入+输出合计的量级)。宁可估高一点,熔断偏保守。
const ROUTE_COST_USD: Record<string, number> = {
  chat: 0.004,
  analyze: 0.006,
  mirror_letter: 0.03,
  tts: 0.015,
  meeting_notes: 0.02,
  avatarify: 0.04,
  person_extract: 0.006,
  inventory_extract: 0.006,
  living_model: 0.02,
  health_insight: 0.02,
  guidance_language: 0.004,
  embed: 0.0002,
};
const DEFAULT_COST_USD = 0.005;

let day = '';
let spentUsd = 0;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function roll(): void {
  const d = today();
  if (d !== day) { day = d; spentUsd = 0; }
}

/** 每次付费云 AI 调用后累计粗估花费(reportAiCall 里调)。 */
export function recordAiCall(route: string): void {
  roll();
  spentUsd += ROUTE_COST_USD[route] ?? DEFAULT_COST_USD;
}

/** 当天预算上限(美元)。未设 / ≤0 → 不熔断(inert)。 */
export function dailyBudgetUsd(): number {
  const n = Number(envValue('NESIO_DAILY_AI_BUDGET_USD') || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 当天粗估已花(美元,两位小数)。诊断/告警用。 */
export function spentTodayUsd(): number {
  roll();
  return Math.round(spentUsd * 100) / 100;
}

/** 是否已超当天预算。未设预算 → 恒 false(inert)。 */
export function isOverDailyBudget(): boolean {
  const cap = dailyBudgetUsd();
  if (cap <= 0) return false;
  roll();
  return spentUsd >= cap;
}
