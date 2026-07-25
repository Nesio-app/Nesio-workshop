/**
 * POST /api/portal/plaid/exchange — public_token 换 access_token(批次 21)。
 * access_token 存 httpOnly cookie(半年),交易同步游标随连接重置。
 * 财务⑥:多机构一次授权(multi-item Link)的 session 会创建多个 item,
 * onSuccess 只回传其中一个 public_token —— 只换它就会丢掉其余机构
 * (用户「授权了 6 家只出现 1 家」)。带上 link_token 调 /link/token/get
 * 把本次 session 全部 item 的 public_token 捞出来逐个交换,一家不落。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { plaidBase } from '../link-token/route';
import { envValue } from '@/lib/portal/env';
import { writePlaidTokensForCurrentUser } from '@/lib/portal/integrations';

export const dynamic = 'force-dynamic';

/** 从 /link/token/get 响应取出本次 Link session 创建的全部 public_token(纯解析,契约钉死)。 */
export function sessionPublicTokens(data: unknown): string[] {
  const out: string[] = [];
  const sessions = (data as { link_sessions?: Array<{ results?: { item_add_results?: Array<{ public_token?: string }> } }> })?.link_sessions;
  for (const s of Array.isArray(sessions) ? sessions : []) {
    for (const r of s?.results?.item_add_results ?? []) {
      if (r?.public_token && !out.includes(r.public_token)) out.push(r.public_token);
    }
  }
  return out;
}

async function exchangeOne(publicToken: string): Promise<string | null> {
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
    const data = await res.json() as { access_token?: string };
    return data.access_token || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'plaid', { limit: 10 });
  if (guard) return guard;

  const { publicToken, linkToken } = await req.json().catch(() => ({})) as { publicToken?: string; linkToken?: string };
  if (!publicToken) {
    return NextResponse.json({ ok: false, error: 'missing_public_token' }, { status: 400 });
  }

  // 本次要交换的 public_token:onSuccess 回传的 + session 里其余 item 的(多机构一次授权)。
  const publics = [publicToken];
  if (linkToken) {
    try {
      const res = await fetch(`${plaidBase()}/link/token/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: envValue('PLAID_CLIENT_ID'),
          secret: envValue('PLAID_SECRET'),
          link_token: linkToken,
        }),
      });
      for (const pt of sessionPublicTokens(await res.json())) {
        if (!publics.includes(pt)) publics.push(pt);
      }
    } catch { /* 捞不到就只换 onSuccess 那一个,不阻断 */ }
  }

  const accessTokens: string[] = [];
  for (const pt of publics) {
    const at = await exchangeOne(pt); // 同 item 的 public_token 只能换一次,重复交换返回 null 自然去重
    if (at && !accessTokens.includes(at)) accessTokens.push(at);
  }
  if (!accessTokens.length) {
    return NextResponse.json({ ok: false, error: 'exchange_failed' }, { status: 502 });
  }

  const response = NextResponse.json({ ok: true, items: accessTokens.length });
  const secure = process.env.NODE_ENV === 'production';
  // 批次 40:支持连接多家银行 —— access_token 追加进数组 cookie,不再覆盖
  // (之前单 cookie 覆盖 → 只剩最后一家,用户「10 个账户只显示 2 个」)。
  let tokens: string[] = [];
  try { tokens = JSON.parse(req.cookies.get('nesio_plaid_tokens')?.value || '[]'); } catch { tokens = []; }
  if (!Array.isArray(tokens)) tokens = [];
  for (const at of accessTokens) if (!tokens.includes(at)) tokens.push(at);
  response.cookies.set('nesio_plaid_tokens', JSON.stringify(tokens.slice(-20)), {
    httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 180,
  });
  // 兼容:latest 也写单 cookie
  response.cookies.set('nesio_plaid_access', accessTokens[accessTokens.length - 1], {
    httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 180,
  });
  // 跨浏览器:把全量令牌数组(加密)写一份到云端;失败不阻塞(cookie 已够本浏览器用)。
  await writePlaidTokensForCurrentUser(tokens).catch(() => { /* cookie 兜底 */ });
  return response;
}
