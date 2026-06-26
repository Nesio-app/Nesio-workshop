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

export async function POST(req: NextRequest) {
  const body = await req.json() as LifeStateRequest;
  const { displayName, dimensions, risks, opportunities } = body;

  const geminiKey = envValue('GEMINI_API_KEY') || envValue('GOOGLE_GENERATIVE_AI_API_KEY');
  if (!geminiKey || !dimensions?.length) {
    return NextResponse.json({ ok: false, error: 'no_key_or_data' }, { status: geminiKey ? 400 : 503 });
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
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const explanation = (data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '').trim();
    if (!explanation) return NextResponse.json({ ok: false, error: 'empty' }, { status: 502 });
    return NextResponse.json({ ok: true, explanation });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
