/**
 * AI 供应商真实回退链 —— 单一数据源(架构审查 #8:契约漂移修复)。
 * ai-complete.ts(真运行时)与 ai-provider-router-contract.mjs(报告契约)
 * 共读这里,图上画的路由从此就是真跑的路由。
 */
export const AI_COMPLETION_CHAIN = Object.freeze(['claude', 'gemini']);
export const GEMINI_MODEL_FALLBACKS = Object.freeze(['gemini-2.0-flash', 'gemini-flash-latest', 'gemini-2.5-flash']);
