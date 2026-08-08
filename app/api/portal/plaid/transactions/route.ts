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
import { readPlaidTokensForCurrentUser } from '@/lib/portal/integrations';
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
  personal_finance_category?: { primary?: string; detailed?: string; confidence_level?: string } | null;
  pending?: boolean;
  merchant_entity_id?: string | null; // 财务⑲:Plaid 官方商户实体 id(归并同商户不同描述符)
  logo_url?: string | null;           // 商户 logo(Plaid 富化)
  // 免费最大化·Plaid B:响应自带、此前全丢弃的富化字段(全部免费)
  authorized_date?: string | null;    // 真实刷卡日(date 是入账日;记账更准)
  payment_channel?: string | null;    // online / in store / other
  original_description?: string | null; // 原始银行描述符(需 include_original_description)
  website?: string | null;            // 商户官网
  location?: { address?: string | null; city?: string | null; region?: string | null; country?: string | null; lat?: number | null; lon?: number | null } | null;
  counterparties?: Array<{ name?: string; type?: string; logo_url?: string | null }> | null;
}

interface PlaidAccount {
  account_id: string;
  name?: string;
  official_name?: string | null;
  mask?: string | null;
  type?: string;
  subtype?: string | null;
  balances?: { current?: number | null; available?: number | null; limit?: number | null; iso_currency_code?: string | null };
}

interface Institution { id: string; name?: string; logo?: string | null; color?: string | null }

