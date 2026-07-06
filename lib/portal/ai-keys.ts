/**
 * AI Key 统一解析(app 级共享)—— 别名收敛,各路由不再各读各的 env(批次 52)。
 *
 * 问题:同一把 Gemini key 全仓有 4 个 env 名(GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY /
 * GOOGLE_AI_API_KEY / GOOGLE_API_KEY),Claude 有 2 个。各 AI 路由手读自己的子集 → 读窄了的路由
 * 即使 key 已配也静默走兜底(health-insight 只读 GEMINI_API_KEY 就中招)。
 *
 * 这里把「一把 key 的所有别名」收成一处,所有 AI 路由 import 它。
 * 别名组与 ai-provider-router-contract.mjs 的 alternateGroups 保持一致(契约有测试钉住那份)。
 * 纯函数、可注入 env(可单测)。
 */

// 与 lib/portal/ai-provider-router-contract.mjs 的 alternateGroups 同步(改一处两处都要改)。
export const AI_KEY_ALIASES = {
  anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_API_KEY', 'GOOGLE_API_KEY'],
  openai: ['OPENAI_API_KEY', 'OpenAI_KEY'],
  doubao: ['DOUBAO_KEY', 'DOUBAO_API_KEY', 'ARK_API_KEY', 'VOLCENGINE_API_KEY'],
} as const;

export type AiProvider = keyof typeof AI_KEY_ALIASES;

export interface ResolvedAiKeys {
  anthropic: string;
  gemini: string;
  openai: string;
  doubao: string;
}

type EnvLike = Record<string, string | undefined>;

/** 取一组别名里第一个非空值(去空白)。 */
function firstNonEmpty(names: readonly string[], env: EnvLike): string {
  for (const n of names) {
    const v = (env[n] ?? '').trim();
    if (v) return v;
  }
  return '';
}

/** 解析全部 provider 的 key(env 可注入,默认读 process.env)。 */
export function resolveAiKeys(env: EnvLike = process.env): ResolvedAiKeys {
  return {
    anthropic: firstNonEmpty(AI_KEY_ALIASES.anthropic, env),
    gemini: firstNonEmpty(AI_KEY_ALIASES.gemini, env),
    openai: firstNonEmpty(AI_KEY_ALIASES.openai, env),
    doubao: firstNonEmpty(AI_KEY_ALIASES.doubao, env),
  };
}

/** 单个 provider 的 key(便捷)。 */
export function resolveAiKey(provider: AiProvider, env: EnvLike = process.env): string {
  return firstNonEmpty(AI_KEY_ALIASES[provider], env);
}
