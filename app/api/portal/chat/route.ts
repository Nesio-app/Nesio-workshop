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
  coachStyle?: string;
  fileContext?: { name: string; content: string };
}

const SYSTEM_BASE = `你是 Nesio，用户的贴身 AI 助手，叫"小宝"。
- 回答简洁有力，用中文
- 善用用户的个人记忆，自然地说"我记得你之前提到…"
- 如果用户问"我的XX在哪"，先在记忆库里找
- 不编造用户没有记录的事实，不确定就直说`;

const TONE_STYLE: Record<string, string> = {
  warm: '语气温暖，像老朋友聊天，不过分正式，偶尔幽默但不刻意卖萌。',
  direct: '说话直接简短，给结论不废话，不用客套开场，直接说答案。',
  minimal: '极简风格。回答越短越好，用最少的字说清楚，省去所有过渡语。',
};

function buildSystemPersonality(coachStyle?: string): string {
  const tone = TONE_STYLE[coachStyle ?? 'warm'] ?? TONE_STYLE.warm;
  return `${SYSTEM_BASE}\n- ${tone}`;
}

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
  // gemini-1.5-flash 已退役（404），使用 2.0-flash
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
  const { message, history = [], coachStyle, fileContext } = body;

  if (!message?.trim()) {
    return NextResponse.json({ ok: false, error: 'empty message' }, { status: 400 });
  }

  // Accept both ANTHROPIC_API_KEY and CLAUDE_API_KEY as aliases
  const anthropicKey = envValue('ANTHROPIC_API_KEY') || envValue('CLAUDE_API_KEY');
  // 同时接受两种命名方式
  const geminiKey = envValue('GEMINI_API_KEY') || envValue('GOOGLE_GENERATIVE_AI_API_KEY');

  if (!anthropicKey && !geminiKey) {
    return NextResponse.json({
      ok: true, response: '（AI 暂时不可用，请配置 ANTHROPIC_API_KEY 或 GEMINI_API_KEY）', sources: [],
    });
  }

  const { systemContext } = buildChatContext(message);
  const fileSection = fileContext
    ? `\n\n---\n用户上传了文件：${fileContext.name}\n文件内容如下：\n\n${fileContext.content}\n---\n\n回答关于这个文件的问题时，直接基于以上数据回答，不要猜测或编造数据。如果用户问数量统计、最大值、总结等，请计算后给出准确答案。`
    : '';
  const systemInstruction = `${buildSystemPersonality(coachStyle)}\n\n${systemContext}${fileSection}`;

  console.log('[chat] keys_present:', { anthropic: !!anthropicKey, gemini: !!geminiKey });
  try {
    const result = anthropicKey
      ? await callClaude(anthropicKey, message, history, systemInstruction)
      : await callGemini(geminiKey!, message, history, systemInstruction);

    return NextResponse.json({
      ok: true,
      response: result.text || '我理解你的问题，但暂时没有找到确定的答案。',
      sources: result.sources,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[chat] primary_error:', msg);

    // Claude 失败 → 尝试 Gemini 兜底
    let fallbackMsg = '';
    if (anthropicKey && geminiKey) {
      try {
        const result = await callGemini(geminiKey, message, history, systemInstruction);
        return NextResponse.json({
          ok: true,
          response: result.text || '我理解你的问题，但暂时没有找到确定的答案。',
          sources: result.sources,
        });
      } catch (fallbackErr) {
        fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.error('[chat] gemini_fallback_error:', fallbackMsg);
      }
    }

    // 把错误原因带回来，方便排查（截短避免泄露密钥）
    const debugHint = process.env.NODE_ENV !== 'production'
      ? ` [claude:${msg.slice(0, 80)}] [gemini:${fallbackMsg.slice(0, 80)}]`
      : '';
    return NextResponse.json({ ok: true, response: `出了点问题，请稍后再试。${debugHint}`, sources: [], _claudeErr: msg.slice(0, 120), _geminiErr: fallbackMsg.slice(0, 120) });
  }
}
