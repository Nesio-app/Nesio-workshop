import { NextResponse } from 'next/server';
import { launchUnavailablePayload } from '@/lib/portal/launch-safety';

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

export async function GET() {
  return NextResponse.json(
    {
      ...launchUnavailablePayload('api:secretary:health', 'secretary'),
      service: 'secretary',
      gemini: false,
      doubao: false,
      chatgpt: false,
      model: null,
      doubaoModel: null,
      openaiModel: null,
    },
    {
      status: 403,
      headers: { 'Access-Control-Allow-Origin': '*' },
    }
  );
}
