import type { VercelRequest, VercelResponse } from '@vercel/node';

const DEFAULT_MODELS = 'gemini-2.5-flash-lite,gemini-2.5-flash,gemini-1.5-flash-8b';

const SYSTEM_PROMPT = `你是「宝盒」里的 AI 私人秘书。语气沉静、清晰、有温度，像一位值得信赖的幕僚。

你的职责：
- 帮用户梳理待办、优先级与下一步行动
- 把模糊焦虑写成可执行的小步骤
- 做简短备忘、复盘与决策权衡（利弊各三点即可）
- 在用户疲惫时先安顿情绪，再谈效率

原则：回答用简体中文；默认简洁（除非用户要求展开）；不编造用户未提供的事实；涉及专业医疗/法律时提醒寻求真人帮助。`;

type ChatTurn = { role: 'user' | 'assistant'; content: string };

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getGoogleKey(): string | undefined {
  const raw =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY;
  return raw?.trim() || undefined;
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
  key: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  let lastErr = `No response from ${model}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
  key: string
): Promise<string> {
  const models = (process.env.GEMINI_MODEL || DEFAULT_MODELS)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  let lastErr = 'No models tried';
  for (const model of models) {
    try {
      return await generateWithModel(model, contents, maxTokens, key);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (!isQuotaError(lastErr)) continue;
    }
  }
  throw new Error(lastErr);
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = getGoogleKey();
  if (!key) {
    return res.status(503).json({
      error: 'AI not configured',
      hint: 'Set GEMINI_API_KEY in Vercel Environment Variables, then Redeploy',
    });
  }

  const body = req.body || {};
  const message = String(body.message || body.prompt || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'message required' });
  }

  const history = normalizeHistory(body.history);
  const maxTokens = Number(body.maxTokens) || 1200;

  try {
    const contents = toGeminiContents(history, message);
    const text = await chatWithGemini(contents, maxTokens, key);
    return res.status(200).json({ text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[secretary/chat]', msg);
    const quota = isQuotaError(msg);
    return res.status(quota ? 429 : 500).json({
      error: quota ? 'quota_exceeded' : 'AI request failed',
      detail: msg,
    });
  }
}
