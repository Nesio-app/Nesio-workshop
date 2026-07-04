/**
 * GET /api/portal/access — 登录用户领取服务器授予的访问角色。
 *
 * 权限管理的运行时出口:管理员在 /admin 给某用户设 access_role /
 * feature_flags 后,客户端在登录态下调这里领取:
 *   - role=personal_lab → 顺带下发 baohe_personal_lab cookie
 *     (path=/secretary,与 middleware lab 门同一约定),secretary 直接可进
 *   - featureFlags 里为 true 的模块 id → 客户端并入 testerAllowlist
 *
 * 语义:服务器授权只增不减——本机 URL/localStorage 的 lab 开关是
 * 所有者自己的工具,这里不清除它。未登录 → public。
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isRateLimited, isSameOriginRequest } from '@/lib/portal/api-auth';
import { getSupabaseUserId } from '@/lib/portal/integrations';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

export async function GET(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  if (isRateLimited(req, 'portal_access', { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const cookieStore = await cookies();
  const supabaseToken = cookieStore.get('baohe_auth_access')?.value || '';
  const anonymous = NextResponse.json(
    { ok: true, role: 'public', featureFlags: {} },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
  if (!supabaseToken) return anonymous;

  const url = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY') || envValue('SUPABASE_ANON_KEY');
  if (!url || !key) return anonymous;

  const userId = await getSupabaseUserId(supabaseToken);
  if (!userId) return anonymous;

  try {
    const res = await fetch(
      `${url}/rest/v1/user_profiles?user_id=eq.${userId}&select=access_role,feature_flags&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' },
    );
    if (!res.ok) return anonymous; // 列未建/读失败 → 按 public 优雅降级
    const rows = (await res.json()) as Array<{ access_role?: string; feature_flags?: Record<string, unknown> }>;
    const role = rows[0]?.access_role === 'personal_lab' ? 'personal_lab'
      : rows[0]?.access_role === 'tester' ? 'tester' : 'public';
    const flags: Record<string, boolean> = {};
    const raw = rows[0]?.feature_flags;
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') flags[k] = v;
    }
    const response = NextResponse.json(
      { ok: true, role, featureFlags: flags },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
    if (role === 'personal_lab') {
      // 与 middleware isSecretaryPageRequestAllowed 的 cookie 约定一致
      response.cookies.set('baohe_personal_lab', '1', {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.nextUrl.protocol === 'https:',
        path: '/secretary',
        maxAge: 60 * 60 * 24 * 7,
      });
    }
    return response;
  } catch {
    return anonymous;
  }
}
