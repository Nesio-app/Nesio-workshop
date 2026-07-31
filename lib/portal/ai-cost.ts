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
const OPENAI_PRICES: Array<{ match: RegExp; price: AiPrice }> = [
  { match: /gpt-4o(?!-mini)/i, price: { input: 2.5, output: 10 } },
  { match: /gpt-4o-mini/i, price: { input: 0.15, output: 0.6 } },
];
// 未知型号保守估:Claude 按 haiku(app 默认)、Gemini 按 flash、OpenAI 按 4o-mini。
const DEFAULT_CLAUDE: AiPrice = { input: 0.8, output: 4 };
const DEFAULT_GEMINI: AiPrice = { input: 0.075, output: 0.3 };
const DEFAULT_OPENAI: AiPrice = { input: 0.15, output: 0.6 };

/**
 * Kimi(Moonshot)的价格 —— **我不知道,所以不编**(2026-07-31)。
 *
 * 上面那三家的数字是有据可查的公开价目。Kimi 3 是新的,我手上没有可靠来源;
 * 随手填一个「差不多」的数,后果是 /admin 的成本页从此长期给出一个看着精确、
 * 实则凭空捏造的金额 —— 那比没有数字更坏,因为没人会去怀疑它。
 *
 * 所以走环境变量(KIMI_PRICE_INPUT / KIMI_PRICE_OUTPUT,单位:美元 / 百万 token)。
 * 没配 = 0,而 0 在这里的含义是**「还没告诉我价格」,不是「免费」**;
 * priceKnown() 把这个区别透出去,让显示层能说人话而不是印一个 $0.00。
 */
function kimiPrice(env: Record<string, string | undefined> = process.env): AiPrice {
  const num = (v: string | undefined) => {
    const n = Number((v ?? '').trim());
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return { input: num(env.KIMI_PRICE_INPUT), output: num(env.KIMI_PRICE_OUTPUT) };
}

export type AiCostProvider = 'kimi' | 'claude' | 'gemini' | 'openai';

export function priceFor(provider: AiCostProvider, model: string): AiPrice {
  if (provider === 'kimi') return kimiPrice();
  const table = provider === 'claude' ? CLAUDE_PRICES : provider === 'openai' ? OPENAI_PRICES : GEMINI_PRICES;
  for (const { match, price } of table) if (match.test(model || '')) return price;
  return provider === 'claude' ? DEFAULT_CLAUDE : provider === 'openai' ? DEFAULT_OPENAI : DEFAULT_GEMINI;
}

/**
 * 这个 provider 的价格是不是**真的知道**。
 *
 * 只有 kimi 会返回 false(且仅在没配价格时)—— 别处的数字都有出处。
 * 显示层据此把「$0.00」和「价格没配」分开说:前者是花了钱但很少,
 * 后者是根本没算 —— 混成一个 $0.00,用户会以为这条通道不要钱。
 */
export function priceKnown(provider: AiCostProvider, env: Record<string, string | undefined> = process.env): boolean {
  if (provider !== 'kimi') return true;
  const p = kimiPrice(env);
  return p.input > 0 || p.output > 0;
}

/**
 * 估算单次调用美元成本。缓存命中读按 0.1x、缓存写入按 1.25x(Claude 计价规则);
 * Gemini 无缓存写概念,其 cacheReadTokens 也按 0.1x 近似。负数一律夹到 0。
 */
export function estimateCostUsd(provider: AiCostProvider, model: string, usage: AiUsage): number {
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
