/**
 * Web Push 客户端(Step 6)—— 设置页「重要提醒推送」开关(用户拍板:开关手动开,不自动弹权限)。
 * 只推 severity 3(登机口级);SW 接收端早就在 public/sw.js(push + notificationclick)。
 * env 未配 NEXT_PUBLIC_VAPID_PUBLIC_KEY → pushSupported()=false,设置页开关隐藏,整体 inert。
 */

const ENABLED_KEY = 'nesio-push-enabled-v1';

export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

export function isPushEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(ENABLED_KEY) === '1';
}

function b64ToU8(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** 开关打开:要权限 → 订阅 → 上报。任何一步失败返回可读原因(失败态必须可见)。 */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToU8(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) as unknown as BufferSource,
    });
    const res = await fetch('/api/portal/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    if (!res.ok) return { ok: false, reason: `server_${res.status}` };
    try { localStorage.setItem(ENABLED_KEY, '1'); } catch { /* 开关态丢了下次再开 */ }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'subscribe_failed' };
  }
}

/** 开关关闭:退订 + 删服务端行。 */
export async function disablePush(): Promise<void> {
  try { localStorage.removeItem(ENABLED_KEY); } catch { /* ignore */ }
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/portal/push-subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
  } catch { /* best-effort */ }
}
