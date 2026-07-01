/**
 * POST /api/portal/chat
 * Nesio AI chat.
 * Primary backend: Anthropic Claude (claude-haiku-4-5-20251001) — fast, cheap, reliable.
 * Fallback: Gemini 2.0 Flash (requires GEMINI_API_KEY with valid quota).
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildChatContext } from '@/lib/portal/chat-context';

export const dynamic = 'force-dynamic';

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

const SYSTEM_PERSONALITY = `你是 Nesio，用户的贴身 AI 助手，叫"小宝"。
- 温暖真实，像老朋友说话，不过分正式
- 回答简洁有力，用中文
- 善用用户的个人记忆，自然地说"我记得你之前提到…"
- 如果用户问"我的XX在哪"，先在记忆库里找
- 不编造用户没有记录的事实，不确定就直说
- 偶尔幽默，但不刻意卖萌`;

// ── Anthropic (Claude) ────────────────────────────────────────────────────────

async function callClaude(
  apiKey: string,
  message: string,
  history: ChatMessage[],
  systemInstruction: string,
): Promise<{ text: string; sources: Array<{ title: string; url: string }> }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemInstruction,
      messages: [
        ...history
          .filter((m) => m.text?.trim())
          .map((m) => ({
            role: m.role === 'model' ? 'assistant' : 'user' as 'user' | 'assistant',
            content: m.text,
          })),
        { role: 'user' as const, content: message },
      ],
    }),
  });

  const data = await res.json() as {
    content?: Array<{ type: string; text?: string }>;
    error?: { type: string; message: string };
  };

  if (data.error) throw new Error(`Anthropic: ${data.error.message}`);

  const text = (data.content ?? [])
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
    .join('');

  return { text: text.trim(), sources: [] };
}

// ── Gemini ────────────────────────────────────────────────────────────────────

async function callGemini(
  apiKey: string,
  message: string,
  history: ChatMessage[],
  systemInstruction: string,
): Promise<{ text: string; sources: Array<{ title: string; url: string }> }> {
  const GEMINI_URL =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

  const contents = [
    ...history
      .filter((m) => m.text?.trim())
      .map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user' as const, parts: [{ text: message }] },
  ];

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    }),
  });

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
    }>;
    error?: { code?: number; message?: string; status?: string };
  };

  if (data.error) throw new Error(`Gemini ${data.error.code}: ${data.error.message}`);

  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((p): p is { text: string } => typeof p.text === 'string' && p.text.length > 0)
    .map((p) => p.text)
    .join('');

  const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
    .map((c) => ({ title: c.web?.title ?? '', url: c.web?.uri ?? '' }))
    .filter((s) => s.url)
    .slice(0, 3);

  return { text: text.trim(), sources };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json() as ChatRequest;
  const { message, history = [] } = body;

  if (!message?.trim()) {
    return NextResponse.json({ ok: false, error: 'empty message' }, { status: 400 });
  }

  const anthropicKey = envValue('ANTHROPIC_API_KEY');
  const geminiKey = envValue('GEMINI_API_KEY');

  if (!anthropicKey && !geminiKey) {
    return NextResponse.json({
      ok: true, response: '（AI 暂时不可用，请配置 ANTHROPIC_API_KEY 或 GEMINI_API_KEY）', sources: [],
    });
  }

  const { systemContext } = buildChatContext(message);
  const systemInstruction = `${SYSTEM_PERSONALITY}\n\n${systemContext}`;

  try {
    const result = anthropicKey
      ? await callClaude(anthropicKey, message, history, systemInstruction)
      : await callGemini(geminiKey, message, history, systemInstruction);

    return NextResponse.json({
      ok: true,
      response: result.text || '我理解你的问题，但暂时没有找到确定的答案。',
      sources: result.sources,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[chat] error:', msg);

    // Try Gemini as fallback if Claude failed
    if (anthropicKey && geminiKey) {
      try {
        const { systemContext } = buildChatContext(message);
        const systemInstr = `${SYSTEM_PERSONALITY}\n\n${systemContext}`;
        const result = await callGemini(geminiKey, message, history, systemInstr);
        return NextResponse.json({
          ok: true,
          response: result.text || '我理解你的问题，但暂时没有找到确定的答案。',
          sources: result.sources,
        });
      } catch (fallbackErr) {
        console.error('[chat] fallback error:', fallbackErr);
      }
    }

    return NextResponse.json({ ok: true, response: '出了点问题，请稍后再试。', sources: [] });
  }
}
