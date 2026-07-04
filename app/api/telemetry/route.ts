/**
 * POST /api/telemetry
 * Minimal product telemetry: event counts only, never content.
 *
 * Events land as structured JSON in server logs (visible in the Vercel
 * dashboard, greppable as [telemetry]). When Supabase is configured they
 * are also inserted into the telemetry_events table (best-effort).
 *
 * Privacy contract: name + coarse props + anonymous per-device id.
 * Prop values are truncated to 80 chars server-side so free-text can't
 * leak in even by accident.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest, isRateLimited } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';

interface TelemetryEvent {
  name: string;
  props?: Record<string, string | number | boolean>;
  ts?: number;
}

const MAX_EVENTS_PER_BATCH = 20;
const MAX_PROP_CHARS = 80;

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

function sanitize(e: TelemetryEvent): TelemetryEvent | null {
  if (typeof e?.name !== 'string' || !/^[a-z0-9_.]{1,48}$/.test(e.name)) return null;
  const props: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(e.props ?? {})) {
    if (!/^[a-z0-9_]{1,32}$/.test(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean') props[k] = v;
    else if (typeof v === 'string') props[k] = v.slice(0, MAX_PROP_CHARS);
  }
  return { name: e.name, props, ts: typeof e.ts === 'number' ? e.ts : Date.now() };
}

async function writeToSupabase(events: TelemetryEvent[], deviceId: string): Promise<void> {
  const url = envValue('SUPABASE_URL');
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY') || envValue('SUPABASE_ANON_KEY');
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/telemetry_events`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(events.map((e) => ({
        name: e.name, props: e.props, device_id: deviceId, at: new Date(e.ts!).toISOString(),
      }))),
    });
  } catch { /* best-effort */ }
}

export async function POST(req: NextRequest) {
  // 匿名合法(2026-07-04 QA P1 修复):本路由设计上就是匿名设备级计数
  // (名字+粗粒度 props,内容在 sanitize 里截断),demo/onboarding 漏斗
  // 依赖它。要求登录曾让匿名遥测全军覆没。守卫 = 同源 + 限流,不要求会话。
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  if (isRateLimited(req, 'telemetry', { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as { events?: unknown[]; deviceId?: string } | null;
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.slice(0, 40) : 'unknown';
  const events = (Array.isArray(body?.events) ? body.events : [])
    .slice(0, MAX_EVENTS_PER_BATCH)
    .map((e) => sanitize(e as TelemetryEvent))
    .filter((e): e is TelemetryEvent => e !== null);

  if (events.length === 0) return NextResponse.json({ ok: true, accepted: 0 });

  for (const e of events) {
    console.log('[telemetry]', JSON.stringify({ ...e, deviceId }));
  }
  await writeToSupabase(events, deviceId);

  return NextResponse.json({ ok: true, accepted: events.length });
}
