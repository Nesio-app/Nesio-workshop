import type { VercelRequest, VercelResponse } from '@vercel/node';

const DEFAULT_MODELS = 'gemini-2.5-flash-lite,gemini-2.5-flash,gemini-1.5-flash-8b';

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

async function generateWithModel(
  model: string,
  prompt: string,
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
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: Math.min(Math.max(maxTokens, 64), 4096),
          temperature: 0.7,
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

async function chatWithGemini(prompt: string, maxTokens: number, key: string): Promise<string> {
  const models = (process.env.GEMINI_MODEL || DEFAULT_MODELS)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  let lastErr = 'No models tried';
  for (const model of models) {
    try {
      return await generateWithModel(model, prompt, maxTokens, key);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (!isQuotaError(lastErr)) continue;
    }
  }
  throw new Error(lastErr);
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

  const { prompt, maxTokens = 1000 } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt required' });
  }

  try {
    const text = await chatWithGemini(String(prompt), Number(maxTokens) || 1000, key);
    return res.status(200).json({ text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[adhd-flow/chat]', msg);
    const quota = isQuotaError(msg);
    return res.status(quota ? 429 : 500).json({
      error: quota ? 'quota_exceeded' : 'AI request failed',
      detail: msg,
    });
  }
}
