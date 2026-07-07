/**
 * GET /api/portal/notion/connect — Notion OAuth 授权入口(批次 18)。
 * 需要在 notion.so/my-integrations 创建 Public integration,
 * Vercel 配 NOTION_CLIENT_ID / NOTION_CLIENT_SECRET,
 * Redirect URI 填 https://<域名>/api/portal/notion/callback。
 * 未配置时诚实报错,不做假跳转。
 *
 * Notion 修:state 改为 HMAC 签名自携带(含发起时的 Supabase userId),
 * 回调即使落在另一个浏览器上下文(iOS 上 Notion App 劫持后交给 Safari)
 * 也能校验通过并把 token 存进该用户的 Supabase integrations。
 * state cookie 仍然设置,作为老格式回落与同上下文加固。
 */
import { NextRequest, NextResponse } from 'next/server';
import { envValue } from '@/lib/portal/env';
import { buildSignedState } from '@/lib/portal/notion-oauth-state.mjs';
import { getSupabaseUserId } from '@/lib/portal/integrations';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'nesio_notion_oauth_state';

export async function GET(req: NextRequest) {
  const clientId = envValue('NOTION_CLIENT_ID');
  if (!clientId) {
    return NextResponse.redirect(new URL('/?connector=notion&error=notion_not_configured', req.url));
  }

  const origin = new URL(req.url).origin;
  const redirectUri = envValue('NOTION_REDIRECT_URI') || `${origin}/api/portal/notion/callback`;

  // 发起上下文里通常有 Nesio 会话:把 userId 编进签名 state,
  // 回调无论落在哪个浏览器都知道 token 属于谁。
  const supaAccess = req.cookies.get('baohe_auth_access')?.value || '';
  const userId = supaAccess ? await getSupabaseUserId(supaAccess) : null;
  const stateSecret = envValue('NOTION_CLIENT_SECRET') || clientId;
  const state = buildSignedState({ userId: userId || '', secret: stateSecret });

  const authorize = new URL('https://api.notion.com/v1/oauth/authorize');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('owner', 'user');
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('state', state);

  const res = NextResponse.redirect(authorize);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600,
  });
  return res;
}
