/**
 * POST /api/portal/tts
 * Text-to-speech using OpenAI TTS API.
 * Returns audio/mpeg stream.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';

function getOpenAIKey(): string {
  return (process.env.OpenAI_KEY || process.env.OPENAI_API_KEY || '').trim();
}

export async function POST(req: NextRequest) {
  const guard = guardAiRoute(req, 'tts', { limit: 10 });
  if (guard) return guard;

  const { text, voice = 'nova', speed = 1.0 } = await req.json() as {
    text: string;
    voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
    speed?: number;
  };

  if (!text?.trim()) {
    return NextResponse.json({ ok: false, error: 'empty_text' }, { status: 400 });
  }

  const key = getOpenAIKey();
  if (!key) {
    return NextResponse.json({ ok: false, error: 'real_voice_not_configured' }, { status: 503 });
  }

  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: text.slice(0, 4096),
        voice,
        speed: Math.max(0.25, Math.min(4.0, speed)),
        response_format: 'mp3',
      }),
    });

    if (!res.ok) {
      await res.text(); // consume body; don't forward upstream error to client
      return NextResponse.json({ ok: false, error: 'tts_unavailable' }, { status: res.status });
    }

    const audioBuffer = await res.arrayBuffer();
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'tts_failed' },
      { status: 500 },
    );
  }
}
