import type { VercelRequest, VercelResponse } from '@vercel/node';

function getGoogleKey(): string | undefined {
  const raw =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY;
  return raw?.trim() || undefined;
}

function getInnerShelterApiUrl(): string {
  return (
    process.env.INNER_SHELTER_API_URL?.trim() || 'https://inner-shelter-ios.vercel.app'
  ).replace(/\/$/, '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = getGoogleKey();
  const proxyUrl = getInnerShelterApiUrl();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    ok: true,
    app: 'adhd-flow-planner',
    gemini: !!key || !!proxyUrl,
    geminiDirect: !!key,
    geminiProxy: !key && !!proxyUrl,
    proxy: proxyUrl,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite,gemini-2.5-flash',
  });
}
