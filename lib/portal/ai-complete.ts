/**
 * Shared single-shot text completion — same provider order as the chat route
 * (Anthropic Claude primary → Gemini multi-model fallback) so any feature that
 * needs "one prompt in, one text out" uses the channel that actually works in
 * this deployment, instead of hard-coding one Gemini model. Server-only.
 */

import { resolveAiKey } from '@/lib/portal/ai-keys';
import { envValue } from '@/lib/portal/env';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Same fallback order as chat/analyze routes — 429/unavailable on one → try next.
const GEMINI_MODEL_FALLBACKS = ['gemini-2.0-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];

export function aiProviderAvailable(): boolean {
  // 统一别名解析:此前只认 GEMINI_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY,漏了
  // GOOGLE_AI_API_KEY / GOOGLE_API_KEY —— 共享客户端也曾中招同一个窄读 bug。
  return Boolean(resolveAiKey('anthropic') || resolveAiKey('gemini'));
}

async function callClaude(apiKey: string, prompt: string, system: string, maxTokens: number, model?: string, temperature?: number): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || envValue('CLAUDE_MODEL') || envValue('ANTHROPIC_MODEL') || 'claude-3-5-haiku-latest',
      max_tokens: maxTokens,
      ...(typeof temperature === 'number' ? { temperature } : {}),
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json() as { content?: Array<{ type: string; text?: string }>; error?: { message: string } };
  if (data.error) throw new Error(`Anthropic: ${data.error.message}`);
  return (data.content ?? []).filter((c) => c.type === 'text' && c.text).map((c) => c.text!).join('').trim();
}

async function callGemini(apiKey: string, prompt: string, system: string, maxTokens: number, temperature?: number): Promise<string> {
  const configuredModel = envValue('GEMINI_MODEL');
  const models = Array.from(new Set([configuredModel, ...GEMINI_MODEL_FALLBACKS].filter(Boolean)));
  let lastError = 'Gemini unavailable';

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: temperature ?? 0.6, maxOutputTokens: maxTokens },
        }),
      });
      const data = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string };
      };
      if (res.ok) {
        const text = (data.candidates?.[0]?.content?.parts ?? [])
          .filter((p): p is { text: string } => typeof p.text === 'string' && p.text.length > 0)
          .map((p) => p.text)
          .join('')
          .trim();
        if (text) return text;
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

/**
 * Complete a single prompt to text. Tries Claude first (if ANTHROPIC_API_KEY),
 * then Gemini (multi-model). Throws with a descriptive message if all fail.
 * Returns { text, provider } so callers can log which channel served it.
 *
 * opts.model      — override the Claude model (e.g. sonnet for deep-reasoning callers);
 *                   Gemini keeps its own fallback chain.
 * opts.temperature — applied to both providers (e.g. 0.85 for creative briefing copy).
 */
export async function completeText(
  { prompt, system = '', maxTokens = 1024, model, temperature }:
  { prompt: string; system?: string; maxTokens?: number; model?: string; temperature?: number },
): Promise<{ text: string; provider: 'claude' | 'gemini' }> {
  const anthropicKey = resolveAiKey('anthropic');
  const geminiKey = resolveAiKey('gemini');

  if (anthropicKey) {
    try {
      const text = await callClaude(anthropicKey, prompt, system, maxTokens, model, temperature);
      if (text) return { text, provider: 'claude' };
    } catch (err) {
      // Fall through to Gemini when Claude errors (auth/quota/etc.).
      if (!geminiKey) throw err;
    }
  }
  if (geminiKey) {
    const text = await callGemini(geminiKey, prompt, system, maxTokens, temperature);
    return { text, provider: 'gemini' };
  }
  throw new Error('no_ai_provider');
}
