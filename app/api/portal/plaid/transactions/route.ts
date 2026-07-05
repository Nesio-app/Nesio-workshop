/**
 * GET /api/portal/plaid/transactions — 增量拉取银行流水(批次 21)。
 * /transactions/sync 游标增量(游标存 httpOnly cookie),每次最多 5 页。
 * 返回精简字段;明细存客户端本机(nesio-bank-tx-v1),隐私自控。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { plaidBase } from '../link-token/route';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

interface PlaidTx {
  transaction_id: string;
  date: string;
  name: string;
  merchant_name?: string | null;
  amount: number;
  iso_currency_code?: string | null;
  personal_finance_category?: { primary?: string } | null;
  pending?: boolean;
}

export async function GET(req: NextRequest) {
  const guard = await guardAiRoute(req, 'plaid', { limit: 10 });
  if (guard) return guard;

  const accessToken = req.cookies.get('nesio_plaid_access')?.value || '';
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: 'not_connected' }, { status: 401 });
  }

  let cursor = req.cookies.get('nesio_plaid_cursor')?.value || '';
  const added: PlaidTx[] = [];

  try {
    for (let page = 0; page < 5; page++) {
      const res = await fetch(`${plaidBase()}/transactions/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: envValue('PLAID_CLIENT_ID'),
          secret: envValue('PLAID_SECRET'),
          access_token: accessToken,
          cursor: cursor || undefined,
          count: 100,
        }),
      });
      const data = await res.json() as {
        added?: PlaidTx[]; next_cursor?: string; has_more?: boolean;
        error_code?: string; error_message?: string;
      };
      if (data.error_code) {
        const needsRelink = data.error_code === 'ITEM_LOGIN_REQUIRED';
        return NextResponse.json(
          { ok: false, error: needsRelink ? 'relink_required' : data.error_code, detail: data.error_message },
          { status: needsRelink ? 401 : 502 },
        );
      }
      added.push(...(data.added ?? []));
      cursor = data.next_cursor || cursor;
      if (!data.has_more) break;
    }

    const response = NextResponse.json({
      ok: true,
      transactions: added.filter((t) => !t.pending).map((t) => ({
        id: t.transaction_id,
        date: t.date,
        name: t.merchant_name || t.name,
        amount: t.amount,
        currency: t.iso_currency_code || 'USD',
        category: t.personal_finance_category?.primary || '',
      })),
    });
    response.cookies.set('nesio_plaid_cursor', cursor, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 180,
    });
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: 'plaid_unreachable' }, { status: 502 });
  }
}