interface PlaidHolding {
  account_id: string;
  security_id: string;
  quantity?: number | null;
  institution_value?: number | null;
  cost_basis?: number | null;
  iso_currency_code?: string | null;
}
interface PlaidSecurity {
  security_id: string;
  name?: string | null;
  ticker_symbol?: string | null;
  type?: string | null;
}

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
  // 跨浏览器:本浏览器 cookie 没有令牌(换了个浏览器/清了缓存)→ 从云端取回登录账号的令牌。
  // 云端拿到后游标从空开始(全量刷新一次,不丢数据,只是首次略重),不依赖本机 cookie 游标。
  let tokensFromCloud = false;
  if (!tokens.length) {
    const cloud = await readPlaidTokensForCurrentUser();
    if (cloud && cloud.length) { tokens = cloud; tokensFromCloud = true; }
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
  // 令牌来自云端(本机 cookie 无令牌)→ cookie 游标与之不对齐,一律从空开始(全量刷新一次)。
  if (tokensFromCloud) cursors = [];

  const added: PlaidTx[] = [];
  const invAdded: PlaidInvTx[] = []; // 财务⑯:投资账户流水(独立产品拉取)
  // 财务㉗:持仓快照(holdings + securities join;失败不阻断,客户端仅在非空时替换)
  const holdingsOut: Array<{ id: string; accountId: string; name: string; ticker?: string; type?: string; quantity: number; value: number; costBasis?: number; currency: string }> = [];
  // 免费最大化·Plaid:投资拉取诊断 —— 此前 investments 的两个 catch 全空吞错,
  // 「有投资账户但没数据」既不显示也不进日志,连根因都看不到(违反可见失败态)。
  // 记账:发现几个投资账户 + Plaid 回的 error_code,透出给前端 + 落日志。
  let invAccountsTotal = 0;
  let invErrorCode = '';
  const removedIds: string[] = [];
  const acctById = new Map<string, PlaidAccount>();
  let anyRelink = false;
  // 需要走 Link update mode 修复的 token 下标(ITEM_LOGIN_REQUIRED:授权过期/改密码)。
  const relinkTokenIndexes: number[] = [];
  // 彻底死掉的 token 下标(INVALID_ACCESS_TOKEN:换 Plaid 账号/凭证后旧 token 永不再活),
  // 留着只会让每次同步白跑 —— 本次直接从 cookie 摘除。
  const deadTokenIndexes = new Set<number>();
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
        type SyncResp = {
          added?: PlaidTx[]; modified?: PlaidTx[]; removed?: Array<{ transaction_id: string }>; accounts?: PlaidAccount[];
          next_cursor?: string; has_more?: boolean; error_code?: string; transactions_update_status?: string;
        };
        // 免费最大化·Plaid B:附加富化参数 include_original_description(默认关,拿原始描述符)。
        // 修断流回归:plaidPost 对 400 也照常返回 error 体,循环里 `if (data.error_code) break`
        // 会因一个不被接受的附加参数**静默 break → 流水永远 0**。所以自愈——若 Plaid 判
        // INVALID_*,去掉附加参数重试同一页,保证同步永不因富化参数中断。
        // (此前误加的 PFCv2 顶层参数值非法,是流水返回 0 的真因,已移除。)
        const syncBody = { access_token: accessToken, cursor: cursor || undefined, count: 100 };
        let data = await plaidPost('/transactions/sync', { ...syncBody, options: { include_original_description: true } }) as SyncResp;
        if (typeof data.error_code === 'string' && data.error_code.startsWith('INVALID')) {
          data = await plaidPost('/transactions/sync', syncBody) as SyncResp;
        }
        if (data.error_code === 'PRODUCT_NOT_READY' || data.transactions_update_status === 'NOT_READY') {
          pendingItems += 1; // 游标不动,下次同步从头再拉这家
          break;
        }
        if (data.error_code) {
          if (data.error_code === 'ITEM_LOGIN_REQUIRED') { anyRelink = true; relinkTokenIndexes.push(i); }
          if (data.error_code === 'INVALID_ACCESS_TOKEN') deadTokenIndexes.add(i);
          break;
        }
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
      invAccountsTotal += invAccounts.length;
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
            // 静默吞错的根:Plaid 回 error_code(如 PRODUCTS_NOT_SUPPORTED / ADDITIONAL_CONSENT_REQUIRED /
            // 投资产品未在 dashboard 开通)时记下并落日志,不再当"没数据"糊弄过去。
            if (inv.error_code) { invErrorCode ||= inv.error_code; console.error('[plaid] investments/transactions', inv.error_code); break; }
            if (!Array.isArray(inv.investment_transactions)) break;
            invAdded.push(...inv.investment_transactions);
            offset += inv.investment_transactions.length;
            if (!inv.investment_transactions.length || offset >= (inv.total_investment_transactions ?? 0)) break;
          }
        } catch (e) { invErrorCode ||= 'inv_tx_unreachable'; console.error('[plaid] investments/transactions threw', e instanceof Error ? e.message : e); }
        // 财务㉗:持仓明细(每只股票/基金:名称/代码/数量/市值/成本)
        try {
          const h = await plaidPost('/investments/holdings/get', {
            access_token: accessToken, options: { account_ids: invAccounts.map((a) => a.account_id) },
          }) as { holdings?: PlaidHolding[]; securities?: PlaidSecurity[]; error_code?: string };
          if (h.error_code) { invErrorCode ||= h.error_code; console.error('[plaid] investments/holdings', h.error_code); }
          if (!h.error_code && Array.isArray(h.holdings)) {
            const secById = new Map((h.securities ?? []).map((sec) => [sec.security_id, sec]));
            for (const hd of h.holdings) {
              const sec = secById.get(hd.security_id);
              const name = sec?.name || sec?.ticker_symbol || 'Security';
              const ticker = sec?.ticker_symbol || undefined;
              // 稳定 id:优先 Plaid security_id(同账户同标的唯一);否则 account|ticker|name。
              // 客户端 module-sync 并集按 id —— 没 id 会被 skip 成 [] 清空投资页。
              const id = hd.security_id
                ? `${hd.account_id}|${hd.security_id}`
                : `${hd.account_id}|${ticker || ''}|${name}`;
              holdingsOut.push({
                id,
                accountId: hd.account_id,
                name,
                ticker,
                type: sec?.type || undefined,
                quantity: hd.quantity ?? 0,
                value: hd.institution_value ?? 0,
                costBasis: hd.cost_basis ?? undefined,
                currency: hd.iso_currency_code || 'USD',
              });
            }
          }
        } catch (e) { invErrorCode ||= 'inv_holdings_unreachable'; console.error('[plaid] investments/holdings threw', e instanceof Error ? e.message : e); }
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
    // 死 token(换 Plaid 账号后的旧凭证)一并摘除 —— 不调 /item/remove(它属于
    // 另一个 client,调了也是拒),只从 cookie 清掉,别再拖累每次同步。
    if (deadTokenIndexes.size) {
      console.warn('plaid_dead_tokens_pruned', { count: deadTokenIndexes.size });
      for (const i of deadTokenIndexes) stale.add(i);
    }
    const keptTokens = tokens.filter((_, i) => !stale.has(i));
    const keptCursors = nextCursors.filter((_, i) => !stale.has(i));
    const keptAccountsOk = accountsOk.filter((_, i) => !stale.has(i));
    // relink 下标换算成"摘除后的 cookie 数组"位置 —— 客户端下次带 updateIndex 来
    // 建 update-mode Link 时按新数组取 token。
    const keptIndexMap = new Map<number, number>();
    tokens.forEach((_, i) => { if (!stale.has(i)) keptIndexMap.set(i, keptIndexMap.size); });
    const relinkIndexes = relinkTokenIndexes
      .filter((i) => keptIndexMap.has(i))
      .map((i) => keptIndexMap.get(i) as number);
    const accounts = [...acctById.values()];
    // 权威快照:每个存活 token 的 accounts/get 都成功 → 客户端可整体替换账户表
    const authoritative = keptAccountsOk.length > 0 && keptAccountsOk.every(Boolean);

    // P2 尾巴:Plaid 官方定期流(/transactions/recurring/get)—— 与本地 detectRecurring 并集,
    // 冲突时本地为准(可解释);失败不阻断(个别机构/沙盒未开通该产品属常态)。
    interface PlaidStream {
      description?: string; merchant_name?: string | null; is_active?: boolean;
      frequency?: string; last_date?: string; predicted_next_date?: string;
      average_amount?: { amount?: number }; last_amount?: { amount?: number; iso_currency_code?: string | null };
    }
    const recurringStreams: Array<{ name: string; amount: number; currency: string; frequency: string; lastDate: string; nextDate?: string; isActive: boolean; direction: 'inflow' | 'outflow' }> = [];
    let recurringOk = false; // 至少一个 token 成功才回字段 —— 全挂时字段缺席,客户端保留上次好数据
    for (const accessToken of keptTokens) {
      try {
        const rec = await plaidPost('/transactions/recurring/get', { access_token: accessToken }) as {
          inflow_streams?: PlaidStream[]; outflow_streams?: PlaidStream[]; error_code?: string;
        };
        if (rec.error_code) continue; // 产品未开通/机构不支持:静默跳过,本地检测兜底
        recurringOk = true;
        const push = (arr: PlaidStream[] | undefined, direction: 'inflow' | 'outflow') => {
          for (const s of arr ?? []) {
            const amount = Math.abs(s.last_amount?.amount ?? s.average_amount?.amount ?? 0);
            if (!(amount > 0)) continue;
            recurringStreams.push({
              name: s.merchant_name || s.description || 'Recurring',
              amount: Math.round(amount * 100) / 100,
              currency: s.last_amount?.iso_currency_code || 'USD',
              frequency: s.frequency || 'MONTHLY',
              lastDate: s.last_date || '',
              ...(s.predicted_next_date ? { nextDate: s.predicted_next_date } : {}),
              isActive: s.is_active !== false,
              direction,
            });
          }
        };
        push(rec.inflow_streams, 'inflow');
        push(rec.outflow_streams, 'outflow');
      } catch { /* 单 token 失败不影响其余 */ }
    }

    // Guidance 全 AI 化 Step 4 前置:/liabilities/get —— 信用卡还款日/最低还款/账单余额是
    // **结构化字段**(9 张卡 $5,672 债务此前没有任何到期提醒来源)。与 recurring 同款容错:
    // 产品未开通静默跳过、单 token 失败不阻断、全挂时字段缺席(客户端保留上次好数据)。
    interface PlaidLiabilityRow {
      account_id?: string; next_payment_due_date?: string | null; minimum_payment_amount?: number | null;
      last_statement_balance?: number | null; is_overdue?: boolean | null;
    }
    const liabilities: Array<{ accountId: string; kind: 'credit' | 'mortgage' | 'student'; dueDate: string; minPayment?: number; statementBalance?: number; isOverdue?: boolean }> = [];
    let liabilitiesOk = false;
    for (const accessToken of keptTokens) {
      try {
        const liab = await plaidPost('/liabilities/get', { access_token: accessToken }) as {
          liabilities?: { credit?: PlaidLiabilityRow[]; mortgage?: PlaidLiabilityRow[]; student?: PlaidLiabilityRow[] }; error_code?: string;
        };
        if (liab.error_code) continue;
        liabilitiesOk = true;
        const pushLiab = (arr: PlaidLiabilityRow[] | undefined, kind: 'credit' | 'mortgage' | 'student') => {
          for (const row of arr ?? []) {
            if (!row.account_id || !row.next_payment_due_date) continue; // 没到期日的负债对提醒无用
            liabilities.push({
              accountId: row.account_id,
              kind,
              dueDate: row.next_payment_due_date,
              ...(row.minimum_payment_amount != null ? { minPayment: Math.round(row.minimum_payment_amount * 100) / 100 } : {}),
              ...(row.last_statement_balance != null ? { statementBalance: Math.round(row.last_statement_balance * 100) / 100 } : {}),
              ...(row.is_overdue != null ? { isOverdue: row.is_overdue } : {}),
            });
          }
        };
        pushLiab(liab.liabilities?.credit, 'credit');
        pushLiab(liab.liabilities?.mortgage, 'mortgage');
        pushLiab(liab.liabilities?.student, 'student');
      } catch { /* 单 token 失败不影响其余 */ }
    }

    const response = NextResponse.json({
      ...(recurringOk ? { recurringStreams: recurringStreams.slice(0, 100) } : {}),
      ...(liabilitiesOk ? { liabilities: liabilities.slice(0, 60) } : {}),
      relink: anyRelink || undefined,
      relinkIndexes: relinkIndexes.length ? relinkIndexes : undefined,
      prunedDead: deadTokenIndexes.size || undefined,
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
        // 财务㉙:信用卡额度(利用率 = balance/limit;非信用账户 Plaid 给 null)
        limit: a.balances?.limit ?? undefined,
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
          // 免费最大化·Plaid B:富化字段透传(此前全丢)
          authorizedDate: t.authorized_date || undefined, // 真实刷卡日
          paymentChannel: t.payment_channel || undefined, // online/in store/other
          origDesc: t.original_description || undefined,   // 原始描述符(救 Plaid 没富化的商户)
          website: t.website || undefined,
          city: t.location?.city || undefined,
          lat: typeof t.location?.lat === 'number' ? t.location.lat : undefined,
          lon: typeof t.location?.lon === 'number' ? t.location.lon : undefined,
          // 低置信度分类留标记,供后续「主动请你纠正」
          lowConfidence: t.personal_finance_category?.confidence_level === 'LOW' || t.personal_finance_category?.confidence_level === 'UNKNOWN' || undefined,
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
            invSubtype: t.subtype || t.type || undefined, // 组合体检:买卖 vs 入金/费用要靠它区分
          };
        }),
      ],
      removedIds,
      // 财务㉗:持仓快照(点时值;客户端整体替换,仅在非空时)
      holdings: holdingsOut.filter((h) => !staleAccountIds.has(h.accountId)),
      // 投资拉取诊断:有几个投资账户 / 拉到几条持仓 / Plaid 回的错误码(用于前端可见失败态 + 客服)。
      // 「有投资账户但 holdings=0 且有 error」= 多半是该 Item 未授权 investments 产品(需断开重连券商),
      // 或 Plaid production 未开通 Investments 产品。
      investments: {
        accounts: invAccountsTotal,
        holdings: holdingsOut.filter((h) => !staleAccountIds.has(h.accountId)).length,
        transactions: invAdded.filter((t) => !(t.account_id && staleAccountIds.has(t.account_id))).length,
        ...(invErrorCode ? { error: invErrorCode } : {}),
      },
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
