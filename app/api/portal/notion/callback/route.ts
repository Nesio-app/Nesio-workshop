/**
 * GET /api/portal/notion/callback — Notion OAuth 回调(批次 18)。
 * code → access_token(Notion token 长期有效,无 refresh),
 * 存 httpOnly cookie nesio_notion_access(180 天),同步走 /api/portal/notion。
 */
import { NextRequest, NextResponse } from 'next/server';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'nesio_notion_oauth_state';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') || '';
  const error = url.searchParams.get('error') || '';
  const state = url.searchParams.get('state') || '';
  const storedState = req.cookies.get(STATE_COOKIE)?.value || '';

  if (error) {
    return NextResponse.redirect(new URL(`/?connector=notion&error=${encodeURIComponent(error)}`, req.url));
  }
  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(new URL('/?connector=notion&error=state_mismatch', req.url));
  }

  const clientId = envValue('NOTION_CLIENT_ID');
  const clientSecret = envValue('NOTION_CLIENT_SECRET');
  const redirectUri = envValue('NOTION_REDIRECT_URI') || `${url.origin}/api/portal/notion/callback`;

  const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });

  const token = await tokenRes.json() as { access_token?: string; workspace_name?: string; error?: string };
  if (!token.access_token) {
    console.error('notion_oauth_token_failed', token.error);
    return NextResponse.redirect(new URL(`/?connector=notion&error=${encodeURIComponent(token.error || 'token_failed')}`, req.url));
  }

  const redirect = NextResponse.redirect(new URL('/?connector=notion&status=connected', req.url));
  redirect.cookies.set('nesio_notion_access', token.access_token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/',
    maxAge: 60 * 60 * 24 * 180, // Notion token 不过期,cookie 给半年
  });
  redirect.cookies.delete(STATE_COOKIE);
  return redirect;
}
