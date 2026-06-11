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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    ok: true,
    app: 'adhd-flow-planner',
    gemini: !!key,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite,gemini-2.5-flash',
  });
}
