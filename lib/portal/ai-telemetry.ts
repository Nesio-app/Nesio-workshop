/**
 * Server-side AI call telemetry — one structured log line per AI invocation,
 * same [telemetry] format as /api/telemetry so Vercel logs stay uniformly
 * greppable. Answers: which routes burn money, how slow, how often failing.
 *
 * 2026-07-04:同时落 Supabase telemetry_events(经 next/server 的 after(),
 * 响应发出后执行,不加请求延迟)——/admin 的 AI 成本/聪明度区靠这份数据。
 * 落库是 best-effort:失败只丢一条统计,永不影响业务路由。
 */

import { after } from 'next/server';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

async function persistAiEvent(props: Record<string, string | number | boolean>, ts: number): Promise<void> {
  const url = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY') || envValue('SUPABASE_ANON_KEY');
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/telemetry_events`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ name: 'ai_route', props, device_id: 'server', at: new Date(ts).toISOString() }]),
    });
  } catch { /* best-effort */ }
}

export function reportAiCall(
  route: string,
  ok: boolean,
  startedAt: number,
  extra?: Record<string, string | number | boolean>,
): void {
  try {
    const ts = Date.now();
    const props = { route, ok, latency_ms: ts - startedAt, ...extra };
    console.log('[telemetry]', JSON.stringify({ name: 'ai_route', props, ts }));
    try {
      after(() => persistAiEvent(props, ts));
    } catch { /* after() 仅在请求上下文可用;脱离上下文时只留日志 */ }
  } catch { /* never break the route */ }
}
