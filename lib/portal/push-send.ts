/**
 * Web Push 发送端(服务端,Step 6)—— severity 3 判决出卡即推(sev3 才推,用户拍板)。
 * env 三件套没配齐 → 整体 inert(不报错不装死):
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT(mailto:)。
 * 410/404 = 端点已失效 → 顺手删行(浏览器换了订阅,旧端点永远推不通)。
 * best-effort:任何失败只丢一条推送,绝不影响判决路由本身。
 */
import { envValue } from '@/lib/portal/env';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';
import { getCloudConfig, getSignedInUser, serviceRoleRestHeaders } from '@/lib/portal/cloud-server-runtime';

export function pushConfigured(): boolean {
  return Boolean(envValue('NEXT_PUBLIC_VAPID_PUBLIC_KEY') && envValue('VAPID_PRIVATE_KEY'));
}

export interface PushPayload {
  title: string;
  body: string;
  /** 去重 tag(同一卡只通知一次,SW 端同 tag 覆盖)。 */
  tag: string;
  url?: string;
}

/** 给当前已鉴权用户的全部订阅端点发一条推送。 */
export async function sendPushToCurrentUser(payloads: readonly PushPayload[]): Promise<void> {
  if (!pushConfigured() || payloads.length === 0) return;
  const config = getCloudConfig();
  if (!config.enabled) return;
  const { user } = await getSignedInUser(config);
  const identity = deriveCloudIdentity(user);
  if (!identity) return;

  try {
    const rows = await fetch(
      `${config.supabaseUrl}/rest/v1/user_push_subscriptions?identity_key=eq.${encodeURIComponent(identity.identityKey)}&select=endpoint,subscription`,
      { headers: serviceRoleRestHeaders(config) },
    ).then((r) => (r.ok ? (r.json() as Promise<Array<{ endpoint: string; subscription: unknown }>>) : []));
    if (!rows.length) return;

    const webPush = (await import('web-push')).default;
    webPush.setVapidDetails(
      envValue('VAPID_SUBJECT') || 'mailto:hello@nesio.app',
      envValue('NEXT_PUBLIC_VAPID_PUBLIC_KEY')!,
      envValue('VAPID_PRIVATE_KEY')!,
    );

    await Promise.all(rows.flatMap((row) => payloads.map(async (p) => {
      try {
        await webPush.sendNotification(
          row.subscription as Parameters<typeof webPush.sendNotification>[0],
          JSON.stringify({ title: p.title, body: p.body, tag: p.tag, url: p.url || '/' }),
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // 端点已死:清行,别对着空气推
          await fetch(
            `${config.supabaseUrl}/rest/v1/user_push_subscriptions?identity_key=eq.${encodeURIComponent(identity.identityKey)}&endpoint=eq.${encodeURIComponent(row.endpoint)}`,
            { method: 'DELETE', headers: serviceRoleRestHeaders(config) },
          ).catch(() => undefined);
        }
      }
    })));
  } catch { /* best-effort:推送失败绝不影响判决 */ }
}
