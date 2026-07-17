/**
 * POST /api/portal/plaid/link-token — 创建 Plaid Link token(批次 21)。
 * env:PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV(sandbox|development|production,默认 sandbox)。
 * 未配置时诚实返回 plaid_not_configured,前端给出 dashboard.plaid.com 指引。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

export function plaidEnv(): string {
  // 批次 26:容错——去空白/小写,只认三个合法值,否则回落 sandbox。
  // 用户设了 production 却仍进沙盒银行 = 运行时 env 没解析成 production。
  const raw = envValue('PLAID_ENV').toLowerCase();
  return raw === 'production' || raw === 'development' ? raw : 'sandbox';
}

export function plaidBase(): string {
  return `https://${plaidEnv()}.plaid.com`;
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'plaid', { limit: 10 });
  if (guard) return guard;

  const clientId = envValue('PLAID_CLIENT_ID');
  const secret = envValue('PLAID_SECRET');
  if (!clientId || !secret) {
    return NextResponse.json({ ok: false, error: 'plaid_not_configured' }, { status: 503 });
  }

  // update mode(修复模式):重连"已连过的银行"不新建 connection、不烧名额。
  // 客户端传 updateIndex(cookie token 数组下标,来自 transactions 的 relinkIndexes),
  // 服务端取出该 access_token 建 update-mode Link;token 不出服务端。
  const { updateIndex } = await req.json().catch(() => ({})) as { updateIndex?: number };
  let updateAccessToken = '';
  if (typeof updateIndex === 'number') {
    try {
      const arr = JSON.parse(req.cookies.get('nesio_plaid_tokens')?.value || '[]') as string[];
      updateAccessToken = (Array.isArray(arr) && arr[updateIndex]) || '';
    } catch { /* fall through */ }
    if (!updateAccessToken) {
      return NextResponse.json({ ok: false, error: 'unknown_item' }, { status: 400 });
    }
  }

  try {
    const baseBody = {
      client_id: clientId,
      secret,
      client_name: 'Nesio',
      user: { client_user_id: 'nesio-user' },
      products: ['transactions'],
      // 财务⑯:机构支持时顺带启用 investments(投资账户流水);不支持不影响连接
      optional_products: ['investments'],
      // 免费最大化·Plaid A:历史窗口从默认 90 天抬到 730 天(2 年,免费)——
      // 支撑真·同比、更准的订阅识别(Plaid 官方建议 Recurring 至少 180 天)。
      // 仅对新建/重连的 Item 生效;已连账户需重连一次才拿到 2 年历史。
      transactions: { days_requested: 730 },
      country_codes: ['US'],
      language: 'en',
    };
    // iOS PWA/webview 修:OAuth 银行(Chase 等)授权后必须把浏览器带回本站
    // 就地续接 Link,否则依赖旧页面活着 —— PWA 被 iOS 杀掉重载即黑屏断链。
    // redirect_uri 必须先在 dashboard.plaid.com → API → Allowed redirect URIs
    // 登记;没登记时 Plaid 会拒绝 create,这里自动去掉重试,行为与旧版一致。
    const redirectUri = envValue('PLAID_REDIRECT_URI') || `${new URL(req.url).origin}/plaid-oauth`;
    const create = (body: object) => fetch(`${plaidBase()}/link/token/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // update mode:带 access_token,且不传产品参数(Plaid 修复模式的要求);
    // 修复既有 item 不新建 connection,不烧试用名额。
    const { products: _p, optional_products: _op, transactions: _t, ...updateBase } = baseBody;
    const requestBody = updateAccessToken ? { ...updateBase, access_token: updateAccessToken } : baseBody;
    let usedRedirect = true;
    let res = await create({ ...requestBody, redirect_uri: redirectUri });
    let data = await res.json() as { link_token?: string; error_message?: string; error_code?: string };
    if (!data.link_token && /redirect/i.test(data.error_message || '')) {
      console.warn('plaid_redirect_uri_not_allowlisted', redirectUri);
      usedRedirect = false;
      res = await create(requestBody);
      data = await res.json() as { link_token?: string; error_message?: string; error_code?: string };
    }
    if (!data.link_token) {
      return NextResponse.json({ ok: false, error: data.error_message || 'link_token_failed' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, linkToken: data.link_token, env: plaidEnv(), oauthRedirect: usedRedirect, mode: updateAccessToken ? 'update' : 'link' });
  } catch {
    return NextResponse.json({ ok: false, error: 'plaid_unreachable' }, { status: 502 });
  }
}
