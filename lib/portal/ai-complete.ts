/**
 * Shared single-shot text completion — same provider order as the chat route
 * (Anthropic Claude primary → Gemini multi-model fallback) so any feature that
 * needs "one prompt in, one text out" uses the channel that actually works in
 * this deployment, instead of hard-coding one Gemini model. Server-only.
 */

import { GEMINI_MODEL_FALLBACKS } from './ai-provider-chain.mjs';
import { resolveAiKey } from '@/lib/portal/ai-keys';
import { envValue } from '@/lib/portal/env';
import { estimateCostUsd, type AiUsage } from '@/lib/portal/ai-cost';
import { reportAiCall } from '@/lib/portal/ai-telemetry';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// 回退链单一数据源(契约同读,防漂移):lib/portal/ai-provider-chain.mjs 顶部 import

export function aiProviderAvailable(): boolean {
  // 统一别名解析:此前只认 GEMINI_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY,漏了
  // GOOGLE_AI_API_KEY / GOOGLE_API_KEY —— 共享客户端也曾中招同一个窄读 bug。
  return Boolean(resolveAiKey('anthropic') || resolveAiKey('gemini') || resolveAiKey('openai'));
}

/** 解析 data URL(data:image/jpeg;base64,...)→ { mimeType, base64 };非法返回 null。 */
function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  return m ? { mimeType: m[1], base64: m[2] } : null;
}

interface CallResult { text: string; usage: AiUsage; model: string }

async function callClaude(apiKey: string, prompt: string, system: string, maxTokens: number, model?: string, temperature?: number, image?: string): Promise<CallResult> {
  const img = image ? parseDataUrl(image) : null;
  const content = img
    ? [
        { type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } },
        { type: 'text', text: prompt },
      ]
    : prompt;
  const usedModel = model || envValue('CLAUDE_MODEL') || envValue('ANTHROPIC_MODEL') || 'claude-3-5-haiku-latest';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: usedModel,
      max_tokens: maxTokens,
      ...(typeof temperature === 'number' ? { temperature } : {}),
      system,
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await res.json() as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message: string };
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
  if (data.error) throw new Error(`Anthropic: ${data.error.message}`);
  const text = (data.content ?? []).filter((c) => c.type === 'text' && c.text).map((c) => c.text!).join('').trim();
  const u = data.usage || {};
  return {
    text,
    model: usedModel,
    usage: {
      inputTokens: u.input_tokens || 0,
      outputTokens: u.output_tokens || 0,
      cacheReadTokens: u.cache_read_input_tokens || 0,
      cacheWriteTokens: u.cache_creation_input_tokens || 0,
    },
  };
}

async function callGemini(apiKey: string, prompt: string, system: string, maxTokens: number, temperature?: number, image?: string, responseFormat?: 'json'): Promise<CallResult> {
  const configuredModel = envValue('GEMINI_MODEL');
  const models = Array.from(new Set([configuredModel, ...GEMINI_MODEL_FALLBACKS].filter(Boolean)));
  let lastError = 'Gemini unavailable';
  const img = image ? parseDataUrl(image) : null;
  const parts = img
    ? [{ inlineData: { mimeType: img.mimeType, data: img.base64 } }, { text: prompt }]
    : [{ text: prompt }];

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts }],
          // responseFormat:'json' → 强制合法 JSON(修「大结构化输出被截断/跑成大白话 → no JSON」)。
          generationConfig: {
            temperature: temperature ?? 0.6,
            maxOutputTokens: maxTokens,
            ...(responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      });
      const data = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string };
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
      };
      if (res.ok) {
        const text = (data.candidates?.[0]?.content?.parts ?? [])
          .filter((p): p is { text: string } => typeof p.text === 'string' && p.text.length > 0)
          .map((p) => p.text)
          .join('')
          .trim();
        if (text) {
          const um = data.usageMetadata || {};
          return {
            text,
            model,
            usage: {
              inputTokens: um.promptTokenCount || 0,
              outputTokens: um.candidatesTokenCount || 0,
              cacheReadTokens: um.cachedContentTokenCount || 0,
            },
          };
        }
        lastError = `Gemini ${model} empty_response`;
        break;
      }
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      lastError = `Gemini ${model} ${res.status}${data.error?.message ? `: ${data.error.message}` : ''}`;
      break;
    }
  }
  throw new Error(lastError);
}

