/**
 * GET /api/admin/metrics — 管理员数据面板的聚合只读 API。
 *
 * 数据源(都在自己的 Supabase,不出境):
 *   - telemetry_events:匿名设备级事件计数(schema bundle 2026-07-04 补表)
 *   - product_events:用户确认过的反馈/交互(今日卡反馈等)
 *
 * 门禁:同源 + x-nesio-admin-secret 匹配 NESIO_ADMIN_SECRET + 限流。
 * 无 Supabase 的本地部署直接放行(与 UI 同宽)。聚合在服务端完成,
 * 只回统计数字,不回原始行。
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest, isRateLimited } from '@/lib/portal/api-auth';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

interface TelemetryRow { name: string; device_id: string; at: string; props?: Record<string, unknown> }
interface ProductEventRow { event_type: string; feedback: string | null; target_type: string | null; created_at: string }

async function supabaseSelect<T>(path: string): Promise<{ rows: T[]; error?: string }> {
  const url = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY') || envValue('SUPABASE_ANON_KEY');
  if (!url || !key) return { rows: [], error: 'cloud_not_configured' };
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (res.status === 404) return { rows: [], error: 'table_missing' };
    if (!res.ok) return { rows: [], error: `http_${res.status}` };
    return { rows: (await res.json()) as T[] };
  } catch {
    return { rows: [], error: 'fetch_failed' };
  }
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export async function GET(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  if (isRateLimited(req, 'admin_metrics', { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }
  const hasSupabase = Boolean(envValue('SUPABASE_URL') && envValue('SUPABASE_ANON_KEY'));
  if (hasSupabase) {
    const secret = envValue('NESIO_ADMIN_SECRET');
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: 'admin_not_configured', hint: 'Vercel 环境变量设置 NESIO_ADMIN_SECRET 后重新部署' },
        { status: 503 },
      );
    }
    const provided = req.headers.get('x-nesio-admin-secret')?.trim() || '';
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: 'admin_secret_required' }, { status: 401 });
    }
  }

  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [telemetry, product] = await Promise.all([
    supabaseSelect<TelemetryRow>(
      `telemetry_events?select=name,device_id,at&at=gte.${since30}&order=at.desc&limit=10000`,
    ),
    supabaseSelect<ProductEventRow>(
      `product_events?select=event_type,feedback,target_type,created_at&created_at=gte.${since30}&order=created_at.desc&limit=2000`,
    ),
  ]);

  // ── 聚合:总量/独立设备(今日、7 天、30 天) ──
  const now = Date.now();
  const cut = (days: number) => now - days * 86_400_000;
  const windowStats = (days: number) => {
    const rows = telemetry.rows.filter((r) => new Date(r.at).getTime() >= cut(days));
    return { events: rows.length, devices: new Set(rows.map((r) => r.device_id)).size };
  };

  // ── 按事件名计数(7 天) ──
  const byName7 = new Map<string, number>();
  for (const r of telemetry.rows) {
    if (new Date(r.at).getTime() < cut(7)) continue;
    byName7.set(r.name, (byName7.get(r.name) || 0) + 1);
  }

  // ── 每日趋势(30 天,事件数 + 独立设备;前端按 7/14/30 范围切换) ──
  const daily = new Map<string, { events: number; devices: Set<string> }>();
  for (let i = 29; i >= 0; i -= 1) {
    daily.set(dayKey(new Date(now - i * 86_400_000).toISOString()), { events: 0, devices: new Set() });
  }
  for (const r of telemetry.rows) {
    const d = daily.get(dayKey(r.at));
    if (d) { d.events += 1; d.devices.add(r.device_id); }
  }

  // ── Onboarding/激活漏斗(30 天,按设备去重) ──
  const funnelSteps = ['app_open', 'brief_play', 'mood_open', 'capture_voice_open', 'chat_send'];
  const devicesByEvent = new Map<string, Set<string>>();
  for (const r of telemetry.rows) {
    if (!devicesByEvent.has(r.name)) devicesByEvent.set(r.name, new Set());
    devicesByEvent.get(r.name)!.add(r.device_id);
  }
  const funnel = funnelSteps.map((step) => ({ step, devices: devicesByEvent.get(step)?.size || 0 }));

  // ── 今日卡反馈(product_events,30 天) ──
  const feedback = { useful: 0, wrong: 0, too_much: 0, other: 0 };
  for (const r of product.rows) {
    if (r.event_type !== 'today.card.feedback') continue;
    if (r.feedback === 'useful') feedback.useful += 1;
    else if (r.feedback === 'wrong') feedback.wrong += 1;
    else if (r.feedback === 'too_much') feedback.too_much += 1;
    else feedback.other += 1;
  }
  const productByType = new Map<string, number>();
  for (const r of product.rows) productByType.set(r.event_type, (productByType.get(r.event_type) || 0) + 1);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    sources: {
      telemetryEvents: telemetry.error ? { ok: false, error: telemetry.error } : { ok: true, rows: telemetry.rows.length },
      productEvents: product.error ? { ok: false, error: product.error } : { ok: true, rows: product.rows.length },
    },
    windows: { today: windowStats(1), week: windowStats(7), month: windowStats(30) },
    topEvents7d: [...byName7.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
    daily30d: [...daily.entries()].map(([date, d]) => ({ date, events: d.events, devices: d.devices.size })),
    funnel30d: funnel,
    cardFeedback30d: feedback,
    productEvents30d: [...productByType.entries()].map(([type, count]) => ({ type, count })),
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
