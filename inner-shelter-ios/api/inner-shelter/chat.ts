import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

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

async function chatWithGeminiREST(system: string, user: string, key: string): Promise<string> {
  const models = (process.env.GEMINI_MODEL || 'gemini-2.0-flash,gemini-1.5-flash,gemini-2.5-flash')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  let lastErr = 'No models tried';

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: 1000, temperature: 0.7 },
      }),
    });

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string; status?: string };
    };

    if (!res.ok) {
      lastErr = data?.error?.message || `HTTP ${res.status} for ${model}`;
      continue;
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text) return text;
    lastErr = `Empty response from ${model}`;
  }

  throw new Error(lastErr);
}

async function chatWithOpenAI(system: string, user: string, key: string): Promise<string> {
  const openai = new OpenAI({ apiKey: key });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 1000,
  });
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty OpenAI response');
  return text;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const googleKey = getGoogleKey();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (!googleKey && !openaiKey) {
    return res.status(503).json({
      error: 'AI not configured',
      hint: 'Set GEMINI_API_KEY in Vercel Environment Variables, then Redeploy',
    });
  }

  const { system, user } = req.body || {};
  if (!system || !user) {
    return res.status(400).json({ error: 'Missing system or user message' });
  }

  try {
    const text = googleKey
      ? await chatWithGeminiREST(String(system), String(user), googleKey)
      : await chatWithOpenAI(String(system), String(user), openaiKey!);
    return res.status(200).json({ text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[inner-shelter/chat]', msg);
    return res.status(500).json({
      error: 'AI request failed',
      detail: msg,
      hint: googleKey
        ? 'Check GEMINI_API_KEY at aistudio.google.com/apikey — recreate key if needed, then Redeploy'
        : 'Check OPENAI_API_KEY',
    });
  }
}
