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

/** 服务端账号级权益详情(供 /api/entitlements 回传客户端展示)。 */
export interface ServerEntitlementDetail {
  tier: ServerTier;
  /** 'pro' | 'premium' | 'trial' | 'free' | null(unknown 时) */
  plan: string | null;
  /** 试用剩余天数(0 = 无试用/已过);仅 tier 由试用判定时 > 0。 */
  trialDaysLeft: number;
}

/** 免费试用期(与客户端 entitlement.TRIAL_DAYS 对齐)。 */
const SERVER_TRIAL_DAYS = 21;

/** 服务端权益强制总闸。默认关(骨架 inert);真源接上后置 '1' 开启。 */
export function serverEntitlementEnforced(): boolean {
  return envValue('NESIO_SERVER_ENTITLEMENT') === '1';
}

/**
 * 权益真源表名(列:user_id / plan / trial_started_at ...)。
 * 默认 'user_entitlements'(= supabase-user-entitlements-v1.sql 建的那张表),与写侧
 * writeEntitlementByUid 一致 —— 修「读写不对称」footgun:此前读侧未配 NESIO_ENTITLEMENT_TABLE
 * 就退空→resolveEntitlementContext 返回 null→tier 'unknown',而写侧默认写 user_entitlements,
 * 结果 Stripe 付了钱写进了表、app 却读不出 Pro(付费不生效)。总闸 NESIO_SERVER_ENTITLEMENT
 * 仍是唯一开关(未开一律 inert),置 '1' 即够,不必再单独配表名。
 */
function entitlementTable(): string {
  return envValue('NESIO_ENTITLEMENT_TABLE') || 'user_entitlements';
}

/** 解析强制上下文:总闸开 + supabase 配齐 + 真实 uid。任一缺失 → null(fail-open)。 */
async function resolveEntitlementContext(accessToken: string | null): Promise<
  { url: string; serviceKey: string; table: string; uid: string } | null
> {
  if (!serverEntitlementEnforced()) return null;            // ① 总闸未开
  if (!accessToken) return null;
  const url = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  const table = entitlementTable();
  if (!url || !serviceKey || !table) return null;           // ② 真源未接
  const uid = await getSupabaseUserId(accessToken);
  if (!uid) return null;
  return { url, serviceKey, table, uid };
}

function trialDaysLeftFrom(startedAt: string | null | undefined): number {
  if (!startedAt) return 0;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return 0;
  const used = (Date.now() - start) / 86_400_000;
  return Math.max(0, Math.ceil(SERVER_TRIAL_DAYS - used));
}

/**
 * 首登兜底:确保用户在真源表有一行、并落试用起点(账号级,防清缓存/重装重置 —— 报告 #6)。
 * on_conflict=user_id + ignore-duplicates:已有行原样保留(不覆盖 plan / 已有 trial 起点)。
 * best-effort:总闸未开/未接源/失败都静默(不阻塞登录)。
 */
export async function ensureServerEntitlementRow(accessToken: string | null): Promise<void> {
  const ctx = await resolveEntitlementContext(accessToken);
  if (!ctx) return;
  try {
    const nowIso = new Date().toISOString();
    await fetch(`${ctx.url}/rest/v1/${encodeURIComponent(ctx.table)}?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        apikey: ctx.serviceKey,
        Authorization: `Bearer ${ctx.serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify([{ user_id: ctx.uid, plan: 'free', trial_started_at: nowIso }]),
      cache: 'no-store',
    });
  } catch {
    /* best-effort */
  }
}

/**
 * 读账号级权益详情。tier==='unknown' 表示「不强制」(总闸未开/未接源/查询失败),调用方 fail-open。
 * 判定顺序:① 付费 Pro(plan pro/premium 且订阅未过期)→ pro;② 试用未过 → pro(trial);③ 其余 free。
 */
export async function readServerEntitlementDetail(accessToken: string | null): Promise<ServerEntitlementDetail> {
  const ctx = await resolveEntitlementContext(accessToken);
  if (!ctx) return { tier: 'unknown', plan: null, trialDaysLeft: 0 };
  try {
    const res = await fetch(
      `${ctx.url}/rest/v1/${encodeURIComponent(ctx.table)}?user_id=eq.${encodeURIComponent(ctx.uid)}&select=plan,trial_started_at,current_period_end`,
      { headers: { apikey: ctx.serviceKey, Authorization: `Bearer ${ctx.serviceKey}` }, cache: 'no-store' },
    );
    if (!res.ok) return { tier: 'unknown', plan: null, trialDaysLeft: 0 }; // ③ 查询失败 → 不锁真用户
    const rows = (await res.json()) as Array<{ plan?: string; trial_started_at?: string; current_period_end?: string }>;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    const plan = row?.plan;
    const periodOk = !row?.current_period_end || Date.parse(row.current_period_end) > Date.now();
    if ((plan === 'pro' || plan === 'premium') && periodOk) {
      return { tier: 'pro', plan, trialDaysLeft: 0 };
    }
    const trialLeft = trialDaysLeftFrom(row?.trial_started_at);
    if (trialLeft > 0) return { tier: 'pro', plan: 'trial', trialDaysLeft: trialLeft };
    return { tier: 'free', plan: plan || 'free', trialDaysLeft: 0 };      // 有源、明确非 pro → 强制
  } catch {
    return { tier: 'unknown', plan: null, trialDaysLeft: 0 };
  }
}

/**
 * 读用户的服务端权益 tier。返回 'unknown' 表示「不强制」,调用方必须据此 fail-open。
 */
export async function readServerTier(accessToken: string | null): Promise<ServerTier> {
  return (await readServerEntitlementDetail(accessToken)).tier;
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

/**
 * 按 uid 直接 upsert 权益(Stripe webhook 用:收据校验后写 plan)。不经 accessToken —— uid
 * 来自已验签的 Stripe 事件(client_reference_id / subscription.metadata.user_id)。
 * merge-duplicates:只覆盖传入列(plan/stripe_* 等),不动 trial_started_at。
 * gate 在 supabase 配置(不 gate 总闸:收到钱就该记账,总闸只控「是否强制」)。best-effort。
 */
export async function writeEntitlementByUid(userId: string, patch: Record<string, unknown>): Promise<boolean> {
  const url = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  const table = entitlementTable() || 'user_entitlements';
  if (!url || !serviceKey || !userId) return false;
  try {
    const res = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{ user_id: userId, ...patch, updated_at: new Date().toISOString() }]),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}
