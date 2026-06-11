import type { VercelRequest, VercelResponse } from '@vercel/node';

function getGoogleKey(): string | undefined {
  const raw =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY;
  return raw?.trim() || undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = getGoogleKey();
  const openai = process.env.OPENAI_API_KEY?.trim();
  const models = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite,gemini-2.5-flash,gemini-1.5-flash-8b';

  res.setHeader('Access-Control-Allow-Origin', '*');

  let aiStatus: 'ok' | 'quota' | 'error' | 'skipped' = 'skipped';
  let aiDetail = '';

  if (req.query?.probe === '1' && key) {
    const model = models.split(',')[0].trim();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: '回复：通' }] }],
          generationConfig: { maxOutputTokens: 8 },
        }),
      });
      const data = (await r.json()) as { candidates?: unknown[]; error?: { message?: string } };
      if (r.ok && data.candidates?.length) {
        aiStatus = 'ok';
      } else {
        const msg = data?.error?.message || `HTTP ${r.status}`;
        aiStatus = /quota|rate limit|429/i.test(msg) ? 'quota' : 'error';
        aiDetail = msg.slice(0, 200);
      }
    } catch (e) {
      aiStatus = 'error';
      aiDetail = e instanceof Error ? e.message : String(e);
    }
  }

  res.status(200).json({
    ok: true,
    gemini: !!key,
    openai: !!openai,
    model: models,
    aiStatus,
    aiDetail: aiDetail || undefined,
  });
}
