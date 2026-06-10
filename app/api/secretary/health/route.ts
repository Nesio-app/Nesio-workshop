import { NextResponse } from 'next/server';

function getGoogleKey(): string | undefined {
  const raw =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY;
  return raw?.trim() || undefined;
}

export async function GET() {
  const key = getGoogleKey();
  return NextResponse.json(
    {
      ok: true,
      service: 'secretary',
      gemini: !!key,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite,gemini-2.5-flash',
    },
    {
      headers: { 'Access-Control-Allow-Origin': '*' },
    }
  );
}
