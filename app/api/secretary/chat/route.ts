import { NextRequest, NextResponse } from 'next/server';
import {
  isSecretaryAiRequestAllowed,
  launchUnavailablePayload,
} from '@/lib/portal/launch-safety';
import { normalizePortalLocale, type PortalLocale } from '@/lib/portal/profile';
import {
  buildSecretaryPersonaPrompt,
  buildSecretarySystemPrompt,
} from '@/lib/portal/secretary-ai-prompt-catalog.mjs';

const DEFAULT_MODELS = 'gemini-2.5-flash-lite,gemini-2.5-flash,gemini-1.5-flash-8b';
const DOUBAO_API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_CLAUDE_MODEL = 'claude-3-5-haiku-latest';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type ChatTurn = { role: 'user' | 'assistant'; content: string };

function getGoogleKey(): string | undefined {
  const raw =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY;
  return raw?.trim() || undefined;
}

function getDoubaoKey(): string | undefined {
  const raw =
    process.env.DOUBAO_KEY ||
    process.env.DOUBAO_API_KEY ||
    process.env.ARK_API_KEY ||
    process.env.VOLCENGINE_API_KEY;
  return raw?.trim() || undefined;
}

function getOpenAIKey(): string | undefined {
  const raw = process.env.OpenAI_KEY || process.env.OPENAI_API_KEY;
  return raw?.trim() || undefined;
}

function getAnthropicKey(): string | undefined {
  const raw = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  return raw?.trim() || undefined;
}

function getOpenAIModelId(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

function getClaudeModelId(): string {
  return process.env.CLAUDE_MODEL?.trim() || process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
}

function getDoubaoModelId(): string {
  const endpoint = process.env.DOUBAO_ENDPOINT?.trim();
  if (endpoint) return endpoint;
  return (
    process.env.DOUBAO_MODEL?.trim() ||
    'doubao-pro-32k'
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryDelayMs(msg: string): number | null {
  const m = msg.match(/retry in ([\d.]+)s/i);
  if (!m) return null;
  const sec = parseFloat(m[1]);
  if (!Number.isFinite(sec) || sec <= 0 || sec > 60) return null;
  return Math.ceil(sec * 1000) + 300;
}

function isQuotaError(msg: string): boolean {
  return /quota|rate limit|429|resource_exhausted/i.test(msg);
}

function normalizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as ChatTurn).role;
    const content = String((item as ChatTurn).content || '').trim();
    if ((role === 'user' || role === 'assistant') && content) {
      out.push({ role, content: content.slice(0, 4000) });
    }
  }
  return out.slice(-12);
}

