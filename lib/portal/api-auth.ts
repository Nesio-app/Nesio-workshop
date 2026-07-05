/**
 * API Auth Guard — one gate for every route that spends money (AI calls)
 * or touches private data.
 *
 * Before this module, 14 AI-calling routes (chat, tts, daily-brief, …) had
 * no auth at all: anyone who found the URL could burn the deployment's
 * Anthropic/Gemini/OpenAI quota — the "Denial of Wallet" attack pattern.
 * The gate below mirrors the triple check the gmail/calendar routes already
 * used, so behavior for legitimate users is unchanged:
 *
 *   1. Signed-in session (baohe_auth_* / wechat cookies), or
 *   2. Stage-5 lab secret header, or
 *   3. No Supabase configured → personal/local deployment, everything local.
 *
 * Plus a per-IP in-memory rate limit. On serverless each instance keeps its
 * own window, so this is burst protection, not a hard global quota — good
 * enough to break naive abuse loops; upgrade path is Vercel KV / Upstash.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authorizeDecision, createRateLimiter } from './api-auth-core.mjs';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
// 判定逻辑见 api-auth-core.mjs(纯函数,有行为测试);这里只收集请求/cookie/env 值。

export async function isPortalRequestAuthorized(req: NextRequest, opts?: { allowCrossOrigin?: boolean }): Promise<boolean> {
  const cookieStore = await cookies();
  const hasSession = Boolean(
    cookieStore.get('baohe_auth_access')?.value ||
      cookieStore.get('baohe_auth_refresh')?.value ||
      cookieStore.get('baohe_wechat_openid')?.value,
  );
  const originValues = ['origin', 'referer']
    .map((h) => req.headers.get(h))
    .filter((v): v is string => Boolean(v));
  return authorizeDecision({
    hasSession,
    stage5Secret: envValue('NESIO_STAGE5_INVOCATION_SECRET'),
    providedStage5: req.headers.get('x-nesio-stage5-secret')?.trim() || '',
    // No Supabase → personal/local deployment where the UI itself is open; the
    // gate can't be stricter than the UI, so it falls back to a same-origin check.
    noSupabase: !envValue('SUPABASE_URL') || !envValue('SUPABASE_ANON_KEY'),
    // Capacitor iOS shells (CORS *) skip the origin check — capacitor:// never
    // matches host; rate limiting still applies.
    allowCrossOrigin: Boolean(opts?.allowCrossOrigin),
    host: req.headers.get('host') || '',
    originValues,
  });
}

/**
 * 同源守卫(不要求登录)— 供「匿名合法」的路由使用(如 /api/telemetry:
 * 设计上收匿名设备级计数)。浏览器带 Origin/Referer 时必须匹配本 host,
 * 挡跨站脚本和扫描器;直连 curl 类滥用交给限流。
 */
export function isSameOriginRequest(req: NextRequest): boolean {
  const host = req.headers.get('host') || '';
  for (const header of ['origin', 'referer']) {
    const value = req.headers.get(header);
    if (!value) continue;
    try {
      if (new URL(value).host !== host) return false;
    } catch { return false; }
  }
  return true;
}

// ── Rate limit (per-instance, per-IP) ─────────────────────────────────────────

const limiter = createRateLimiter({ maxTrackedKeys: 5000 });

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

export function isRateLimited(
  req: NextRequest,
  routeId: string,
  { limit = 30, windowMs = 60_000 }: { limit?: number; windowMs?: number } = {},
): boolean {
  const key = `${routeId}:${clientIp(req)}`;
  return limiter.check(key, Date.now(), { limit, windowMs });
}

// ── Combined guard for AI routes ──────────────────────────────────────────────

/**
 * Returns an error response to short-circuit with, or null to proceed.
 * Usage at the top of a handler:
 *   const guard = guardAiRoute(req, 'chat');
 *   if (guard) return guard;
 */
export async function guardAiRoute(
  req: NextRequest,
  routeId: string,
  opts?: { limit?: number; windowMs?: number; allowCrossOrigin?: boolean },
): Promise<NextResponse | null> {
  if (!(await isPortalRequestAuthorized(req, opts))) {
    return NextResponse.json(
      { ok: false, error: 'auth_required' },
      { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }
  if (isRateLimited(req, routeId, opts)) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited', retryAfterMs: 30_000 },
      { status: 429, headers: { 'Retry-After': '30' } },
    );
  }
  return null;
}
