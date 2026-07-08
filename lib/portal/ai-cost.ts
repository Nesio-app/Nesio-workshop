/**
 * AI 成本核算 — 把 provider 返回的 token 用量换算成美元估算,让 /admin 有**真**成本曲线,
 * 而不是按拍平常数估(成本经济学审计 C2:成本不可度量 → 谈优化都是空的)。
 *
 * 单价为 2026-07 各家公开 per-1M-token 价,**标注为估算**;官方调价时只改这一张表。
 * 纯函数、无副作用、无 import —— server / client / 测试皆可直接用。
 */

export interface AiUsage {
  inputTokens: number;       // 计费输入(不含缓存命中)
  outputTokens: number;
  cacheReadTokens?: number;  // 缓存命中读:Claude 计 0.1x 输入价
  cacheWriteTokens?: number; // 缓存写入:Claude 计 1.25x 输入价
}

/** USD / 1M tokens。 */
export interface AiPrice { input: number; output: number }

// 按 model 名子串宽松匹配:claude-3-5-haiku-latest / claude-haiku-4-5 都归 haiku 档。
// 顺序 = 优先级(opus 先于 sonnet,避免 "claude-sonnet" 里的子串误配)。
const CLAUDE_PRICES: Array<{ match: RegExp; price: AiPrice }> = [
  { match: /opus/i, price: { input: 15, output: 75 } },
  { match: /sonnet/i, price: { input: 3, output: 15 } },
  { match: /haiku/i, price: { input: 0.8, output: 4 } },
];
const GEMINI_PRICES: Array<{ match: RegExp; price: AiPrice }> = [
  { match: /pro/i, price: { input: 1.25, output: 5 } },
  { match: /flash/i, price: { input: 0.075, output: 0.3 } },
];
// 未知型号保守估:Claude 按 haiku(app 默认)、Gemini 按 flash。
const DEFAULT_CLAUDE: AiPrice = { input: 0.8, output: 4 };
const DEFAULT_GEMINI: AiPrice = { input: 0.075, output: 0.3 };

export function priceFor(provider: 'claude' | 'gemini', model: string): AiPrice {
  const table = provider === 'claude' ? CLAUDE_PRICES : GEMINI_PRICES;
  for (const { match, price } of table) if (match.test(model || '')) return price;
  return provider === 'claude' ? DEFAULT_CLAUDE : DEFAULT_GEMINI;
}

/**
 * 估算单次调用美元成本。缓存命中读按 0.1x、缓存写入按 1.25x(Claude 计价规则);
 * Gemini 无缓存写概念,其 cacheReadTokens 也按 0.1x 近似。负数一律夹到 0。
 */
export function estimateCostUsd(provider: 'claude' | 'gemini', model: string, usage: AiUsage): number {
  const p = priceFor(provider, model);
  const M = 1_000_000;
  const nz = (n: number | undefined) => Math.max(0, n || 0);
  const cost =
    nz(usage.inputTokens) * p.input +
    nz(usage.outputTokens) * p.output +
    nz(usage.cacheReadTokens) * p.input * 0.1 +
    nz(usage.cacheWriteTokens) * p.input * 1.25;
  return cost / M;
}
