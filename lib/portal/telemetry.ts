/**
 * Telemetry client — event counts only, never content.
 *
 * track('brief_play') / track('ai_route', { route: 'chat', ok: true, latency_ms: 812 })
 * Events batch in memory and flush every 15s, on page hide (sendBeacon), or
 * when the buffer fills. Fire-and-forget: telemetry must never break a flow.
 *
 * The device id is a random anonymous token — no account linkage, resettable
 * by clearing site data. This matches the product's privacy posture: we
 * count "听简报 was played", never what the brief said.
 */

const DEVICE_KEY = 'nesio-telemetry-device-v1';
const FLUSH_INTERVAL_MS = 15_000;
const MAX_BUFFER = 18;

interface TelemetryEvent {
  name: string;
  props?: Record<string, string | number | boolean>;
  ts: number;
}

let buffer: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;

function deviceId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `d-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch { return 'no-storage'; }
}

/** 只读取现有 device_id(不创建)。删除账号时上报给服务端做设备级遥测擦除
 *  (数据审计 #5/#6 被遗忘权)。无 id / 无 storage → null。 */
export function getTelemetryDeviceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch { return null; }
}

function send(events: TelemetryEvent[], useBeacon: boolean): void {
  if (events.length === 0) return;
  const payload = JSON.stringify({ events, deviceId: deviceId() });
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/telemetry', new Blob([payload], { type: 'application/json' }));
      return;
    }
    void fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  } catch { /* never break the caller */ }
}

function flush(useBeacon = false): void {
  const batch = buffer;
  buffer = [];
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  send(batch, useBeacon);
}

function installListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
}

/** Record one event. Safe to call anywhere client-side; no-op on server. */
export function track(name: string, props?: Record<string, string | number | boolean>): void {
  if (typeof window === 'undefined') return;
  installListeners();
  buffer.push({ name, props, ts: Date.now() });
  if (buffer.length >= MAX_BUFFER) { flush(); return; }
  if (!flushTimer) flushTimer = setTimeout(() => flush(), FLUSH_INTERVAL_MS);
}

/** Client error hook — call once at app mount. Dedupes repeated messages. */
export function installErrorTracking(): void {
  if (typeof window === 'undefined') return;
  const seen = new Set<string>();
  const report = (kind: string, message: string, source?: string) => {
    const sig = `${kind}:${message.slice(0, 60)}`;
    if (seen.has(sig) || seen.size > 20) return;
    seen.add(sig);
    track('client_error', {
      kind,
      message: message.slice(0, 80),
      ...(source ? { source: source.slice(0, 80) } : {}),
    });
  };
  window.addEventListener('error', (e) => report('error', String(e.message || 'unknown'), e.filename));
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason ?? 'unknown');
    report('rejection', reason);
  });
}
