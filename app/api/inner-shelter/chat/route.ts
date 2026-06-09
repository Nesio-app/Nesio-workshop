import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
      error?: { message?: string };
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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  const googleKey = getGoogleKey();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (!googleKey && !openaiKey) {
    return NextResponse.json(
      { error: 'AI not configured', hint: 'Set GEMINI_API_KEY' },
      { status: 503, headers: corsHeaders }
    );
  }

  let body: { system?: string; user?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders });
  }

  const { system, user } = body;
  if (!system || !user) {
    return NextResponse.json({ error: 'Missing system or user message' }, { status: 400, headers: corsHeaders });
  }

  try {
    const text = googleKey
      ? await chatWithGeminiREST(system, user, googleKey)
      : await chatWithOpenAI(system, user, openaiKey!);
    return NextResponse.json({ text }, { headers: corsHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[inner-shelter/chat]', msg);
    return NextResponse.json(
      { error: 'AI request failed', detail: msg },
      { status: 500, headers: corsHeaders }
    );
  }
}
