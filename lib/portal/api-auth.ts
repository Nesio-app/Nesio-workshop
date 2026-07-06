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
import { timingSafeEqual } from 'node:crypto';
import { envValue } from '@/lib/portal/env';

/** 常量时间比较两个密钥(避免用 === 短路比较带来的计时侧信道)。空/不等长直接判否。 */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function isPortalRequestAuthorized(req: NextRequest, opts?: { allowCrossOrigin?: boolean }): Promise<boolean> {
  const cookieStore = await cookies();
  const hasSession = Boolean(
    cookieStore.get('baohe_auth_access')?.value ||
      cookieStore.get('baohe_auth_refresh')?.value ||
      cookieStore.get('baohe_wechat_openid')?.value,
  );
  if (hasSession) return true;

  const stage5 = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const provided = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  if (stage5 && safeEqual(provided, stage5)) return true;

  // No Supabase → personal/local deployment where the UI itself is open.
  // The auth gate can't be stricter than the UI, but we can require the
  // request to come from our own pages: when a browser sends Origin/Referer
  // it must match this host. Blocks cross-site scripts and dumb scanners;
  // rate limiting (below) handles direct curl-style abuse.
  const noSupabase = !envValue('SUPABASE_URL') || !envValue('SUPABASE_ANON_KEY');
  if (!noSupabase) return false;
  // Routes serving the Capacitor iOS shells (CORS *) skip the origin check
  // — capacitor:// origins never match the host; rate limiting still applies.
  if (opts?.allowCrossOrigin) return true;
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

interface Window { count: number; resetAt: number }
const windows = new Map<string, Window>();
const MAX_TRACKED_KEYS = 5000;

function clientIp(req: NextRequest): string {
  // 平台设置的头(不可被客户端伪造)优先;x-forwarded-for 最左值是客户端可控的,取了它
  // 攻击者轮换该 header 就能让每个请求落到不同 key、绕过 per-IP 限流。故:
  //   x-real-ip / x-vercel-forwarded-for(平台真实客户端 IP)→ 否则取 XFF 最右一跳(最接近服务器)。
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const vercel = req.headers.get('x-vercel-forwarded-for')?.trim();
  if (vercel) return vercel.split(',').pop()!.trim();
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',').pop()!.trim();
  return 'unknown';
}

export function isRateLimited(
  req: NextRequest,
  routeId: string,
  { limit = 30, windowMs = 60_000 }: { limit?: number; windowMs?: number } = {},
): boolean {
  const key = `${routeId}:${clientIp(req)}`;
  const now = Date.now();
  const win = windows.get(key);
  if (!win || win.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) {
      // 不要 windows.clear() 清空所有人(否则喷满 5000 key 即可把全体限流计数清零、放大滥用)。
      // 先驱逐已过期项;仍满则删最早到期的一个,给新 key 腾位。
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      if (windows.size >= MAX_TRACKED_KEYS) {
        let oldestKey: string | undefined;
        let oldest = Infinity;
        for (const [k, w] of windows) if (w.resetAt < oldest) { oldest = w.resetAt; oldestKey = k; }
        if (oldestKey) windows.delete(oldestKey);
      }
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  win.count++;
  return win.count > limit;
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
