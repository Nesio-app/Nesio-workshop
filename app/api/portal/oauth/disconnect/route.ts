/**
 * POST /api/portal/oauth/disconnect
 * Actually revokes the Google OAuth grant and clears token cookies.
 *
 * Before this route, "断开" only flipped a localStorage flag — the
 * HTTP-only refresh token cookie (90 days) stayed alive and the grant
 * remained valid at Google's side. Disconnect now means revoke.
 *
 * Note: gmail + calendar share one consent (scopes unified), so revoking
 * either refresh token kills the whole grant — both providers' cookies
 * are cleared and the client marks both connectors disconnected.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isPortalRequestAuthorized, isRateLimited } from '@/lib/portal/api-auth';
import { getSupabaseUserId, readIntegrations, writeIntegrations } from '@/lib/portal/integrations';

export const dynamic = 'force-dynamic';

const COOKIE_NAMES = [
  'nesio_gmail_access',
  'nesio_gmail_refresh',
  'nesio_google_calendar_access',
  'nesio_google_calendar_refresh',
];

async function revokeAtGoogle(token: string): Promise<boolean> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    return res.ok;
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  if (!(await isPortalRequestAuthorized(req))) {
    return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });
  }
  if (isRateLimited(req, 'oauth_disconnect', { limit: 10 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const cookieStore = await cookies();
  // Revoking any live token invalidates the shared grant; try refresh
  // tokens first (kills the grant), fall back to access tokens.
  const candidates = [
    cookieStore.get('nesio_gmail_refresh')?.value,
    cookieStore.get('nesio_google_calendar_refresh')?.value,
    cookieStore.get('nesio_gmail_access')?.value,
    cookieStore.get('nesio_google_calendar_access')?.value,
  ].filter((v): v is string => Boolean(v));

  // Supabase 才是登录用户 token 的真源(跨设备;iOS PWA 环境下 cookie 常为空)。
  // 只撤 cookie 不动 Supabase = 「断开」后服务端照样能拉邮件,且 UI 按服务端
  // 真源合并后会立刻又显示已连接。这里把 Supabase 里的 token 一并纳入撤销
  // 候选,撤销后删行。
  const supabaseToken = cookieStore.get('baohe_auth_access')?.value;
  let userId: string | null = null;
  let integrationMap: Awaited<ReturnType<typeof readIntegrations>> = null;
  if (supabaseToken) {
    userId = await getSupabaseUserId(supabaseToken);
    if (userId) {
      integrationMap = await readIntegrations(userId, supabaseToken);
      for (const provider of ['gmail', 'calendar'] as const) {
        const t = integrationMap?.[provider];
        if (t?.refreshToken) candidates.push(t.refreshToken);
        if (t?.accessToken) candidates.push(t.accessToken);
      }
    }
  }

  let revoked = false;
  for (const token of candidates) {
    if (await revokeAtGoogle(token)) { revoked = true; break; }
  }

  // 云端断连:删掉 gmail/calendar 两行(其余 provider 不动)。读失败时不以
  // 「空」覆写 —— 见 /api/portal/integrations DELETE 的同款保护。
  if (userId && supabaseToken && integrationMap && (integrationMap.gmail || integrationMap.calendar)) {
    delete integrationMap.gmail;
    delete integrationMap.calendar;
    await writeIntegrations(userId, supabaseToken, integrationMap);
  }

  const response = NextResponse.json({
    ok: true,
    revoked,
    hadTokens: candidates.length > 0,
  });
  const secure = process.env.NODE_ENV === 'production';
  for (const name of COOKIE_NAMES) {
    response.cookies.set(name, '', { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 0 });
  }
  return response;
}
