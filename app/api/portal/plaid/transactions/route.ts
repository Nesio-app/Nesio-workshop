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
  unofficial_currency_code?: string | null;
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

  // 每个 token 的增量游标:持久化在 cookie(与 tokens 数组同序),否则每次都从 cursor=''
  // 从"最旧"重拉,配 10 页硬顶 → 交易超 1000 笔的用户永远同步不到近几月。
  let cursors: string[] = [];
  try { cursors = JSON.parse(req.cookies.get('nesio_plaid_cursors')?.value || '[]'); } catch { cursors = []; }
  if (!Array.isArray(cursors)) cursors = [];

  const added: PlaidTx[] = [];
  const removedIds: string[] = [];
  const acctById = new Map<string, PlaidAccount>();
  let anyRelink = false;
  const nextCursors: string[] = [];

  try {
    for (let i = 0; i < tokens.length; i++) {
      const accessToken = tokens[i];
      // 从上次存的游标续拉;首次(无游标)全量回填,页数上限抬到 50(=5000 笔)防极端,
      // 但只要 has_more 为真就继续,不再在 10 页处硬停。
      let cursor = typeof cursors[i] === 'string' ? cursors[i] : '';
      for (let page = 0; page < 50; page++) {
        const res = await fetch(`${plaidBase()}/transactions/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: envValue('PLAID_CLIENT_ID'), secret: envValue('PLAID_SECRET'), access_token: accessToken, cursor: cursor || undefined, count: 100 }),
        });
        const data = await res.json() as { added?: PlaidTx[]; modified?: PlaidTx[]; removed?: Array<{ transaction_id: string }>; accounts?: PlaidAccount[]; next_cursor?: string; has_more?: boolean; error_code?: string };
        if (data.error_code) { if (data.error_code === 'ITEM_LOGIN_REQUIRED') anyRelink = true; break; }
        // added + modified 都送客户端按 id upsert;removed 让客户端删掉。
        added.push(...(data.added ?? []), ...(data.modified ?? []));
        for (const r of data.removed ?? []) removedIds.push(r.transaction_id);
        for (const a of data.accounts ?? []) acctById.set(a.account_id, a);
        cursor = data.next_cursor || cursor;
        if (!data.has_more) break;
      }
      nextCursors[i] = cursor;
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
        // 币种缺失时不默认 USD(会把外币混进 USD 汇总);留空,下游据此排除出金额统计。
        currency: t.iso_currency_code || t.unofficial_currency_code || '',
        // 分类缺失时留空;下游 txFlow 不再用金额符号猜 income/refund(会把工资当退款倒扣)。
        category: t.personal_finance_category?.primary || '',
      })),
      removedIds,
    });
    // 存回增量游标,下次从这里续拉(真增量,不再每次从最旧重来)。
    const secure = process.env.NODE_ENV === 'production';
    response.cookies.set('nesio_plaid_cursors', JSON.stringify(nextCursors), {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 90,
    });
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: 'plaid_unreachable' }, { status: 502 });
  }
}
