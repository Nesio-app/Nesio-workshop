/**
 * AI 供应商真实回退链 —— 单一数据源(架构审查 #8:契约漂移修复)。
 * ai-complete.ts(真运行时)与 ai-provider-router-contract.mjs(报告契约)
 * 共读这里,图上画的路由从此就是真跑的路由。
 */
// 批次 45:补 openai 第三层(analyze 路由早就有,chat/completeText 一直缺 ——
// 这就是「图片识别能用、问一问不行」的逻辑不一致,用户实测抓出来的)。
/*
 * 2026-07-31 用户定案:「我的 AI 调用用她的(Kimi)API,然后 google 托底」。
 *
 * 于是 kimi 进链首、gemini 紧随其后 —— 这两级就是用户要的主 + 托底。
 * claude / openai **留在后面没删**:它们只在配了 key 时才会被走到,
 * 没配就是自然的两级链。删掉是不可逆的,而留着的代价只是一段不执行的分支;
 * 真要撤,把 key 从环境变量里拿掉即可,不必改代码。
 */
export const AI_COMPLETION_CHAIN = Object.freeze(['kimi', 'gemini', 'claude', 'openai']);
// 批次 44(生产 429 日志实证):免费层配额是**按模型分池、分钟级**的 ——
// gemini-2.0-flash 免费层 limit:0(Google 已整个撤掉,试了必 429,纯白撞);
// 2.5-flash-lite 免费层最宽(15 RPM)且此前根本没用过 = 全新的池,打头;
// 2.5-flash(10 RPM)/flash-latest(现指 3.5-flash)殿后。这样开屏同步提取
// 与用户提问挤进同一分钟窗时,回退链还能横跨三个独立配额池。
export const GEMINI_MODEL_FALLBACKS = Object.freeze(['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest']);
