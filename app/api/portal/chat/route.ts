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

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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
- 温暖真实，像老朋友说话，不过正式不客套
- 回答简洁有力，避免啰嗦，用中文
- 善用用户的个人记忆来提供个性化回答，自然地说"我记得你之前提到…"
- 可以联网查到最新信息，但优先结合用户自己的数据
- 如果用户问"我的XX在哪/是什么"，先在记忆库里找
- 不编造用户没有记录的事实，不确定就直说
- 偶尔有一点幽默，但不刻意卖萌`,
};

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

  // Build LifeGraph context for this query
  const { systemContext } = buildChatContext(message);
  const personality = PERSONALITIES[personalityId] ?? PERSONALITIES['warm-friend'];

  const systemInstruction = `${personality}

${systemContext}`;

  // Convert history to Gemini format
  const contents = [
    ...history.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    })),
    { role: 'user' as const, parts: [{ text: message }] },
  ];

  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        tools: [{ googleSearch: {} }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      }),
    });

    const data = await res.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: {
          webSearchQueries?: string[];
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        };
      }>;
    };

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

    // Extract web sources if search was used
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const sources = chunks
      .map((c) => ({ title: c.web?.title ?? '', url: c.web?.uri ?? '' }))
      .filter((s) => s.url)
      .slice(0, 3);

    return NextResponse.json({ ok: true, response: text.trim(), sources });
  } catch (err) {
    console.error('[chat] error:', err);
    return NextResponse.json({ ok: true, response: '出了点问题，稍后再试。', sources: [] });
  }
}
