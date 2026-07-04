import { NextRequest, NextResponse } from 'next/server';
import { geminiGenerate, getGoogleKey } from '@/lib/health/gemini';
import { guardAiRoute } from '@/lib/portal/api-auth';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYSTEM = `你是「溯 SÙ」健康叙事助手。根据用户提供的紧凑统计摘要（非原始时序），用中文写温暖、具体、克制的身体故事。
规则：不诊断、不开药、不说教；引用数据时带数字；承认相关非因果；篇幅 120–200 字。`;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(req: NextRequest) {
  const guard = guardAiRoute(req, 'health_narrative', { limit: 15, allowCrossOrigin: true });
  if (guard) return guard;

  if (!getGoogleKey()) {
    return NextResponse.json({ error: 'Narrative API not configured', fallback: true }, { status: 503, headers: cors });
  }

  const body = await req.json().catch(() => ({}));
  const kind = body.kind || 'daily';
  const summary = body.summary || {};
  const userPrompt = `报告类型：${kind}\n统计摘要 JSON：\n${JSON.stringify(summary, null, 2)}`;

  try {
    const narrative = await geminiGenerate({
      system: SYSTEM,
      userParts: [{ text: userPrompt }],
      maxTokens: 600,
      temperature: 0.7,
    });
    return NextResponse.json({ ok: true, kind, narrative }, { headers: cors });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Narrative failed', detail }, { status: 500, headers: cors });
  }
}
