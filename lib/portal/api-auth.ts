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
import { cookies, type UnsafeUnwrappedCookies } from 'next/headers';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function isPortalRequestAuthorized(req: NextRequest, opts?: { allowCrossOrigin?: boolean }): boolean {
  const cookieStore = (cookies() as unknown as UnsafeUnwrappedCookies);
  const hasSession = Boolean(
    cookieStore.get('baohe_auth_access')?.value ||
      cookieStore.get('baohe_auth_refresh')?.value ||
      cookieStore.get('baohe_wechat_openid')?.value,
  );
  if (hasSession) return true;

  const stage5 = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const provided = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  if (stage5 && provided === stage5) return true;

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

// ── Rate limit (per-instance, per-IP) ─────────────────────────────────────────

interface Window { count: number; resetAt: number }
const windows = new Map<string, Window>();
const MAX_TRACKED_KEYS = 5000;

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
  const now = Date.now();
  const win = windows.get(key);
  if (!win || win.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) windows.clear(); // crude memory bound
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
export function guardAiRoute(
  req: NextRequest,
  routeId: string,
  opts?: { limit?: number; windowMs?: number; allowCrossOrigin?: boolean },
): NextResponse | null {
  if (!isPortalRequestAuthorized(req, opts)) {
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
