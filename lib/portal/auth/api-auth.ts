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
import { AUTH_SIG_COOKIE, WECHAT_SIG_COOKIE, verifySessionValue } from './session-sig';
import { guardServerEntitlement } from './server-entitlement';

/** 常量时间比较两个密钥(避免用 === 短路比较带来的计时侧信道)。空/不等长直接判否。 */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

// 批次 83(安全审计 #2 实锤):此前只验「cookie 存在」—— curl 带一个
// baohe_auth_access=x 假 cookie 就能通过全部 AI 路由,只剩限流在挡,
// 换 IP 就能烧配额。access token 现在必须过 Supabase /auth/v1/user 验真,
// 结果按 token 进内存 TTL 缓存(命中零开销;网络故障放行但记日志,
// 可用性优先 —— 假 token 是 401 不是网络错,照样拒)。
const tokenVerifyCache = new Map<string, { ok: boolean; exp: number }>();
const TOKEN_CACHE_TTL = 5 * 60_000;
const TOKEN_CACHE_MAX = 500;

async function verifySupabaseAccessToken(token: string): Promise<boolean> {
  const url = envValue('SUPABASE_URL');
  const anon = envValue('SUPABASE_ANON_KEY');
  if (!url || !anon) return true; // 无 Supabase 的本地部署:门不能比 UI 更严
  const now = Date.now();
  const hit = tokenVerifyCache.get(token);
  if (hit && hit.exp > now) return hit.ok;
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    });
    const ok = res.ok;
    if (tokenVerifyCache.size >= TOKEN_CACHE_MAX) tokenVerifyCache.clear();
    tokenVerifyCache.set(token, { ok, exp: now + (ok ? TOKEN_CACHE_TTL : 60_000) });
    return ok;
  } catch (err) {
    console.error('[api-auth] token_verify_network_error', err instanceof Error ? err.message : err);
    return true; // 网络抖动不锁死真用户;伪造 token 走的是 401 分支
  }
}

export async function isPortalRequestAuthorized(req: NextRequest, opts?: { allowCrossOrigin?: boolean }): Promise<boolean> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('baohe_auth_access')?.value || '';
  if (accessToken) {
    return verifySupabaseAccessToken(accessToken);
  }
  // access 过期后的回退分支(安全审计 #8):cookie 是客户端可写的,只看「存在」= 伪造
  // baohe_auth_refresh=x 即可白嫖云 AI(denial-of-wallet)。改为要求配套 HMAC 签名匹配 ——
  // 只有服务端能产出合法签名,伪造/无签名的 cookie 一律拒。签发处见 session-sig 的调用方。
  const refresh = cookieStore.get('baohe_auth_refresh')?.value || '';
  if (refresh && verifySessionValue(refresh, cookieStore.get(AUTH_SIG_COOKIE)?.value)) return true;
  const wechatOpenid = cookieStore.get('baohe_wechat_openid')?.value || '';
  if (wechatOpenid && verifySessionValue(wechatOpenid, cookieStore.get(WECHAT_SIG_COOKIE)?.value)) return true;

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
  opts?: { limit?: number; windowMs?: number; allowCrossOrigin?: boolean; requirePaidCloudAi?: boolean },
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
  // 安全审计 #1:付费云 AI 路由的服务端权益强制。默认 inert(真源未接 → fail-open 放行);
  // 真源接上 + 总闸开后,免费用户 → 402。客户端门(guardPaidCloudAi)是纵深,这是唯一强制点。
  if (opts?.requirePaidCloudAi) {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get('baohe_auth_access')?.value || null;
    const gate = await guardServerEntitlement(accessToken, routeId);
    if (gate) return gate;
  }
  return null;
}
