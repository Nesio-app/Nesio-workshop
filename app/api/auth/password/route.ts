/**
 * POST /api/auth/password — 邮箱+密码 注册 / 登录 / 修改密码(Supabase)。
 *
 * QA:「登录和注册功能一模一样」—— 此前邮箱只有 OTP 魔法链接,注册≈登录。
 * 补上经典密码流:注册设密码、登录填密码、账户页可改密码。魔法链接保留作无密码备选。
 *
 * mode:
 *  - register: /auth/v1/signup(开了邮箱确认时返回 needsEmailConfirm,不发会话)
 *  - login:    /auth/v1/token?grant_type=password → 种 baohe_auth_* cookie(与 OAuth 同款)
 *  - change:   需已登录(access cookie),PUT /auth/v1/user 改密码
 */

import { NextRequest, NextResponse } from 'next/server';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';
import { isRateLimited } from '@/lib/portal/api-auth';
import { AUTH_SIG_COOKIE, signSessionValue } from '@/lib/portal/auth/session-sig';

interface SupabaseSession { access_token?: string; refresh_token?: string; expires_in?: number }

function setAuthCookies(response: NextResponse, session: SupabaseSession) {
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = Number.isFinite(session.expires_in) && session.expires_in ? session.expires_in! : 60 * 60;
  if (session.access_token) {
    response.cookies.set('baohe_auth_access', session.access_token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge });
  }
  if (session.refresh_token) {
    response.cookies.set('baohe_auth_refresh', session.refresh_token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30 });
    const sig = signSessionValue(session.refresh_token); // 安全审计 #8:refresh 配套签名
    if (sig) response.cookies.set(AUTH_SIG_COOKIE, sig, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30 });
  }
}

export async function POST(req: NextRequest) {
  // 密码尝试是暴力破解面 —— 比普通路由更紧的限流
  if (isRateLimited(req, 'auth-password', { limit: 10 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const supabaseUrl = normalizeSupabaseRuntimeUrl(process.env.SUPABASE_URL || '');
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ ok: false, error: 'provider_not_configured' }, { status: 503 });
  }

  let body: { mode?: string; email?: string; password?: string; newPassword?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const mode = body.mode;
  const email = body.email?.trim().toLowerCase() || '';
  const password = body.password || '';

  if (mode === 'change') {
    const access = req.cookies.get('baohe_auth_access')?.value;
    if (!access) return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });
    const newPassword = body.newPassword || '';
    if (newPassword.length < 8) return NextResponse.json({ ok: false, error: 'password_too_short' }, { status: 400 });
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: anonKey, Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    if (!res.ok) {
      // access 过期等 —— 让前端引导重新登录后再改,不静默失败
      return NextResponse.json({ ok: false, error: res.status === 401 ? 'reauth_required' : 'change_failed' }, { status: res.status === 401 ? 401 : 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!email || !password) return NextResponse.json({ ok: false, error: 'missing_credentials' }, { status: 400 });
  if (mode === 'register' && password.length < 8) {
    return NextResponse.json({ ok: false, error: 'password_too_short' }, { status: 400 });
  }

  if (mode === 'register') {
    const res = await fetch(`${supabaseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json() as SupabaseSession & { msg?: string; error_description?: string; user?: unknown };
    if (!res.ok) {
      const text = `${data.msg || ''} ${data.error_description || ''}`.toLowerCase();
      const error = text.includes('already') ? 'user_already_exists' : 'signup_failed';
      return NextResponse.json({ ok: false, error }, { status: 400 });
    }
    // Supabase 开了邮箱确认 → 无会话返回:让用户去邮箱点确认
    if (!data.access_token) return NextResponse.json({ ok: true, needsEmailConfirm: true });
    const response = NextResponse.json({ ok: true });
    setAuthCookies(response, data);
    return response;
  }

  if (mode === 'login') {
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json() as SupabaseSession & { error_description?: string };
    if (!res.ok || !data.access_token) {
      return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true });
    setAuthCookies(response, data);
    return response;
  }

  return NextResponse.json({ ok: false, error: 'unsupported_mode' }, { status: 400 });
}
