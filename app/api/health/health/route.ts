import { NextResponse } from 'next/server';
import { getGoogleKey, getModelList } from '@/lib/health/gemini';

export async function GET() {
  const key = getGoogleKey();
  return NextResponse.json({
    ok: true,
    app: 'su-health',
    provider: key ? 'gemini' : 'none',
    narrative: !!key,
    chat: !!key,
    analyze: !!key,
    model: getModelList()[0] || 'gemini-2.5-flash-lite',
  });
}
