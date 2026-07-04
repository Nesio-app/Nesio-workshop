/**
 * Server-side AI call telemetry — one structured log line per AI invocation,
 * same [telemetry] format as /api/telemetry so Vercel logs stay uniformly
 * greppable. Answers: which routes burn money, how slow, how often failing.
 */

export function reportAiCall(
  route: string,
  ok: boolean,
  startedAt: number,
  extra?: Record<string, string | number | boolean>,
): void {
  try {
    console.log('[telemetry]', JSON.stringify({
      name: 'ai_route',
      props: { route, ok, latency_ms: Date.now() - startedAt, ...extra },
      ts: Date.now(),
    }));
  } catch { /* never break the route */ }
}
