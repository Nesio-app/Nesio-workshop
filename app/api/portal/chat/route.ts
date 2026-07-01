/**
 * POST /api/portal/chat
 * Nesio AI chat — Gemini 2.0 Flash with:
 *   • Google Search grounding (web queries)
 *   • LifeGraph context (personal memory)
 *   • Personality system prompt
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildChatContext } from '@/lib/portal/chat-context';

export const dynamic = 'force-dynamic';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  personalityId?: string;
}

const PERSONALITIES: Record<string, string> = {
  'warm-friend': `你是 Nesio，用户的贴身 AI 助手，叫"小宝"。
性格特点：
- 温暖真实，像老朋友说话，不过分正式不客套
- 回答简洁有力，避免啰嗦，用中文
- 善用用户的个人记忆来提供个性化回答，自然地说"我记得你之前提到…"
- 可以联网查到最新信息，但优先结合用户自己的数据
- 如果用户问"我的XX在哪/是什么"，先在记忆库里找
- 不编造用户没有记录的事实，不确定就直说
- 偶尔有一点幽默，但不刻意卖萌`,
};

interface GeminiPart { text?: string }
interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
  groundingMetadata?: {
    webSearchQueries?: string[];
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
  };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

export async function POST(req: NextRequest) {
  const body = await req.json() as ChatRequest;
  const { message, history = [], personalityId = 'warm-friend' } = body;

  if (!message?.trim()) {
    return NextResponse.json({ ok: false, error: 'empty message' }, { status: 400 });
  }

  const apiKey = envValue('GEMINI_API_KEY');
  if (!apiKey) {
    return NextResponse.json({
      ok: true,
      response: '（AI 暂时不可用，请检查 API Key 配置）',
      sources: [],
    });
  }

  const { systemContext } = buildChatContext(message);
  const personality = PERSONALITIES[personalityId] ?? PERSONALITIES['warm-friend'];
  const systemInstruction = `${personality}\n\n${systemContext}`;

  // Convert history to Gemini format — skip empty texts
  const contents = [
    ...history
      .filter((m) => m.text?.trim())
      .map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user' as const, parts: [{ text: message }] },
  ];

  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        // google_search is correct tool name for Gemini 2.0 grounding
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      }),
    });

    const data = await res.json() as GeminiResponse;

    // Gemini API error (e.g. invalid key, quota, bad request)
    if (data.error) {
      console.error('[chat] Gemini API error:', data.error);
      return NextResponse.json({
        ok: true,
        response: `AI 暂时无法回答（${data.error.message ?? data.error.status ?? String(data.error.code)}）`,
        sources: [],
      });
    }

    // Safety block
    if (data.promptFeedback?.blockReason) {
      console.warn('[chat] prompt blocked:', data.promptFeedback.blockReason);
      return NextResponse.json({ ok: true, response: '这个问题暂时没办法回答。', sources: [] });
    }

    if (!res.ok) {
      console.error('[chat] non-ok HTTP status:', res.status);
      return NextResponse.json({ ok: true, response: '服务暂时不可用，稍后再试。', sources: [] });
    }

    const candidate = data.candidates?.[0];

    // Extract text from all text parts
    const text = (candidate?.content?.parts ?? [])
      .filter((p): p is GeminiPart & { text: string } => typeof p.text === 'string' && p.text.length > 0)
      .map((p) => p.text)
      .join('');

    if (!text) {
      console.warn('[chat] empty response. finishReason:', candidate?.finishReason,
        'parts:', JSON.stringify(candidate?.content?.parts ?? []));
    }

    // Web sources from grounding
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const sources = chunks
      .map((c) => ({ title: c.web?.title ?? '', url: c.web?.uri ?? '' }))
      .filter((s) => s.url)
      .slice(0, 3);

    return NextResponse.json({
      ok: true,
      response: text.trim() || '我理解你的问题，但暂时没有找到确定的答案。',
      sources,
    });
  } catch (err) {
    console.error('[chat] fetch error:', err);
    return NextResponse.json({ ok: true, response: '出了点问题，稍后再试。', sources: [] });
  }
}
