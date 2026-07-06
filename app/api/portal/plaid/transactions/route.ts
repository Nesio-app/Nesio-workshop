/**
 * GET /api/portal/plaid/transactions — 增量拉取银行流水(批次 21)。
 * /transactions/sync 游标增量(游标存 httpOnly cookie),每次最多 5 页。
 * 返回精简字段;明细存客户端本机(nesio-bank-tx-v1),隐私自控。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { plaidBase } from '../link-token/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

interface PlaidTx {
  transaction_id: string;
  account_id?: string;
  date: string;
  name: string;
  merchant_name?: string | null;
  amount: number;
  iso_currency_code?: string | null;
  personal_finance_category?: { primary?: string } | null;
  pending?: boolean;
}

interface PlaidAccount {
  account_id: string;
  name?: string;
  official_name?: string | null;
  mask?: string | null;
  type?: string;
  subtype?: string | null;
  balances?: { current?: number | null; available?: number | null; iso_currency_code?: string | null };
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
  let accounts: PlaidAccount[] = [];

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
        added?: PlaidTx[]; accounts?: PlaidAccount[]; next_cursor?: string; has_more?: boolean;
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
      if (data.accounts?.length) accounts = data.accounts; // sync 每次回全量账户,取最新
      cursor = data.next_cursor || cursor;
      if (!data.has_more) break;
    }

    // 批次 39:账户单独用 /accounts/get 兜底 —— transactions/sync 在增量(有 cursor、无新交易)
    // 时可能不回 accounts,导致「卡片」永远空。这里独立拉一次,保证一定有账户/余额。
    if (!accounts.length) {
      try {
        const accRes = await fetch(`${plaidBase()}/accounts/get`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: envValue('PLAID_CLIENT_ID'),
            secret: envValue('PLAID_SECRET'),
            access_token: accessToken,
          }),
        });
        const accData = await accRes.json() as { accounts?: PlaidAccount[] };
        if (accData.accounts?.length) accounts = accData.accounts;
      } catch { /* 兜底失败就算了,不阻断交易 */ }
    }

    const response = NextResponse.json({
      ok: true,
      accounts: accounts.map((a) => ({
        id: a.account_id,
        name: a.name || a.official_name || '账户',
        mask: a.mask || undefined,
        type: a.type,
        subtype: a.subtype || undefined,
        balance: a.balances?.current ?? undefined,
        currency: a.balances?.iso_currency_code || 'USD',
      })),
      transactions: added.filter((t) => !t.pending).map((t) => ({
        id: t.transaction_id,
        accountId: t.account_id,
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