async function generateWithModel(
  model: string,
  contents: Array<{ role: string; parts: Array<{ text: string }> }>,
  maxTokens: number,
  key: string,
  systemPrompt: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  let lastErr = `No response from ${model}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          maxOutputTokens: Math.min(Math.max(maxTokens, 64), 4096),
          temperature: 0.65,
        },
      }),
    });

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };

    if (!res.ok) {
      lastErr = data?.error?.message || `HTTP ${res.status} for ${model}`;
      const delay = parseRetryDelayMs(lastErr);
      if (delay && attempt < 2) {
        await sleep(delay);
        continue;
      }
      throw new Error(lastErr);
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text) return text;
    lastErr = `Empty response from ${model}`;
    break;
  }

  throw new Error(lastErr);
}

async function chatWithGemini(
  contents: Array<{ role: string; parts: Array<{ text: string }> }>,
  maxTokens: number,
  key: string,
  systemPrompt: string
): Promise<string> {
  const models = (process.env.GEMINI_MODEL || DEFAULT_MODELS)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  let lastErr = 'No models tried';
  for (const model of models) {
    try {
      return await generateWithModel(model, contents, maxTokens, key, systemPrompt);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (!isQuotaError(lastErr)) continue;
    }
  }
  throw new Error(lastErr);
}

async function chatWithGeminiFallback(
  history: ChatTurn[],
  message: string,
  maxTokens: number,
  key: string,
  requestedModel: string,
  locale: PortalLocale
): Promise<string> {
  const contents = toGeminiContents(history, buildSecretaryPersonaPrompt(locale, requestedModel, message));
  return chatWithGemini(contents, maxTokens, key, buildSecretarySystemPrompt(locale));
}

async function chatWithOpenAI(
  history: ChatTurn[],
  message: string,
  maxTokens: number,
  key: string,
  systemPrompt: string
): Promise<string> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: message });

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: getOpenAIModelId(),
      messages,
      max_tokens: Math.min(Math.max(maxTokens, 64), 4096),
      temperature: 0.65,
    }),
  });

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(data?.error?.message || `OpenAI HTTP ${res.status}`);
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty response from OpenAI');
  return text;
}

async function chatWithClaude(
  history: ChatTurn[],
  message: string,
  maxTokens: number,
  key: string,
  systemPrompt: string
): Promise<string> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: message });

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: getClaudeModelId(),
      system: systemPrompt,
      messages,
      max_tokens: Math.min(Math.max(maxTokens, 64), 4096),
      temperature: 0.65,
    }),
  });

  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(data?.error?.message || `Claude HTTP ${res.status}`);
  }

  const text = data?.content
    ?.map((part) => part?.text)
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!text) throw new Error('Empty response from Claude');
  return text;
}

async function chatWithDoubao(
  history: ChatTurn[],
  message: string,
  maxTokens: number,
  key: string,
  systemPrompt: string
): Promise<string> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: message });

  const res = await fetch(DOUBAO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: getDoubaoModelId(),
      messages,
      max_tokens: Math.min(Math.max(maxTokens, 64), 4096),
      temperature: 0.65,
    }),
  });

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(data?.error?.message || `Doubao HTTP ${res.status}`);
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty response from Doubao');
  return text;
}

function toGeminiContents(history: ChatTurn[], message: string) {
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  for (const turn of history) {
    contents.push({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    });
  }
  contents.push({ role: 'user', parts: [{ text: message }] });
  return contents;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  if (
    process.env.NEXT_PUBLIC_BAOHE_FIRST_LAUNCH_RISK_ISOLATION !== 'off' &&
    !isSecretaryAiRequestAllowed(req)
  ) {
    return NextResponse.json(
      launchUnavailablePayload('api:secretary:chat', 'secretary'),
      { status: 403, headers: corsHeaders },
    );
  }

  let body: {
    message?: string;
    prompt?: string;
    history?: unknown;
    maxTokens?: number;
    model?: string;
    locale?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders });
  }

  const message = String(body.message || body.prompt || '').trim();
  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400, headers: corsHeaders });
  }

  const history = normalizeHistory(body.history);
  const maxTokens = Number(body.maxTokens) || 1200;
  const modelId = String(body.model || 'gemini').toLowerCase();
  const locale = normalizePortalLocale(body.locale);
  const systemPrompt = buildSecretarySystemPrompt(locale);

  try {
    if (modelId === 'doubao') {
      const key = getDoubaoKey();
      if (!key) {
        const fallbackKey = getGoogleKey();
        if (!fallbackKey) {
          return NextResponse.json(
            {
              error: 'AI not configured',
              hint: 'Set DOUBAO_KEY or GEMINI_API_KEY in Vercel Environment Variables',
            },
            { status: 503, headers: corsHeaders }
          );
        }
        const text = await chatWithGeminiFallback(history, message, maxTokens, fallbackKey, modelId, locale);
        return NextResponse.json({ text, model: 'gemini', requestedModel: modelId, fallback: true }, { headers: corsHeaders });
      }
      const text = await chatWithDoubao(history, message, maxTokens, key, systemPrompt);
      return NextResponse.json({ text, model: 'doubao' }, { headers: corsHeaders });
    }

    if (modelId === 'chatgpt' || modelId === 'openai') {
      const key = getOpenAIKey();
      if (!key) {
        const fallbackKey = getGoogleKey();
        if (!fallbackKey) {
          return NextResponse.json(
            {
              error: 'AI not configured',
              hint: 'Set OpenAI_KEY or GEMINI_API_KEY in Vercel Environment Variables',
            },
            { status: 503, headers: corsHeaders }
          );
        }
        const text = await chatWithGeminiFallback(history, message, maxTokens, fallbackKey, modelId, locale);
        return NextResponse.json({ text, model: 'gemini', requestedModel: modelId, fallback: true }, { headers: corsHeaders });
      }
      const text = await chatWithOpenAI(history, message, maxTokens, key, systemPrompt);
      return NextResponse.json({ text, model: 'chatgpt' }, { headers: corsHeaders });
    }

    if (modelId === 'claude' || modelId === 'anthropic') {
      const key = getAnthropicKey();
      if (!key) {
        const fallbackKey = getGoogleKey();
        if (!fallbackKey) {
          return NextResponse.json(
            {
              error: 'AI not configured',
              hint: 'Set ANTHROPIC_API_KEY or GEMINI_API_KEY in Vercel Environment Variables',
            },
            { status: 503, headers: corsHeaders }
          );
        }
        const text = await chatWithGeminiFallback(history, message, maxTokens, fallbackKey, modelId, locale);
        return NextResponse.json({ text, model: 'gemini', requestedModel: modelId, fallback: true }, { headers: corsHeaders });
      }
      const text = await chatWithClaude(history, message, maxTokens, key, systemPrompt);
      return NextResponse.json({ text, model: 'claude' }, { headers: corsHeaders });
    }

    if (modelId === 'deepseek' || modelId === 'grok') {
      const fallbackKey = getGoogleKey();
      if (!fallbackKey) {
        return NextResponse.json(
          {
            error: 'AI not configured',
            hint: 'Set GEMINI_API_KEY in Vercel Environment Variables for AI compatibility routing',
          },
          { status: 503, headers: corsHeaders }
        );
      }
      const text = await chatWithGeminiFallback(history, message, maxTokens, fallbackKey, modelId, locale);
      return NextResponse.json({ text, model: 'gemini', requestedModel: modelId, fallback: true }, { headers: corsHeaders });
    }

    const key = getGoogleKey();
    if (!key) {
      return NextResponse.json(
        {
          error: 'AI not configured',
          hint: 'Set GEMINI_API_KEY in Vercel Environment Variables, then Redeploy',
        },
        { status: 503, headers: corsHeaders }
      );
    }

    const contents = toGeminiContents(history, message);
    const text = await chatWithGemini(contents, maxTokens, key, systemPrompt);
    return NextResponse.json({ text, model: 'gemini' }, { headers: corsHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[secretary/chat]', modelId, msg);
    const quota = isQuotaError(msg);
    return NextResponse.json(
      { error: quota ? 'quota_exceeded' : 'AI request failed', detail: msg },
      { status: quota ? 429 : 500, headers: corsHeaders }
    );
  }
}
