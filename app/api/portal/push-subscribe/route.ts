/**
 * POST/DELETE /api/portal/push-subscribe —— Web Push 订阅登记(Step 6,2026-07-29)。
 * 设置页「重要提醒推送」开关打开 → 浏览器 PushManager.subscribe → 存到
 * user_push_subscriptions(identity_key + endpoint 主键,service-role 写,RLS 拒直连)。
 * 发送端在 guidance-judge 路由(severity 3 判决出卡即推)。
 * 未配 Supabase / 未登录 → 501/401,inert 不装死。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';
import { getCloudConfig, getSignedInUser, serviceRoleRestHeaders } from '@/lib/portal/cloud-server-runtime';

export const dynamic = 'force-dynamic';

async function resolveIdentity() {
  const config = getCloudConfig();
  if (!config.enabled) return { config: null, identity: null } as const;
  const { user } = await getSignedInUser(config);
  const identity = deriveCloudIdentity(user);
  return { config, identity } as const;
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'push_subscribe', { limit: 10 });
  if (guard) return guard;
  const { config, identity } = await resolveIdentity();
  if (!config) return NextResponse.json({ ok: false, error: 'cloud_disabled' }, { status: 501 });
  if (!identity) return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { subscription?: { endpoint?: string } } | null;
  const sub = body?.subscription;
  if (!sub?.endpoint || typeof sub.endpoint !== 'string') {
    return NextResponse.json({ ok: false, error: 'bad_subscription' }, { status: 400 });
  }
  const res = await fetch(`${config.supabaseUrl}/rest/v1/user_push_subscriptions`, {
    method: 'POST',
    headers: serviceRoleRestHeaders(config, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify([{ identity_key: identity.identityKey, endpoint: sub.endpoint.slice(0, 500), subscription: sub }]),
  });
  if (!res.ok) return NextResponse.json({ ok: false, error: `store_${res.status}` }, { status: 502 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const guard = await guardAiRoute(req, 'push_subscribe', { limit: 10 });
  if (guard) return guard;
  const { config, identity } = await resolveIdentity();
  if (!config) return NextResponse.json({ ok: false, error: 'cloud_disabled' }, { status: 501 });
  if (!identity) return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) return NextResponse.json({ ok: false, error: 'bad_endpoint' }, { status: 400 });
  const url = `${config.supabaseUrl}/rest/v1/user_push_subscriptions?identity_key=eq.${encodeURIComponent(identity.identityKey)}&endpoint=eq.${encodeURIComponent(body.endpoint)}`;
  await fetch(url, { method: 'DELETE', headers: serviceRoleRestHeaders(config) });
  return NextResponse.json({ ok: true });
}
