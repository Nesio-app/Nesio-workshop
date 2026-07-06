import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import {
  CHECKUP_ANALYZE_SYSTEM,
  FOOD_ANALYZE_SYSTEM,
  INSIGHT_SYSTEM,
  geminiGenerate,
  getGoogleKey,
  parseJsonFromText,
} from '@/lib/health/gemini';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export const maxDuration = 30;
export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'health_analyze', { limit: 20, allowCrossOrigin: true });
  if (guard) return guard;

  if (!getGoogleKey()) {
    return NextResponse.json(
      { error: 'AI not configured', hint: 'Set GEMINI_API_KEY on Vercel' },
      { status: 503, headers: cors }
    );
  }

  const body = await req.json().catch(() => ({}));
  const kind = String(body.kind || 'insight');

  try {
    if (kind === 'food') {
      const image = String(body.image || '');
      const mimeType = String(body.mimeType || 'image/jpeg');
      if (!image) {
        return NextResponse.json({ error: 'image required' }, { status: 400, headers: cors });
      }
      if (image.length > 4_500_000) {
        return NextResponse.json({ error: 'image too large' }, { status: 413, headers: cors });
      }
      const text = await geminiGenerate({
        system: FOOD_ANALYZE_SYSTEM,
        userParts: [
          { text: '识别这餐食物，估计碳水与对血糖的影响。' },
          { inline_data: { mime_type: mimeType, data: image } },
        ],
        maxTokens: 600,
        temperature: 0.2,
      });
      const data = parseJsonFromText(text);
      return NextResponse.json({ ok: true, kind, ...data }, { headers: cors });
    }

    if (kind === 'checkup') {
      const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];
      if (body.image) {
        parts.push({ text: '解读这份体检报告：' });
        parts.push({
          inline_data: {
            mime_type: String(body.mimeType || 'image/jpeg'),
            data: String(body.image),
          },
        });
      } else {
        parts.push({ text: `解读以下体检文字摘要：\n${String(body.text || '')}` });
      }
      const text = await geminiGenerate({
        system: CHECKUP_ANALYZE_SYSTEM,
        userParts: parts,
        maxTokens: 800,
        temperature: 0.25,
      });
      const data = parseJsonFromText(text);
      return NextResponse.json({ ok: true, kind, ...data }, { headers: cors });
    }

    if (kind === 'insight') {
      const summary = body.summary || {};
      const text = await geminiGenerate({
        system: INSIGHT_SYSTEM,
        userParts: [{ text: JSON.stringify(summary, null, 2) }],
        maxTokens: 280,
        temperature: 0.55,
      });
      return NextResponse.json({ ok: true, kind, insight: text }, { headers: cors });
    }

    return NextResponse.json({ error: 'unknown kind' }, { status: 400, headers: cors });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'analyze failed', detail }, { status: 500, headers: cors });
  }
}
