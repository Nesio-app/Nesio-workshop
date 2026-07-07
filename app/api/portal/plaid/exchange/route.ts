/**
 * POST /api/portal/plaid/exchange — public_token 换 access_token(批次 21)。
 * access_token 存 httpOnly cookie(半年),交易同步游标随连接重置。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { plaidBase } from '../link-token/route';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

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
    // 批次 40:支持连接多家银行 —— access_token 追加进数组 cookie,不再覆盖
    // (之前单 cookie 覆盖 → 只剩最后一家,用户「10 个账户只显示 2 个」)。
    let tokens: string[] = [];
    try { tokens = JSON.parse(req.cookies.get('nesio_plaid_tokens')?.value || '[]'); } catch { tokens = []; }
    if (!Array.isArray(tokens)) tokens = [];
    if (!tokens.includes(data.access_token)) tokens.push(data.access_token);
    response.cookies.set('nesio_plaid_tokens', JSON.stringify(tokens.slice(-20)), {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 180,
    });
    // 兼容:latest 也写单 cookie
    response.cookies.set('nesio_plaid_access', data.access_token, {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 180,
    });
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: 'plaid_unreachable' }, { status: 502 });
  }
}
