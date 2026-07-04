/**
 * POST /api/portal/chat
 * Nesio AI chat.
 * Primary backend: Anthropic Claude (claude-3-5-haiku-latest) — fast, cheap, reliable.
 * Fallback: Gemini 2.0 Flash (requires GEMINI_API_KEY with valid quota).
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildChatContext } from '@/lib/portal/chat-context';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { reportAiCall } from '@/lib/portal/ai-telemetry';

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
  /** Pre-built context strings from client (has localStorage + sessionStorage access) */
  memoryContext?: string;
  calendarContext?: string;
  environmentContext?: string;
}

const SYSTEM_BASE = `你是 Nesio，用户的贴身 AI 助手，叫"小宝"。
- 回答简洁有力，用中文
- 善用用户的个人记忆，自然地说"我记得你之前提到…"
- 如果用户问"我的XX在哪"，先在记忆库里找
- 如果提供了【实时环境】（位置/天气），直接用它回答"我在哪""天气怎么样"这类问题，不要再反问用户
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
      model: envValue('CLAUDE_MODEL') || envValue('ANTHROPIC_MODEL') || 'claude-3-5-haiku-latest',
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

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Same fallback order as analyze route — 429 on one model → try next
const GEMINI_MODEL_FALLBACKS = ['gemini-2.0-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];

async function callGemini(
  apiKey: string,
  message: string,
  history: ChatMessage[],
  systemInstruction: string,
): Promise<{ text: string; sources: Array<{ title: string; url: string }> }> {
  const configuredModel = envValue('GEMINI_MODEL');
  const models = Array.from(new Set([configuredModel, ...GEMINI_MODEL_FALLBACKS].filter(Boolean)));

  const contents = [
    ...history
      .filter((m) => m.text?.trim())
      .map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user' as const, parts: [{ text: message }] },
  ];

  let lastError = 'Gemini unavailable';

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
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

      if (res.ok) {
        const candidate = data.candidates?.[0];
        const text = (candidate?.content?.parts ?? [])
          .filter((p): p is { text: string } => typeof p.text === 'string' && p.text.length > 0)
          .map((p) => p.text)
          .join('');
        if (text) {
          const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
            .map((c) => ({ title: c.web?.title ?? '', url: c.web?.uri ?? '' }))
            .filter((s) => s.url)
            .slice(0, 3);
          return { text: text.trim(), sources };
        }
        lastError = `Gemini ${model} empty_response`;
        break;
      }

      // 429 rate limit: wait 2s and retry once before moving to next model
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      lastError = `Gemini ${model} ${res.status}${data.error?.message ? `: ${data.error.message}` : ''}`;
      console.error('[chat] gemini_model_error:', model, lastError);
      break;
    }
  }

  throw new Error(lastError);
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'chat', { limit: 20 });
  if (guard) return guard;

  const body = await req.json() as ChatRequest;
  const { message, history = [], coachStyle, fileContext, memoryContext, calendarContext, environmentContext } = body;

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

  const { systemContext } = buildChatContext(message, { memoryContext, calendarContext, environmentContext });
  const fileSection = fileContext
    ? `\n\n---\n用户上传了文件：${fileContext.name}\n文件内容如下：\n\n${fileContext.content}\n---\n\n回答关于这个文件的问题时，直接基于以上数据回答，不要猜测或编造数据。如果用户问数量统计、最大值、总结等，请计算后给出准确答案。`
    : '';
  const systemInstruction = `${buildSystemPersonality(coachStyle)}\n\n${systemContext}${fileSection}`;

  const startedAt = Date.now();
  try {
    const result = anthropicKey
      ? await callClaude(anthropicKey, message, history, systemInstruction)
      : await callGemini(geminiKey!, message, history, systemInstruction);

    reportAiCall('chat', true, startedAt, { provider: anthropicKey ? 'claude' : 'gemini' });
    return NextResponse.json({
      ok: true,
      response: result.text || '我理解你的问题，但暂时没有找到确定的答案。',
      sources: result.sources,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[chat] primary_error:', msg);

    const isAuthError = msg.includes('invalid x-api-key') || msg.includes('authentication_error') || msg.includes('401');

    // Claude 失败 → 尝试 Gemini 兜底（含 auth error 情况）
    if (geminiKey) {
      try {
        const result = await callGemini(geminiKey, message, history, systemInstruction);
        reportAiCall('chat', true, startedAt, { provider: 'gemini_fallback' });
        return NextResponse.json({
          ok: true,
          response: result.text || '我理解你的问题，但暂时没有找到确定的答案。',
          sources: result.sources,
        });
      } catch (fallbackErr) {
        const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.error('[chat] gemini_fallback_error:', fallbackMsg);
        const isQuotaError = fallbackMsg.includes('quota') || fallbackMsg.includes('429');
        if (isQuotaError) {
          return NextResponse.json({
            ok: true,
            response: '（AI 暂时达到免费用量上限，请为 Gemini API 开通付费，或配置 ANTHROPIC_API_KEY）',
            sources: [],
          });
        }
      }
    }

    reportAiCall('chat', false, startedAt, { error: isAuthError ? 'auth' : 'provider' });
    if (isAuthError) {
      return NextResponse.json({
        ok: true,
        response: '（Anthropic API Key 配置有误，请到 Vercel 环境变量重新设置 ANTHROPIC_API_KEY）',
        sources: [],
      });
    }

    return NextResponse.json({ ok: true, response: '（AI 暂时不可用，请稍后再试）', sources: [] });
  }
}
