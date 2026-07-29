/**
 * 全局日成本熔断(批次196 · 手册 §11#3;批次211 默认武装)。
 * 真实部署(Vercel)未配 env → 默认武装 $25/实例/天 安全网(消灭「上线即漏钱」);dev/test 保持 inert。
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
const localDayKey = (d: Date = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // 本地日键(vm 测试壳 stub require,lib 层内联不 import)

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
  daily_brief: 0.004,
  llm_sweep: 0.006,
  embed: 0.0002,
  gmail: 0.008,
  gmail_quick: 0.004,
  gmail_draft_reply: 0.003,
};
const DEFAULT_COST_USD = 0.005;
/** 真实部署(Vercel)上没配 env 时的兜底日上限(每实例·美元)。安全网,非账单;可用 env 调高/调低/设 0 关闭。 */
const DEFAULT_DAILY_BUDGET_USD = 25;

let day = '';
let spentUsd = 0;

function today(): string {
  return localDayKey();
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
  const raw = envValue('NESIO_DAILY_AI_BUDGET_USD');
  if (raw !== undefined && raw !== null && raw !== '') {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0; // 显式配置优先(显式 0/负 = 明确关闭,逃生阀)
  }
  // 未配置:真实部署(Vercel)默认武装安全网,消灭「忘了设 env = 零上限 = 上线即漏钱」的根因;
  // 本地 dev/test 保持 inert(不干扰跑测/联调)。运维可用 env 调高/调低,或显式设 0 关闭。
  return envValue('VERCEL') ? DEFAULT_DAILY_BUDGET_USD : 0;
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
