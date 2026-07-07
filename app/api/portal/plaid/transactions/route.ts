/**
 * GET /api/portal/plaid/transactions — 增量拉取银行流水(批次 21)。
 * /transactions/sync 游标增量(游标存 httpOnly cookie),每次最多 5 页。
 * 返回精简字段;明细存客户端本机(nesio-bank-tx-v1),隐私自控。
 *
 * 财务⑧:重复授权同一银行会创建新 item —— 同一张实体卡在新旧两个 item 下
 * 有两个不同 account_id,账户重复、交易双份计数。这里按机构元数据指纹
 * (institution|mask|subtype)识别「账户集合被更新 item 完全覆盖」的旧 item,
 * best-effort /item/remove 并把它的 token/游标从 cookie 摘除,其账户/交易不返回。
 * 同时给每个账户附机构名/logo/主色(/item/get + /institutions/get_by_id),供 UI 展示。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { plaidBase } from '../link-token/route';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';
// 财务⑦:多家机构首次回填一次要拉几十页,默认 10s 函数时限会拦腰截断
export const maxDuration = 60;

interface PlaidTx {
  transaction_id: string;
  account_id?: string;
  date: string;
  name: string;
  merchant_name?: string | null;
  amount: number;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  personal_finance_category?: { primary?: string; detailed?: string } | null;
  pending?: boolean;
  merchant_entity_id?: string | null; // 财务⑲:Plaid 官方商户实体 id(归并同商户不同描述符)
  logo_url?: string | null;           // 商户 logo(Plaid 富化)
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

interface Institution { id: string; name?: string; logo?: string | null; color?: string | null }

interface PlaidInvTx {
  investment_transaction_id: string;
  account_id?: string;
  date: string;
  name?: string | null;
  amount: number;
  iso_currency_code?: string | null;
  type?: string;
  subtype?: string;
}

// 财务⑯:投资账户的交易走 investments 产品(transactions 产品不覆盖 → 此前 Fidelity 全空)。
// 分红/利息 → 收入(带细分,喂「收入构成」);费用 → 银行费用;缴存/取出与买卖 → 转账不计收支。
export function invTxCategory(t: { type?: string; subtype?: string; amount: number }): { category: string; detail?: string } {
  const st = `${t.subtype || ''} ${t.type || ''}`.toLowerCase();
  if (st.includes('dividend')) return { category: 'INCOME', detail: 'INCOME_DIVIDENDS' };
  if (st.includes('interest')) return { category: 'INCOME', detail: 'INCOME_INTEREST_EARNED' };
  if (st.includes('fee') || st.includes('tax')) return { category: 'BANK_FEES' };
  if (st.includes('deposit') || st.includes('contribution')) return { category: 'TRANSFER_IN' };
  if (st.includes('withdrawal') || st.includes('distribution')) return { category: 'TRANSFER_OUT' };
  return { category: t.amount >= 0 ? 'TRANSFER_OUT' : 'TRANSFER_IN' }; // buy/sell 等内部流转
}

/**
 * 重复 item 判定(纯函数,契约钉死):token i 的账户集合非空、每个账户都有 mask,
 * 且每个指纹(机构|mask|subtype)都被**更靠后**(=更新授权)的 token 覆盖 → i 是重复授权。
 * 缺 mask/缺机构一律不杀(保守);互为重复的多个旧 item 只留最新那个。
 */
export function staleTokenIndexes(perToken: Array<{ institutionId: string; accounts: Array<{ mask?: string | null; type?: string; subtype?: string | null }> }>): number[] {
  const fp = (inst: string, a: { mask?: string | null; type?: string; subtype?: string | null }) =>
    inst && a.mask ? `${inst}|${a.mask}|${a.subtype || a.type || ''}` : '';
  const latestIdx = new Map<string, number>();
  for (let i = 0; i < perToken.length; i++) {
    for (const a of perToken[i].accounts) {
      const f = fp(perToken[i].institutionId, a);
      if (f) latestIdx.set(f, i);
    }
  }
  const stale: number[] = [];
  for (let i = 0; i < perToken.length; i++) {
    const { institutionId, accounts } = perToken[i];
    if (!institutionId || !accounts.length) continue;
    const fps = accounts.map((a) => fp(institutionId, a));
    if (fps.some((f) => !f)) continue; // 有账户缺 mask → 不敢下结论
    if (fps.every((f) => (latestIdx.get(f) ?? i) > i)) stale.push(i);
  }
  return stale;
}

