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

  // 批次 40:多银行 —— 遍历所有 access_token(数组 cookie,回退旧单 cookie)。
  let tokens: string[] = [];
  try { tokens = JSON.parse(req.cookies.get('nesio_plaid_tokens')?.value || '[]'); } catch { tokens = []; }
  if (!Array.isArray(tokens) || !tokens.length) {
    const single = req.cookies.get('nesio_plaid_access')?.value || '';
    tokens = single ? [single] : [];
  }
  if (!tokens.length) {
    return NextResponse.json({ ok: false, error: 'not_connected' }, { status: 401 });
  }

  const added: PlaidTx[] = [];
  const acctById = new Map<string, PlaidAccount>();
  let anyRelink = false;

  try {
    for (const accessToken of tokens) {
      // 交易:每家全量拉(客户端按 id 去重),省掉多 token 共享游标的复杂度
      let cursor = '';
      for (let page = 0; page < 10; page++) {
        const res = await fetch(`${plaidBase()}/transactions/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: envValue('PLAID_CLIENT_ID'), secret: envValue('PLAID_SECRET'), access_token: accessToken, cursor: cursor || undefined, count: 100 }),
        });
        const data = await res.json() as { added?: PlaidTx[]; accounts?: PlaidAccount[]; next_cursor?: string; has_more?: boolean; error_code?: string };
        if (data.error_code) { if (data.error_code === 'ITEM_LOGIN_REQUIRED') anyRelink = true; break; }
        added.push(...(data.added ?? []));
        for (const a of data.accounts ?? []) acctById.set(a.account_id, a);
        cursor = data.next_cursor || cursor;
        if (!data.has_more) break;
      }
      // 账户:独立拉一次,保证一定有账户/余额(这家失效不阻断其他家)
      try {
        const accRes = await fetch(`${plaidBase()}/accounts/get`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: envValue('PLAID_CLIENT_ID'), secret: envValue('PLAID_SECRET'), access_token: accessToken }),
        });
        const accData = await accRes.json() as { accounts?: PlaidAccount[] };
        for (const a of accData.accounts ?? []) acctById.set(a.account_id, a);
      } catch { /* skip */ }
    }
    const accounts = [...acctById.values()];

    const response = NextResponse.json({
      relink: anyRelink || undefined,
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
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: 'plaid_unreachable' }, { status: 502 });
  }
}
