/**
 * POST /api/portal/life-state
 * Generates a natural-language explanation of the user's current Life State.
 * Input: the rule-computed dimensions + risks + drivers (already aggregated
 * client-side from Signals — only a summary is sent, never raw private data).
 * Output: { explanation } — a warm, personal-assistant reading of the state.
 *
 * PRD 26.4: "DEC should only pass necessary summaries and Evidence references
 * to AI, not all Signals." We send dimension levels + short notes, nothing raw.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

interface LifeStateRequest {
  displayName?: string;
  dimensions: Array<{ dimension: string; label: string; level: string; note?: string }>;
  risks: string[];
  opportunities: string[];
  timeWindow?: string;
}

function fallbackExplanation(body: Partial<LifeStateRequest>): string {
  const risks = body.risks || [];
  const opportunities = body.opportunities || [];
  if (risks.length > 0) return `我看到今天有些负荷，先把最重要的一件事放到前面就好。`;
  if (opportunities.length > 0) return `今天有几个状态不错的信号，可以顺势做一件轻一点的事。`;
  return `还没有足够稳定的状态信号。告诉 Nesio 一件事，我会慢慢更懂你。`;
}

export async function POST(req: NextRequest) {
  const guard = guardAiRoute(req, 'life_state', { limit: 15 });
  if (guard) return guard;

  const body = await req.json() as LifeStateRequest;
  const { displayName, dimensions, risks, opportunities } = body;

  const geminiKey = envValue('GEMINI_API_KEY') || envValue('GOOGLE_GENERATIVE_AI_API_KEY');
  if (!geminiKey || !dimensions?.length) {
    return NextResponse.json({
      ok: true,
      provider: 'fallback',
      fallback: true,
      explanation: fallbackExplanation(body),
      reason: geminiKey ? 'no_life_state_data' : 'provider_not_configured',
    });
  }

  const dimText = dimensions
    .map((d) => `${d.label}：${d.level}${d.note ? '（' + d.note + '）' : ''}`)
    .join('；');

  const prompt = `你是 Nesio，一个熟悉用户的私人助理。根据下面对用户当前生活状态的结构化理解，用一两句温暖、具体、不说教的话，帮 ${displayName || '用户'} 理解此刻的状态，并给一个轻量的建议方向。

各维度状态：${dimText}
${risks?.length ? '需要留意：' + risks.join('；') : ''}
${opportunities?.length ? '状态不错：' + opportunities.join('；') : ''}

要求：
- 不超过 45 字
- 用"你"，不用"您"
- 像朋友说话，不机械列举维度
- 如果有风险，温和点出并给方向；如果整体不错，给肯定
- 只输出这一两句话，不要任何前缀或解释`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) {
      return NextResponse.json({
        ok: true,
        provider: 'fallback',
        fallback: true,
        explanation: fallbackExplanation(body),
        reason: `provider_status_${res.status}`,
      });
    }
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const explanation = (data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '').trim();
    if (!explanation) {
      return NextResponse.json({
        ok: true,
        provider: 'fallback',
        fallback: true,
        explanation: fallbackExplanation(body),
        reason: 'provider_empty_response',
      });
    }
    return NextResponse.json({ ok: true, provider: 'gemini', fallback: false, explanation });
  } catch (err) {
    return NextResponse.json({
      ok: true,
      provider: 'fallback',
      fallback: true,
      explanation: fallbackExplanation(body),
      reason: err instanceof Error ? err.message : 'provider_failed',
    });
  }
}
