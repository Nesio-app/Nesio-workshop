/**
 * GET /api/portal/notion/connect — Notion OAuth 授权入口(批次 18)。
 * 需要在 notion.so/my-integrations 创建 Public integration,
 * Vercel 配 NOTION_CLIENT_ID / NOTION_CLIENT_SECRET,
 * Redirect URI 填 https://<域名>/api/portal/notion/callback。
 * 未配置时诚实报错,不做假跳转。
 */
import { NextRequest, NextResponse } from 'next/server';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'nesio_notion_oauth_state';

export function GET(req: NextRequest) {
  const clientId = envValue('NOTION_CLIENT_ID');
  if (!clientId) {
    return NextResponse.redirect(new URL('/?connector=notion&error=notion_not_configured', req.url));
  }

  const origin = new URL(req.url).origin;
  const redirectUri = envValue('NOTION_REDIRECT_URI') || `${origin}/api/portal/notion/callback`;
  const state = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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
