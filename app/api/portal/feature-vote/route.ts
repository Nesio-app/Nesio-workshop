/**
 * /api/portal/feature-vote — Roadmap 功能评分。
 *
 * POST { featureId, score(1-5), deviceId }:按 (feature, device) upsert,
 * 改分覆盖。GET ?deviceId=:全部功能的 平均分/票数 + 本设备已投分。
 * featureId 必须在 lib/portal/roadmap.ts 注册表内(防垃圾写入)。
 * 匿名合法(与遥测同一 deviceId 语义):同源 + 限流,不要求会话。
 */
import { NextRequest, NextResponse } from 'next/server';
import { isRateLimited, isSameOriginRequest } from '@/lib/portal/api-auth';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';
import { ROADMAP_ITEMS } from '@/lib/portal/roadmap';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

function rest(): { url: string; headers: Record<string, string> } | null {
  const base = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY') || envValue('SUPABASE_ANON_KEY');
  if (!base || !key) return null;
  return { url: `${base}/rest/v1/feature_votes`, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

const VALID_IDS = new Set(ROADMAP_ITEMS.map((i) => i.id));

function sanitizeDeviceId(raw: unknown): string {
  return typeof raw === 'string' ? raw.slice(0, 40) : '';
}

export async function GET(req: NextRequest) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ ok: false }, { status: 403 });
  if (isRateLimited(req, 'feature_vote', { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }
  const api = rest();
  if (!api) return NextResponse.json({ ok: true, items: [], cloud: false });
  const deviceId = sanitizeDeviceId(req.nextUrl.searchParams.get('deviceId'));
  try {
    const res = await fetch(`${api.url}?select=feature_id,device_id,score`, { headers: api.headers, cache: 'no-store' });
    if (res.status === 404) return NextResponse.json({ ok: true, items: [], cloud: false, error: 'table_missing' });
    if (!res.ok) return NextResponse.json({ ok: false, error: `http_${res.status}` }, { status: 502 });
    const rows = (await res.json()) as Array<{ feature_id: string; device_id: string; score: number }>;
    const agg = new Map<string, { sum: number; count: number; mine: number | null }>();
    for (const r of rows) {
      if (!agg.has(r.feature_id)) agg.set(r.feature_id, { sum: 0, count: 0, mine: null });
      const a = agg.get(r.feature_id)!;
      a.sum += r.score; a.count += 1;
      if (deviceId && r.device_id === deviceId) a.mine = r.score;
    }
    return NextResponse.json({
      ok: true,
      cloud: true,
      items: [...agg.entries()].map(([featureId, a]) => ({
        featureId, avg: Math.round((a.sum / a.count) * 10) / 10, count: a.count, mine: a.mine,
      })),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'fetch_failed' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ ok: false }, { status: 403 });
  if (isRateLimited(req, 'feature_vote', { limit: 20, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { featureId?: string; score?: number; deviceId?: string } | null;
  const featureId = typeof body?.featureId === 'string' ? body.featureId : '';
  const score = Number(body?.score);
  const deviceId = sanitizeDeviceId(body?.deviceId);
  if (!VALID_IDS.has(featureId)) return NextResponse.json({ ok: false, error: 'unknown_feature' }, { status: 400 });
  if (!Number.isInteger(score) || score < 1 || score > 5) return NextResponse.json({ ok: false, error: 'invalid_score' }, { status: 400 });
  if (!deviceId) return NextResponse.json({ ok: false, error: 'device_required' }, { status: 400 });

  const api = rest();
  if (!api) return NextResponse.json({ ok: false, error: 'cloud_not_configured' }, { status: 503 });
  try {
    const res = await fetch(`${api.url}?on_conflict=feature_id,device_id`, {
      method: 'POST',
      headers: { ...api.headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{ feature_id: featureId, device_id: deviceId, score }]),
    });
    if (res.status === 404) return NextResponse.json({ ok: false, error: 'table_missing' }, { status: 503 });
    if (!res.ok) return NextResponse.json({ ok: false, error: `http_${res.status}` }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'fetch_failed' }, { status: 502 });
  }
}
