/**
 * AI 供应商真实回退链 —— 单一数据源(架构审查 #8:契约漂移修复)。
 * ai-complete.ts(真运行时)与 ai-provider-router-contract.mjs(报告契约)
 * 共读这里,图上画的路由从此就是真跑的路由。
 */
export const AI_COMPLETION_CHAIN = Object.freeze(['claude', 'gemini']);
// 批次 44(生产 429 日志实证):免费层配额是**按模型分池、分钟级**的 ——
// gemini-2.0-flash 免费层 limit:0(Google 已整个撤掉,试了必 429,纯白撞);
// 2.5-flash-lite 免费层最宽(15 RPM)且此前根本没用过 = 全新的池,打头;
// 2.5-flash(10 RPM)/flash-latest(现指 3.5-flash)殿后。这样开屏同步提取
// 与用户提问挤进同一分钟窗时,回退链还能横跨三个独立配额池。
export const GEMINI_MODEL_FALLBACKS = Object.freeze(['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest']);
