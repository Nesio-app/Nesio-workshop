/**
 * /api/admin/users — 用户权限管理(管理面板专用)。
 *
 * GET:列用户(邮箱/provider/角色/功能开关/注册时间)。
 * PATCH:改某用户的 access_role(public/tester/personal_lab)或
 *        feature_flags(模块布尔开关,进该用户的 testerAllowlist)。
 *
 * 服务器角色是权威源:客户端登录后经 /api/portal/access 领取生效。
 * 门禁:requireAdmin(同源 + NESIO_ADMIN_SECRET + 限流)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/portal/admin-gate';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

const ROLES = ['public', 'tester', 'personal_lab'] as const;
type AccessRole = (typeof ROLES)[number];

function restHeaders() {
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY') || envValue('SUPABASE_ANON_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function restUrl(path: string): string | null {
  const url = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  return url ? `${url}/rest/v1/${path}` : null;
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req, 'admin_users');
  if (gate) return gate;
  const url = restUrl('user_profiles?select=identity_key,email,provider,display_name,access_role,feature_flags,created_at&order=created_at.desc&limit=200');
  if (!url) return NextResponse.json({ ok: false, error: 'cloud_not_configured' }, { status: 503 });
  try {
    const res = await fetch(url, { headers: restHeaders(), cache: 'no-store' });
    if (!res.ok) {
      const missingColumns = res.status === 400; // access_role 列未建
      return NextResponse.json(
        { ok: false, error: missingColumns ? 'columns_missing' : `http_${res.status}`, hint: missingColumns ? '在 Supabase SQL Editor 执行 schema bundle 的 Access control 段(加 access_role/feature_flags 列)' : undefined },
        { status: 502 },
      );
    }
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return NextResponse.json({
      ok: true,
      users: rows.map((r) => ({
        identityKey: r.identity_key,
        email: r.email || null,
        provider: r.provider || null,
        displayName: r.display_name || null,
        accessRole: (ROLES as readonly string[]).includes(String(r.access_role)) ? r.access_role : 'public',
        featureFlags: r.feature_flags && typeof r.feature_flags === 'object' ? r.feature_flags : {},
        createdAt: r.created_at || null,
      })),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'fetch_failed' }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest) {
  const gate = requireAdmin(req, 'admin_users');
  if (gate) return gate;
  const body = (await req.json().catch(() => null)) as { identityKey?: string; accessRole?: string; featureFlags?: Record<string, unknown> } | null;
  const identityKey = typeof body?.identityKey === 'string' ? body.identityKey.trim() : '';
  if (!identityKey) return NextResponse.json({ ok: false, error: 'identity_key_required' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body?.accessRole !== undefined) {
    if (!(ROLES as readonly string[]).includes(String(body.accessRole))) {
      return NextResponse.json({ ok: false, error: 'invalid_role' }, { status: 400 });
    }
    patch.access_role = body.accessRole as AccessRole;
  }
  if (body?.featureFlags !== undefined) {
    const flags: Record<string, boolean> = {};
    if (body.featureFlags && typeof body.featureFlags === 'object' && !Array.isArray(body.featureFlags)) {
      for (const [k, v] of Object.entries(body.featureFlags)) {
        if (/^[a-z0-9_-]{1,32}$/.test(k) && typeof v === 'boolean') flags[k] = v;
      }
    }
    patch.feature_flags = flags;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing_to_update' }, { status: 400 });
  }

  const url = restUrl(`user_profiles?identity_key=eq.${encodeURIComponent(identityKey)}`);
  if (!url) return NextResponse.json({ ok: false, error: 'cloud_not_configured' }, { status: 503 });
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...restHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: `http_${res.status}` }, { status: 502 });
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!rows.length) return NextResponse.json({ ok: false, error: 'user_not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, accessRole: rows[0].access_role, featureFlags: rows[0].feature_flags });
  } catch {
    return NextResponse.json({ ok: false, error: 'fetch_failed' }, { status: 502 });
  }
}
