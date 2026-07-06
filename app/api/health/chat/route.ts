import { NextRequest, NextResponse } from 'next/server';
import { geminiGenerate, getGoogleKey, HEALTH_AI_SYSTEM } from '@/lib/health/gemini';
import { guardAiRoute } from '@/lib/portal/api-auth';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type ChatTurn = { role: 'user' | 'assistant'; content: string };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export const maxDuration = 30;
export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'health_chat', { limit: 20, allowCrossOrigin: true });
  if (guard) return guard;

  if (!getGoogleKey()) {
    return NextResponse.json(
      { error: 'AI not configured', hint: 'Set GEMINI_API_KEY on Vercel' },
      { status: 503, headers: cors }
    );
  }

  const body = await req.json().catch(() => ({}));
  const message = String(body.message || '').trim();
  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400, headers: cors });
  }

  const history: ChatTurn[] = Array.isArray(body.history)
    ? body.history
        .filter((t: ChatTurn) => t && (t.role === 'user' || t.role === 'assistant') && t.content)
        .slice(-10)
    : [];

  const context = body.context ? JSON.stringify(body.context, null, 2) : '';
  const transcript = history.map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.content}`).join('\n');
  const userText = [
    context ? `【用户健康摘要】\n${context}\n` : '',
    transcript ? `【对话历史】\n${transcript}\n` : '',
    `【本轮问题】\n${message}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const text = await geminiGenerate({
      system: HEALTH_AI_SYSTEM,
      userParts: [{ text: userText }],
      maxTokens: 900,
      temperature: 0.65,
    });
    return NextResponse.json({ ok: true, text }, { headers: cors });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'AI request failed', detail }, { status: 500, headers: cors });
  }
}
