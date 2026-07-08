/**
 * GET /api/portal/gmail/connect
 * Starts Google OAuth flow with Gmail readonly scope.
 * Redirects user to Google consent screen.
 */
import { NextRequest, NextResponse } from 'next/server';
import { envValue } from '@/lib/portal/env';

// Request calendar scope alongside gmail so one consent covers both connectors
// and the resulting refresh token can serve either API.
// 批次 36:加 gmail.send —— 支持在 Nesio 里直接回复/发送邮件(每封都由用户亲手写并点发送)。
// 加了新 scope 后老用户会被 prompt=consent 要求重新授权一次,拿到发送权限。
// 免费最大化·Google 扩展授权:一次授权覆盖后续 Drive 免费云备份 / Tasks / People。
// drive.appdata=非敏感(只碰 App 私有文件夹);tasks/contacts.readonly=敏感 scope
// (生产需 Google OAuth 验证审核,验证前有未验证警告与 100 用户上限)。
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/contacts.readonly';
const STATE_COOKIE = 'nesio_gmail_oauth_state';

function callbackUrl(req: NextRequest): string {
  const configured = envValue('GMAIL_REDIRECT_URI');
  if (configured) return configured;
  const url = new URL(req.url);
  return `${url.origin}/api/portal/gmail/callback`;
}

export async function GET(req: NextRequest) {
  const clientId = envValue('GOOGLE_CLIENT_ID');
  const clientSecret = envValue('GOOGLE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { ok: false, error: 'provider_not_configured', missingEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
      { status: 503 },
    );
  }

  const state = `nesio_gmail:${Date.now()}`;
  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl(req));
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', GMAIL_SCOPE);
  authorizeUrl.searchParams.set('access_type', 'offline');
  authorizeUrl.searchParams.set('prompt', 'consent');
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
