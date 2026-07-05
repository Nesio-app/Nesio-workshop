/**
 * POST /api/portal/plaid/exchange — public_token 换 access_token(批次 21)。
 * access_token 存 httpOnly cookie(半年),交易同步游标随连接重置。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { plaidBase } from '../link-token/route';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'plaid', { limit: 10 });
  if (guard) return guard;

  const { publicToken } = await req.json().catch(() => ({})) as { publicToken?: string };
  if (!publicToken) {
    return NextResponse.json({ ok: false, error: 'missing_public_token' }, { status: 400 });
  }

  try {
    const res = await fetch(`${plaidBase()}/item/public_token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: envValue('PLAID_CLIENT_ID'),
        secret: envValue('PLAID_SECRET'),
        public_token: publicToken,
      }),
    });
    const data = await res.json() as { access_token?: string; item_id?: string; error_message?: string };
    if (!data.access_token) {
      return NextResponse.json({ ok: false, error: data.error_message || 'exchange_failed' }, { status: 502 });
    }
    const response = NextResponse.json({ ok: true });
    const secure = process.env.NODE_ENV === 'production';
    response.cookies.set('nesio_plaid_access', data.access_token, {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 180,
    });
    // 新连接从头同步
    response.cookies.set('nesio_plaid_cursor', '', { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: 'plaid_unreachable' }, { status: 502 });
  }
}
