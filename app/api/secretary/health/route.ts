import { NextResponse } from 'next/server';

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
    process.env.DOUBAO_API_KEY ||
    process.env.ARK_API_KEY ||
    process.env.VOLCENGINE_API_KEY;
  return raw?.trim() || undefined;
}

export async function GET() {
  const geminiKey = getGoogleKey();
  const doubaoKey = getDoubaoKey();
  return NextResponse.json(
    {
      ok: true,
      service: 'secretary',
      gemini: !!geminiKey,
      doubao: !!doubaoKey,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite,gemini-2.5-flash',
      doubaoModel: process.env.DOUBAO_ENDPOINT || process.env.DOUBAO_MODEL || 'doubao-pro-32k',
    },
    {
      headers: { 'Access-Control-Allow-Origin': '*' },
    }
  );
}