async function plaidPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${plaidBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: envValue('PLAID_CLIENT_ID'), secret: envValue('PLAID_SECRET'), ...body }),
  });
  return await res.json() as Record<string, unknown>;
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
  // 财务㉑:全量回填 —— 增量游标下老交易不会重推,富化字段(logo/实体id/细分类)只会出现
  // 在新交易上;?full=1 忽略游标从头重拉,客户端按 id 覆盖补齐(每设备一次)。
  const fullResync = req.nextUrl?.searchParams?.get('full') === '1';
  if (fullResync) cursors = [];

  const added: PlaidTx[] = [];
  const invAdded: PlaidInvTx[] = []; // 财务⑯:投资账户流水(独立产品拉取)
  const removedIds: string[] = [];
  const acctById = new Map<string, PlaidAccount>();
  let anyRelink = false;
  // 财务⑦:刚连上的机构,accounts/get 立即可用,但流水初始拉取要在 Plaid 侧准备几分钟——
  // /transactions/sync 此时返回 NOT_READY/空。不识别它就是静默空同步(账户出现了、数字全不动)。
  let pendingItems = 0;
  const nextCursors: string[] = [];
  // 财务⑧:每 token 的账户归属/机构元数据;accountsOk 全真才敢说这份账户表是权威快照
  const perToken: Array<{ institutionId: string; accounts: PlaidAccount[] }> = [];
  const accountsOk: boolean[] = [];
  const instCache = new Map<string, Institution>();
  const acctInst = new Map<string, Institution>(); // account_id → 机构元数据

  try {
    for (let i = 0; i < tokens.length; i++) {
      const accessToken = tokens[i];
      // 从上次存的游标续拉;首次(无游标)全量回填,页数上限抬到 50(=5000 笔)防极端,
      // 但只要 has_more 为真就继续,不再在 10 页处硬停。
      let cursor = typeof cursors[i] === 'string' ? cursors[i] : '';
      for (let page = 0; page < 50; page++) {
        const data = await plaidPost('/transactions/sync', { access_token: accessToken, cursor: cursor || undefined, count: 100 }) as {
          added?: PlaidTx[]; modified?: PlaidTx[]; removed?: Array<{ transaction_id: string }>; accounts?: PlaidAccount[];
          next_cursor?: string; has_more?: boolean; error_code?: string; transactions_update_status?: string;
        };
        if (data.error_code === 'PRODUCT_NOT_READY' || data.transactions_update_status === 'NOT_READY') {
          pendingItems += 1; // 游标不动,下次同步从头再拉这家
          break;
        }
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
      let tokenAccounts: PlaidAccount[] = [];
      let ok = false;
      try {
        const accData = await plaidPost('/accounts/get', { access_token: accessToken }) as { accounts?: PlaidAccount[]; error_code?: string };
        if (!accData.error_code && Array.isArray(accData.accounts)) {
          tokenAccounts = accData.accounts;
          ok = true;
          for (const a of tokenAccounts) acctById.set(a.account_id, a);
        }
      } catch { /* skip */ }
      accountsOk[i] = ok;
      // 财务⑯:投资账户流水 —— transactions 产品不覆盖投资账户(Fidelity 此前全空),
      // 走 /investments/transactions/get(近 24 个月,按 id upsert 天然去重;失败不阻断)。
      const invAccounts = tokenAccounts.filter((a) => ['investment', 'brokerage'].includes((a.type || '').toLowerCase()));
      if (invAccounts.length) {
        try {
          const endDate = new Date().toISOString().slice(0, 10);
          const startDate = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
          let offset = 0;
          for (let page = 0; page < 4; page++) {
            const inv = await plaidPost('/investments/transactions/get', {
              access_token: accessToken, start_date: startDate, end_date: endDate,
              options: { count: 500, offset, account_ids: invAccounts.map((a) => a.account_id) },
            }) as { investment_transactions?: PlaidInvTx[]; total_investment_transactions?: number; error_code?: string };
            if (inv.error_code || !Array.isArray(inv.investment_transactions)) break;
            invAdded.push(...inv.investment_transactions);
            offset += inv.investment_transactions.length;
            if (!inv.investment_transactions.length || offset >= (inv.total_investment_transactions ?? 0)) break;
          }
        } catch { /* investments 产品不可用(机构不支持/未授权)→ 只有余额没有流水,保持现状 */ }
      }
      // 财务⑧:机构元数据(item/get → institutions/get_by_id,按机构缓存;失败不阻断)。
      // 财务⑪:机构 id 与元数据解耦 —— 此前 get_by_id 一失败连 id 都丢,重复 item 判定
      // (靠机构 id 指纹)被击穿,旧账户清不掉。现在 id 先落袋,logo/名称可缺。
      let inst: Institution = { id: '' };
      try {
        const itemData = await plaidPost('/item/get', { access_token: accessToken }) as { item?: { institution_id?: string | null } };
        inst = { id: itemData.item?.institution_id || '' };
      } catch { /* item/get 失败:无机构 id,该 token 不参与去重(保守) */ }
      if (inst.id) {
        const cached = instCache.get(inst.id);
        if (cached) {
          inst = cached;
        } else {
          try {
            const instData = await plaidPost('/institutions/get_by_id', {
              institution_id: inst.id, country_codes: ['US'], options: { include_optional_metadata: true },
            }) as { institution?: { name?: string; logo?: string | null; primary_color?: string | null } };
            inst = { id: inst.id, name: instData.institution?.name, logo: instData.institution?.logo, color: instData.institution?.primary_color };
          } catch { /* 元数据可缺,id 已保住 */ }
          instCache.set(inst.id, inst);
        }
      }
      perToken[i] = { institutionId: inst.id, accounts: tokenAccounts };
      for (const a of tokenAccounts) acctInst.set(a.account_id, inst);
    }

    // ── 财务⑧:摘除被更新授权完全覆盖的旧 item(账户/交易双份的根因)──
    const stale = new Set(staleTokenIndexes(perToken));
    const staleAccountIds = new Set<string>();
    if (stale.size) {
      for (const i of stale) {
        for (const a of perToken[i].accounts) { staleAccountIds.add(a.account_id); acctById.delete(a.account_id); }
        try { await plaidPost('/item/remove', { access_token: tokens[i] }); } catch { /* best-effort */ }
      }
    }
    const keptTokens = tokens.filter((_, i) => !stale.has(i));
    const keptCursors = nextCursors.filter((_, i) => !stale.has(i));
    const keptAccountsOk = accountsOk.filter((_, i) => !stale.has(i));
    const accounts = [...acctById.values()];
    // 权威快照:每个存活 token 的 accounts/get 都成功 → 客户端可整体替换账户表
    const authoritative = keptAccountsOk.length > 0 && keptAccountsOk.every(Boolean);

    const response = NextResponse.json({
      relink: anyRelink || undefined,
      pendingItems: pendingItems || undefined,
      authoritative,
      ok: true,
      accounts: accounts.map((a) => ({
        id: a.account_id,
        name: a.name || a.official_name || '账户',
        mask: a.mask || undefined,
        type: a.type,
        subtype: a.subtype || undefined,
        balance: a.balances?.current ?? undefined,
        currency: a.balances?.iso_currency_code || 'USD',
        institution: acctInst.get(a.account_id)?.name || undefined,
        logo: acctInst.get(a.account_id)?.logo || undefined,
        color: acctInst.get(a.account_id)?.color || undefined,
      })),
      transactions: [
        ...added.filter((t) => !t.pending && !(t.account_id && staleAccountIds.has(t.account_id))).map((t) => ({
          id: t.transaction_id,
          accountId: t.account_id,
          date: t.date,
          name: t.merchant_name || t.name,
          amount: t.amount,
          // 币种缺失时不默认 USD(会把外币混进 USD 汇总);留空,下游据此排除出金额统计。
          currency: t.iso_currency_code || t.unofficial_currency_code || '',
          // 分类缺失时留空;下游 txFlow 不再用金额符号猜 income/refund(会把工资当退款倒扣)。
          category: t.personal_finance_category?.primary || '',
          // 财务⑨:detailed 细分类(咖啡/加油/房租…)透传,只作展示细化,统计仍按 primary
          categoryDetail: t.personal_finance_category?.detailed || undefined,
          // 财务⑲:商户实体 id + logo(响应自带的富化,此前一直丢弃)
          merchantId: t.merchant_entity_id || undefined,
          merchantLogo: t.logo_url || undefined,
        })),
        // 财务⑯:投资流水(分红/利息=收入细分;费用=银行费用;缴存/买卖=转账不计收支)
        ...invAdded.filter((t) => !(t.account_id && staleAccountIds.has(t.account_id))).map((t) => {
          const c = invTxCategory(t);
          return {
            id: t.investment_transaction_id,
            accountId: t.account_id,
            date: t.date,
            name: t.name || t.subtype || t.type || 'Investment',
            amount: t.amount,
            currency: t.iso_currency_code || '',
            category: c.category,
            categoryDetail: c.detail,
          };
        }),
      ],
      removedIds,
    });
    // 存回增量游标,下次从这里续拉(真增量,不再每次从最旧重来)。
    const secure = process.env.NODE_ENV === 'production';
    response.cookies.set('nesio_plaid_cursors', JSON.stringify(keptCursors), {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 90,
    });
    if (stale.size) {
      // 摘除重复 item 的 token(与游标同步瘦身,数组保持同序)
      response.cookies.set('nesio_plaid_tokens', JSON.stringify(keptTokens), {
        httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 180,
      });
    }
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: 'plaid_unreachable' }, { status: 502 });
  }
}
