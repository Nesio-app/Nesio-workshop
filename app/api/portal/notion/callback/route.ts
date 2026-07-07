/**
 * GET /api/portal/notion/callback — Notion OAuth 回调(批次 18)。
 * code → access_token(Notion token 长期有效,无 refresh)。
 *
 * Notion 修(iOS PWA 连不上的两个结构性断点):
 * 1. state 校验不再依赖发起浏览器的 cookie —— 签名 state 自校验
 *    (HMAC + 15 分钟窗口),回调落在 Safari/其他上下文也能通过;
 *    老格式 state 回落到 cookie 对比(gmail 同款宽松策略)。
 * 2. token 不再只存本机 cookie —— 签名 state 携带的 userId 直接写进
 *    Supabase integrations(service role),PWA 里的 status/同步用会话
 *    就能跨上下文读到;cookie 仍写(同上下文即刻可用)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { envValue } from '@/lib/portal/env';
import { verifySignedState } from '@/lib/portal/notion-oauth-state.mjs';
import { saveIntegrationToken, saveIntegrationTokenByUserId, getRefreshedUserId } from '@/lib/portal/integrations';

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

  const clientId = envValue('NOTION_CLIENT_ID');
  const clientSecret = envValue('NOTION_CLIENT_SECRET');
  const stateSecret = clientSecret || clientId;

  const verdict = verifySignedState(state, stateSecret);
  let stateUserId = '';
  let stateOk = false;
  if (verdict.ok) {
    stateOk = true;
    stateUserId = verdict.userId;
  } else if (verdict.reason === 'legacy') {
    // 老格式随机 state:沿用 gmail 的宽松策略 —— cookie 在且不一致才拒,
    // cookie 不在(跨上下文)放行,别把真实授权挡在门外。
    stateOk = !storedState || state === storedState;
  } else if (verdict.reason === 'expired') {
    return NextResponse.redirect(new URL('/?connector=notion&error=state_expired', req.url));
  }
  if (!code || !stateOk) {
    return NextResponse.redirect(new URL('/?connector=notion&error=state_mismatch', req.url));
  }

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

  // 跨上下文持久化:优先用 state 里的 userId(service role 直写);
  // 没有就用本请求的会话走刷新链解析(同上下文但 access cookie 过期的情况);
  // 最后才退到老的"仅当场 access 有效"写法。
  let savedToCloud = false;
  if (stateUserId) {
    savedToCloud = await saveIntegrationTokenByUserId(stateUserId, 'notion', { accessToken: token.access_token });
  }
  if (!savedToCloud) {
    const sessionUserId = await getRefreshedUserId();
    if (sessionUserId) {
      savedToCloud = await saveIntegrationTokenByUserId(sessionUserId, 'notion', { accessToken: token.access_token });
    }
  }
  if (!savedToCloud) {
    await saveIntegrationToken('notion', { accessToken: token.access_token }, req);
  }

  const redirect = NextResponse.redirect(new URL('/?connector=notion&status=connected', req.url));
  redirect.cookies.set('nesio_notion_access', token.access_token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/',
    maxAge: 60 * 60 * 24 * 180, // Notion token 不过期,cookie 给半年
  });
  redirect.cookies.delete(STATE_COOKIE);
  return redirect;
}
