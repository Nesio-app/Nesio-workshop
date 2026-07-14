/**
 * 服务端权益强制骨架(安全审计 #1:此前所有 Pro 门 100% 在客户端 —— localStorage 置 1
 * 即永久 Pro、已登录用户 curl 任何「Pro」路由都通)。这里给付费云 AI 路由一道**服务端**
 * 权益守卫,权益来源是真·后端(Supabase 表 / 将来 StoreKit 收据校验写入),客户端改不动。
 *
 * ⚠️ 默认 inert(不改变任何现有行为)。三重「未接源即放行」保证在你把真源接上前,线上
 *    体验一字不变:
 *      1. 总闸 NESIO_SERVER_ENTITLEMENT 未置 '1' → 一律 'unknown';
 *      2. 真源表名 NESIO_ENTITLEMENT_TABLE 未配 / 无 Supabase → 'unknown';
 *      3. 查询失败(表缺 / 网络抖)→ 'unknown'(绝不因基础设施抖动锁死真用户)。
 *    只有「总闸开 + 真源接上 + 明确查到非 pro」这唯一路径才判 'free' → 402 强制。
 *
 * 接真源(你在部署侧做):
 *   1. Supabase 建表 user_entitlements(user_id uuid PK/FK → auth.users, plan text
 *      default 'free', updated_at timestamptz)。开 RLS:仅本人可读、service_role 可写。
 *   2. StoreKit/支付回调服务端校验收据 → upsert 该表 plan='pro'|'free'。
 *   3. 部署环境置 NESIO_SERVER_ENTITLEMENT=1、NESIO_ENTITLEMENT_TABLE=user_entitlements。
 *   —— 无需改这里的代码,骨架即从 inert 转为强制。
 */
import { NextResponse } from 'next/server';
import { envValue } from '@/lib/portal/env';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';
import { getSupabaseUserId } from '@/lib/portal/integrations';

export type ServerTier = 'free' | 'pro' | 'unknown';

/** 服务端权益强制总闸。默认关(骨架 inert);真源接上后置 '1' 开启。 */
export function serverEntitlementEnforced(): boolean {
  return envValue('NESIO_SERVER_ENTITLEMENT') === '1';
}

/** 权益真源表名(列:user_id / plan)。未配 → 未接源。 */
function entitlementTable(): string {
  return envValue('NESIO_ENTITLEMENT_TABLE') || '';
}

/**
 * 读用户的服务端权益档。返回 'unknown' 表示「不强制」(总闸未开 / 真源未接 / 查询失败),
 * 调用方必须据此 fail-open。只有真源明确返回非 pro 才是 'free'。
 */
export async function readServerTier(accessToken: string | null): Promise<ServerTier> {
  if (!serverEntitlementEnforced()) return 'unknown';       // ① 总闸未开
  if (!accessToken) return 'unknown';
  const url = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  const table = entitlementTable();
  if (!url || !serviceKey || !table) return 'unknown';      // ② 真源未接
  try {
    const uid = await getSupabaseUserId(accessToken);
    if (!uid) return 'unknown';
    const res = await fetch(
      `${url}/rest/v1/${encodeURIComponent(table)}?user_id=eq.${encodeURIComponent(uid)}&select=plan`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, cache: 'no-store' },
    );
    if (!res.ok) return 'unknown';                           // ③ 查询失败 → 不锁真用户
    const rows = (await res.json()) as Array<{ plan?: string }>;
    const plan = Array.isArray(rows) ? rows[0]?.plan : undefined;
    if (plan === 'pro' || plan === 'premium') return 'pro';
    return 'free';                                           // 有源、明确非 pro → 唯一强制分支
  } catch {
    return 'unknown';
  }
}

/**
 * Pro 专属付费云 AI 路由的服务端权益守卫。返回 402 短路响应,或 null 放行。
 * fail-open:tier==='unknown' → 放行(骨架 inert);仅 'free' → 402。
 */
export async function guardServerEntitlement(accessToken: string | null, feature: string): Promise<NextResponse | null> {
  const tier = await readServerTier(accessToken);
  if (tier === 'free') {
    return NextResponse.json(
      { ok: false, error: 'pro_required', feature },
      { status: 402, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }
  return null;
}
