/**
 * GET /api/portal/gmail/connect
 * Starts Google OAuth flow with Gmail readonly scope.
 * Redirects user to Google consent screen.
 */
import { NextRequest, NextResponse } from 'next/server';
import { envValue } from '@/lib/portal/env';
import { isPortalRequestAuthorized } from '@/lib/portal/auth/api-auth';
import { getRefreshedUserId } from '@/lib/portal/integrations';
import { signSessionValue } from '@/lib/portal/auth/session-sig';

// Request calendar scope alongside gmail so one consent covers both connectors
// and the resulting refresh token can serve either API.
// 批次 36:加 gmail.send —— 支持在 Nesio 里直接回复/发送邮件(每封都由用户亲手写并点发送)。
// 加了新 scope 后老用户会被 prompt=consent 要求重新授权一次,拿到发送权限。
// 免费最大化·Google 扩展授权:一次授权覆盖后续 Drive 免费云备份 / Tasks / People。
// drive.appdata=非敏感(只碰 App 私有文件夹);tasks/contacts.readonly=敏感 scope
// (生产需 Google OAuth 验证审核,验证前有未验证警告与 100 用户上限)。
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/contacts.readonly';
const STATE_COOKIE = 'nesio_gmail_oauth_state';

function callbackUrl(req: NextRequest): string {
  const configured = envValue('GMAIL_REDIRECT_URI');
  if (configured) return configured;
  const url = new URL(req.url);
  return `${url.origin}/api/portal/gmail/callback`;
}

export async function GET(req: NextRequest) {
  // P0 隐私:连接私有数据源(邮箱)必须先登录。匿名授权 = 无主 token,
  // 挂在设备 cookie 上没法跨设备管理/撤销,下一个用这台设备的人能看到你的邮件。
  if (!(await isPortalRequestAuthorized(req))) {
    const url = new URL(req.url);
    return NextResponse.redirect(new URL('/login?reason=connect_requires_account', url.origin));
  }

  const clientId = envValue('GOOGLE_CLIENT_ID');
  const clientSecret = envValue('GOOGLE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { ok: false, error: 'provider_not_configured', missingEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
      { status: 503 },
    );
  }

  // iOS PWA 修:OAuth 跳转会被系统踢进独立存储的应用内浏览器,回调请求不带
  // 主环境的登录 cookie → token 落不进 Supabase(真源)。这里在**发起侧**(此刻
  // 一定是登录态,上面刚过鉴权门)把 userId 签名后随 state 带过去,回调凭签名
  // 归属 token,不再依赖回调环境的 cookie。签名用服务端密钥(session-sig),
  // 伪造不了;拿不到 uid 或没配密钥则退回旧 state,行为不变。
  const ts = Date.now();
  const uid = await getRefreshedUserId();
  const sig = uid ? signSessionValue(`nesio_gmail:${ts}:${uid}`) : '';
  const state = uid && sig ? `nesio_gmail:${ts}:${uid}:${sig}` : `nesio_gmail:${ts}`;
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
