/**
 * Nesio offline shell — conservative service worker.
 *
 * Strategy:
 * - navigations: network-first, cached shell as offline fallback
 *   (never serves a stale deploy when online)
 * - /_next/static, /icons, /assets: cache-first (content-hashed, immutable)
 * - /api/*: never touched — data flows stay live
 *
 * All user data lives in localStorage/IndexedDB, so a cached shell is all
 * that's needed to read memories in airplane mode.
 */

const VERSION = 'nesio-sw-v4';
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(['/'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Immutable build assets: cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Navigations: network-first, offline falls back to cached shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only the home shell is kept as the offline fallback
          if (res.ok && url.pathname === '/') {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => (await caches.match('/')) || Response.error()),
    );
  }
});

// ── Web Push(留存引擎)——每日回顾 / resurfacing 推送的接收端。
// 订阅注册(PushManager.subscribe)+ 后端发推另接;这里是 SW 收到后显示通知 + 点击回 App。
// iOS 需 16.4+ 且已「添加到主屏」。
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const options = {
    body: data.body || '',
    icon: data.icon || '/assets/logo/nesio-mark.svg',
    badge: '/assets/logo/nesio-mark.svg',
    tag: data.tag || 'nesio-daily',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(data.title || 'Nesio', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) { if ('focus' in c) { c.navigate(target); return c.focus(); } }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    }),
  );
});