async function callOpenAI(apiKey: string, prompt: string, system: string, maxTokens: number, temperature?: number, image?: string, responseFormat?: 'json'): Promise<CallResult> {
  const img = image ? parseDataUrl(image) : null;
  const userContent = img
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: image, detail: 'low' } },
      ]
    : prompt;
  const usedModel = envValue('OPENAI_MODEL') || 'gpt-4o-mini';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: usedModel,
      max_tokens: maxTokens,
      ...(typeof temperature === 'number' ? { temperature } : {}),
      ...(responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: userContent },
      ],
    }),
  });
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; type?: string };
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (!res.ok || data.error) throw new Error(`OpenAI ${res.status}${data.error?.message ? `: ${data.error.message}` : ''}`);
  return {
    text: (data.choices?.[0]?.message?.content || '').trim(),
    model: usedModel,
    usage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0 },
  };
}

/** 把一次 completeText 调用的真实 token + 估算成本落进现有 ai_route 遥测(server-only,best-effort)。 */
function logAiCost(route: string, provider: 'claude' | 'gemini' | 'openai', startedAt: number, r: CallResult): void {
  const extra: Record<string, string | number | boolean> = {
    provider,
    model: r.model,
    in_tokens: r.usage.inputTokens,
    out_tokens: r.usage.outputTokens,
    cost_usd: Number(estimateCostUsd(provider, r.model, r.usage).toFixed(6)),
  };
  if (r.usage.cacheReadTokens) extra.cache_read_tokens = r.usage.cacheReadTokens;
  reportAiCall(route, true, startedAt, extra);
}

/**
 * Complete a single prompt to text. Tries Claude first (if ANTHROPIC_API_KEY),
 * then Gemini (multi-model). Throws with a descriptive message if all fail.
 * Returns { text, provider } so callers can log which channel served it.
 *
 * opts.model      — override the Claude model (e.g. sonnet for deep-reasoning callers);
 *                   Gemini keeps its own fallback chain.
 * opts.temperature — applied to both providers (e.g. 0.85 for creative briefing copy).
 * opts.route       — telemetry 标签(默认 'complete'),用于 /admin 按路由归集真实 token 成本。
 */
export async function completeText(
  { prompt, system = '', maxTokens = 1024, model, temperature, image, responseFormat, route = 'complete' }:
  { prompt: string; system?: string; maxTokens?: number; model?: string; temperature?: number; image?: string; responseFormat?: 'json'; route?: string },
): Promise<{ text: string; provider: 'claude' | 'gemini' | 'openai'; usage?: AiUsage; model?: string }> {
  const anthropicKey = resolveAiKey('anthropic');
  const geminiKey = resolveAiKey('gemini');
  const openaiKey = resolveAiKey('openai');
  const startedAt = Date.now();

  if (anthropicKey) {
    try {
      const r = await callClaude(anthropicKey, prompt, system, maxTokens, model, temperature, image);
      if (r.text) {
        logAiCost(route, 'claude', startedAt, r);
        return { text: r.text, provider: 'claude', usage: r.usage, model: r.model };
      }
    } catch (err) {
      // Fall through when Claude errors (auth/quota/etc.).
      if (!geminiKey && !openaiKey) throw err;
    }
  }
  if (geminiKey) {
    try {
      const r = await callGemini(geminiKey, prompt, system, maxTokens, temperature, image, responseFormat);
      logAiCost(route, 'gemini', startedAt, r);
      return { text: r.text, provider: 'gemini', usage: r.usage, model: r.model };
    } catch (err) {
      // 批次 45:Gemini 挂(免费层分钟限流)→ OpenAI 第三层。analyze 路由早就有
      // 这层,chat/completeText 一直缺 —— 「图片识别能用、问一问不行」的根因。
      if (!openaiKey) throw err;
    }
  }
  if (openaiKey) {
    const r = await callOpenAI(openaiKey, prompt, system, maxTokens, temperature, image, responseFormat);
    logAiCost(route, 'openai', startedAt, r);
    return { text: r.text, provider: 'openai', usage: r.usage, model: r.model };
  }
  throw new Error('no_ai_provider');
}
