/**
 * 管理员门禁 — /api/admin/* 共用:同源 + NESIO_ADMIN_SECRET 头 + 限流。
 * 无 Supabase 的本地部署放行(与 UI 同宽)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest, isRateLimited, safeEqual } from '@/lib/portal/api-auth';
import { envValue } from '@/lib/portal/env';

/** 返回错误响应用于短路,或 null 放行。 */
export function requireAdmin(req: NextRequest, routeId: string): NextResponse | null {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  if (isRateLimited(req, routeId, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }
  const hasSupabase = Boolean(envValue('SUPABASE_URL') && envValue('SUPABASE_ANON_KEY'));
  if (!hasSupabase) return null;
  const secret = envValue('NESIO_ADMIN_SECRET');
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'admin_not_configured', hint: 'Vercel 环境变量设置 NESIO_ADMIN_SECRET 后重新部署' },
      { status: 503 },
    );
  }
  const provided = req.headers.get('x-nesio-admin-secret')?.trim() || '';
  if (!safeEqual(provided, secret)) {
    return NextResponse.json({ ok: false, error: 'admin_secret_required' }, { status: 401 });
  }
  return null;
}
