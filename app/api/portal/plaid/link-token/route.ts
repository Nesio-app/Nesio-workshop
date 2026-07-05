/**
 * POST /api/portal/plaid/link-token — 创建 Plaid Link token(批次 21)。
 * env:PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV(sandbox|development|production,默认 sandbox)。
 * 未配置时诚实返回 plaid_not_configured,前端给出 dashboard.plaid.com 指引。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

export function plaidBase(): string {
  const env = envValue('PLAID_ENV') || 'sandbox';
  return `https://${env}.plaid.com`;
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'plaid', { limit: 10 });
  if (guard) return guard;

  const clientId = envValue('PLAID_CLIENT_ID');
  const secret = envValue('PLAID_SECRET');
  if (!clientId || !secret) {
    return NextResponse.json({ ok: false, error: 'plaid_not_configured' }, { status: 503 });
  }

  try {
    const res = await fetch(`${plaidBase()}/link/token/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        secret,
        client_name: 'Nesio',
        user: { client_user_id: 'nesio-user' },
        products: ['transactions'],
        country_codes: ['US'],
        language: 'en',
      }),
    });
    const data = await res.json() as { link_token?: string; error_message?: string };
    if (!data.link_token) {
      return NextResponse.json({ ok: false, error: data.error_message || 'link_token_failed' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, linkToken: data.link_token });
  } catch {
    return NextResponse.json({ ok: false, error: 'plaid_unreachable' }, { status: 502 });
  }
}
