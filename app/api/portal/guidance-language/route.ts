/**
 * POST /api/portal/guidance-language
 *
 * AI Language Generation layer (Layer 7 of Future Guidance Engine).
 * Receives rule-filtered GuidanceCard[] with hardcoded copy, returns cards
 * with AI-generated natural Chinese language.
 *
 * Architecture: rule engine runs client-side (fast, deterministic) →
 * passes structured candidates here → Claude rewrites title/body only.
 * All filtering and prioritization has already happened upstream.
 *
 * Falls back to the original rule-generated copy if Claude is unavailable.
 *
 * Research basis: TGL paper (2025) — trigger decisions don't need LLM;
 * AI only invoked after trigger fires. See docs/research/proactive-ai-systems-2025.md §4
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';

interface CardInput {
  id: string;
  type: string;
  icon: string;
  title: string;    // rule-generated fallback
  body: string;     // rule-generated fallback
  priority: number;
  action: { label: string; cta: string; actionType: string };
  expiresAt?: string;
  nodeId?: string;
}

interface CardOutput extends CardInput {
  aiEnhanced: boolean;
}

interface LanguageRequest {
  cards: CardInput[];
  userName?: string;
}

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

async function enhanceWithClaude(
  apiKey: string,
  cards: CardInput[],
  userName: string,
): Promise<CardOutput[]> {
  const cardDescriptions = cards.map((c, i) =>
    `Card ${i + 1} [${c.type}]:\n  原标题: ${c.title}\n  原正文: ${c.body}\n  推荐动作: ${c.action.label}`,
  ).join('\n\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 400,
      system: `你是 Nesio，${userName || '用户'}的贴身 AI 助手。
你的任务是把系统生成的引导卡片语言改写成更自然、温和、具体的中文。

规则：
- 标题：≤12字，有力，不焦虑
- 正文：1句话，说明为什么现在做 + 具体动作
- 不解释规则，不展示评分，不制造压力
- 语气：朋友提醒，不是系统命令
- 不改变核心信息和推荐动作

只输出 JSON 数组，格式：[{"title":"","body":""}]
数量必须和输入卡片完全相同。`,
      messages: [{
        role: 'user',
        content: `请改写以下引导卡片的标题和正文：\n\n${cardDescriptions}\n\n输出 JSON 数组（${cards.length} 条）：`,
      }],
    }),
  });

  if (!res.ok) throw new Error(`Claude ${res.status}`);

  const data = await res.json() as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);

  const raw = (data.content ?? []).find((c) => c.type === 'text')?.text ?? '';
  const match = raw.match(/\[[\s\S]*?\]/);
  if (!match) throw new Error('no JSON array in response');

  const enhanced = JSON.parse(match[0]) as Array<{ title: string; body: string }>;
  if (!Array.isArray(enhanced) || enhanced.length !== cards.length) {
    throw new Error('response length mismatch');
  }

  return cards.map((card, i) => ({
    ...card,
    title: enhanced[i]?.title?.trim() || card.title,
    body: enhanced[i]?.body?.trim() || card.body,
    aiEnhanced: true,
  }));
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'guidance_language', { limit: 20 });
  if (guard) return guard;

  const body = await req.json() as LanguageRequest;
  const { cards = [], userName } = body;

  if (cards.length === 0) {
    return NextResponse.json({ ok: true, cards: [] });
  }

  // Always prepare fallback (rule-generated copy)
  const fallback: CardOutput[] = cards.map((c) => ({ ...c, aiEnhanced: false }));

  const anthropicKey = envValue('ANTHROPIC_API_KEY') || envValue('CLAUDE_API_KEY');
  if (!anthropicKey) {
    return NextResponse.json({ ok: true, cards: fallback });
  }

  try {
    const enhanced = await enhanceWithClaude(anthropicKey, cards, userName ?? '');
    return NextResponse.json({ ok: true, cards: enhanced });
  } catch (err) {
    console.error('[guidance-language] Claude error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true, cards: fallback });
  }
}
