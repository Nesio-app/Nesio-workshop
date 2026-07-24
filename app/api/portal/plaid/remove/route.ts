/**
 * POST /api/portal/plaid/remove — 清理「失败/放弃的链接」创建的 Item(退回 Plaid 名额)。
 *
 * 「错付」根因:一个 connection = 一个活 Item,而 Item 在用户银行验证通过(Link onSuccess)
 * 那一刻就已在 Plaid 侧创建 —— 早于我们后端 exchange。若随后 exchange 失败,我们没拿到
 * access_token,常规去重(staleTokenIndexes 靠 cookie 里的 token)永远看不到这个泄漏 Item,
 * 它就一直占着 1 个名额。此前每失败一次烧一个,10 个额度被刷到 20/10、试用资格作废。
 *
 * 这里用 publicToken(多机构一次授权时带 linkToken 把 session 全部 item 捞出)换出 access_token,
 * 逐个 /item/remove,把名额退回。**不写任何 cookie**(纯清理)。best-effort:换不出/删不掉都不
 * 阻断,也不抛错 —— 清理失败最差回到「占一个名额」,不能让清理本身把连接流程带崩。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { plaidBase } from '../link-token/route';
import { sessionPublicTokens } from '../exchange/route';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

async function plaidPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${plaidBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: envValue('PLAID_CLIENT_ID'), secret: envValue('PLAID_SECRET'), ...body }),
  });
  return await res.json() as Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'plaid', { limit: 10 });
  if (guard) return guard;

  const { publicToken, linkToken } = await req.json().catch(() => ({})) as { publicToken?: string; linkToken?: string };
  if (!publicToken) {
    return NextResponse.json({ ok: false, error: 'missing_public_token' }, { status: 400 });
  }

  // 本次要清理的 public_token:onSuccess 回传的 + session 里其余 item 的(多机构一次授权,
  // 一次失败可能已建多个 Item —— 一个都别漏)。
  const publics = [publicToken];
  if (linkToken) {
    try {
      for (const pt of sessionPublicTokens(await plaidPost('/link/token/get', { link_token: linkToken }))) {
        if (!publics.includes(pt)) publics.push(pt);
      }
    } catch { /* 捞不到就只清 onSuccess 那一个,不阻断 */ }
  }

  let removed = 0;
  for (const pt of publics) {
    try {
      // 换出 access_token(失败的链接此前没换过,故可换)→ /item/remove 释放名额。
      const ex = await plaidPost('/item/public_token/exchange', { public_token: pt }) as { access_token?: string };
      if (ex.access_token) {
        await plaidPost('/item/remove', { access_token: ex.access_token });
        removed++;
      }
    } catch { /* best-effort:单个换不出/删不掉不影响其余 */ }
  }
  return NextResponse.json({ ok: true, removed });
}
