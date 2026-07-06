/**
 * POST /api/portal/proactive
 * Generates proactive AI guidance cards from rule-triggered signals.
 * Input: { triggers: ProactiveTrigger[], userName? }
 * Output: { ok, cards: ProactiveCard[] }
 *
 * Rule engine runs client-side → passes triggers here → Claude formats warm copy.
 * Falls back to rule-generated text if Claude unavailable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export interface ProactiveCard {
  id: string;
  title: string;
  body: string;
  confidence: number; // 0-100, reflects actual data backing
  sourceTags: string[]; // e.g. ['天气·降温', '健康·感冒记录']
  icon: string; // emoji
  priority: number; // higher = show first
}

interface ProactiveTriggerFallback {
  title: string;
  body: string;
  confidence: number;
  sourceTags: string[];
  icon: string;
  priority: number;
}

interface ProactiveTrigger {
  type: string;
  data: Record<string, string | number | boolean | null>;
  fallback: ProactiveTriggerFallback;
}

interface ProactiveRequest {
  triggers: ProactiveTrigger[];
  userName?: string;
}

async function callClaudeForCards(
  apiKey: string,
  triggers: ProactiveTrigger[],
  userName: string,
): Promise<ProactiveCard[]> {
  const triggerLines = triggers.map((t) => {
    const dataStr = Object.entries(t.data)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    return `[${t.type}] ${dataStr}`;
  }).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 600,
      system: `你是 Nesio，用户 ${userName || '婧'} 的贴身 AI 助手。
根据触发信号生成 1-2 条主动提醒卡片。规则：
- 中文，口吻温暖自然，不夸张
- 标题：8字内，有力
- 正文：1句话，说明为什么提醒 + 建议行动
- confidence：数据越确定越高（天气/日历=90+，记忆推断=70-85）
- sourceTags：数据来源，格式"类别·细节"，如"天气·降温"
- icon：1个emoji
- 不编造没有数据支撑的内容
只输出JSON数组：[{"id":"p1","title":"","body":"","confidence":85,"sourceTags":[],"icon":"","priority":1}]`,
      messages: [{
        role: 'user',
        content: `触发信号：\n${triggerLines}\n\n生成提醒卡片（JSON，最多2条）：`,
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

  return JSON.parse(match[0]) as ProactiveCard[];
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'proactive', { limit: 20 });
  if (guard) return guard;

  const body = await req.json() as ProactiveRequest;
  const { triggers = [], userName } = body;

  if (triggers.length === 0) {
    return NextResponse.json({ ok: true, cards: [] });
  }

  // Build fallback cards from rule triggers (used if Claude unavailable)
  const fallbackCards: ProactiveCard[] = triggers.slice(0, 2).map((t, i) => ({
    id: `p${i}`,
    ...t.fallback,
  }));

  const anthropicKey = envValue('ANTHROPIC_API_KEY') || envValue('CLAUDE_API_KEY');
  if (!anthropicKey) {
    return NextResponse.json({ ok: true, cards: fallbackCards });
  }

  try {
    const cards = await callClaudeForCards(anthropicKey, triggers, userName || '');
    return NextResponse.json({ ok: true, cards: cards.slice(0, 2) });
  } catch (err) {
    console.error('[proactive] Claude error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true, cards: fallbackCards });
  }
}
