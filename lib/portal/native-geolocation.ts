/**
 * 统一设备定位 —— Capacitor 壳用自研 NesioGeolocation(使用期间 / Always + 足迹监听),
 * PWA/Safari 回退 navigator.geolocation。
 */

import { registerPlugin } from '@capacitor/core';
import { isNativePlatform } from './platform-capabilities';

export interface DeviceLatLon {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
}

type LocPerm = {
  location?: string;
  coarseLocation?: string;
  always?: string;
  trailWatching?: boolean;
};

type TrailPoint = {
  lat: number;
  lon: number;
  accuracy?: number;
  timestamp?: number;
  source?: string;
};

type NesioGeolocationPlugin = {
  checkPermissions: () => Promise<LocPerm>;
  requestPermissions: () => Promise<LocPerm>;
  requestAlwaysPermission: () => Promise<LocPerm>;
  getCurrentPosition: (opts: {
    enableHighAccuracy?: boolean;
    timeout?: number;
    maximumAge?: number;
  }) => Promise<{
    ok?: boolean;
    reason?: string;
    lat?: number;
    lon?: number;
    accuracy?: number;
    timestamp?: number;
  }>;
  startTrailWatch: () => Promise<{ ok?: boolean; reason?: string; always?: boolean }>;
  stopTrailWatch: () => Promise<{ ok?: boolean }>;
  /** ↓ 新壳才有(2026-07-31)。老壳上是 undefined,调用前先探。 */
  drainTrailPoints?: () => Promise<{ points?: TrailPoint[] }>;
  addListener: (
    event: 'trailPoint',
    cb: (point: TrailPoint) => void,
  ) => Promise<{ remove: () => void }>;
};

const NesioGeolocation = registerPlugin<NesioGeolocationPlugin>('NesioGeolocation');

function granted(p: LocPerm | null | undefined): boolean {
  return p?.location === 'granted' || p?.coarseLocation === 'granted';
}

export async function requestLocationPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!isNativePlatform()) {
    return !!(navigator.geolocation);
  }
  try {
    const cur = await NesioGeolocation.checkPermissions();
    if (granted(cur)) return true;
    return granted(await NesioGeolocation.requestPermissions());
  } catch (err) {
    // 插件未进 packageClassList / 未编译进壳时会抛 —— 别一律当成「系统拒绝」。
    console.warn('[nesio-geo] permission bridge failed', err);
    return false;
  }
}

/** 区分「系统拒绝」与「壳没带定位插件」,给 ConnectorsHub 用。 */
export async function diagnoseLocationPermission(): Promise<'granted' | 'denied' | 'plugin_missing' | 'unavailable'> {
  if (typeof window === 'undefined') return 'unavailable';
  if (!isNativePlatform()) {
    return navigator.geolocation ? 'granted' : 'unavailable';
  }
  try {
    const cur = await NesioGeolocation.checkPermissions();
    if (granted(cur)) return 'granted';
    const next = await NesioGeolocation.requestPermissions();
    return granted(next) ? 'granted' : 'denied';
  } catch {
    return 'plugin_missing';
  }
}

/** 升级到 Always(须已有或先走使用期间)。PWA 无 Always → false。 */
export async function requestAlwaysLocationPermission(): Promise<{
  whenInUse: boolean;
  always: boolean;
}> {
  if (typeof window === 'undefined' || !isNativePlatform()) {
    return { whenInUse: false, always: false };
  }
  try {
    const next = await NesioGeolocation.requestAlwaysPermission();
    return {
      whenInUse: granted(next),
      always: next.always === 'granted',
    };
  } catch {
    return { whenInUse: false, always: false };
  }
}

export async function checkLocationPermission(): Promise<{
  whenInUse: boolean;
  always: boolean;
}> {
  if (typeof window === 'undefined' || !isNativePlatform()) {
    return { whenInUse: !!(typeof navigator !== 'undefined' && navigator.geolocation), always: false };
  }
  try {
    const cur = await NesioGeolocation.checkPermissions();
    return { whenInUse: granted(cur), always: cur.always === 'granted' };
  } catch {
    return { whenInUse: false, always: false };
  }
}

/** 取一次当前位置。失败/拒绝/超时 → null(不抛)。 */
export async function getDevicePosition(options?: {
  timeoutMs?: number;
  maximumAgeMs?: number;
  enableHighAccuracy?: boolean;
}): Promise<DeviceLatLon | null> {
  if (typeof window === 'undefined') return null;
  // 原生壳给足时间:室内首点常 >8s;缓存最大年龄放宽。
  const timeoutMs = options?.timeoutMs ?? (isNativePlatform() ? 18_000 : 8_000);
  const maximumAgeMs = options?.maximumAgeMs ?? (isNativePlatform() ? 300_000 : 60_000);
  const enableHighAccuracy = options?.enableHighAccuracy ?? false;

  if (isNativePlatform()) {
    try {
      const perm = await NesioGeolocation.checkPermissions().catch(() => null);
      if (perm && !granted(perm)) {
        const req = await NesioGeolocation.requestPermissions();
        if (!granted(req)) return null;
      }
      const attempt = async () => {
        const pos = await NesioGeolocation.getCurrentPosition({
          enableHighAccuracy,
          timeout: timeoutMs,
          maximumAge: maximumAgeMs,
        });
        if (!pos?.ok || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') return null;
        return {
          lat: pos.lat,
          lon: pos.lon,
          accuracy: pos.accuracy ?? 0,
          timestamp: pos.timestamp || Date.now(),
        };
      };
      const first = await attempt();
      if (first) return first;
      // 再试一次(冷启动 GPS / LocationUnknown 后)
      await new Promise((r) => setTimeout(r, 600));
      return await attempt();
    } catch {
      /* 原生失败再试 web */
    }
  }

  if (!navigator.geolocation) return null;
  const geo = new Promise<DeviceLatLon | null>((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 0,
          timestamp: pos.timestamp || Date.now(),
        }),
        () => resolve(null),
        { enableHighAccuracy, timeout: Math.min(timeoutMs, 8_000), maximumAge: maximumAgeMs },
      );
    } catch {
      resolve(null);
    }
  });
  const hard = new Promise<null>((resolve) => { setTimeout(() => resolve(null), timeoutMs + 200); });
  return Promise.race([geo, hard]);
}

let trailBridgeStarted = false;

async function ingestTrailPoint(lat: number, lon: number, opts?: { manual?: boolean }): Promise<void> {
  let label = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  try {
    const { reverseGeocode } = await import('./providers/weather');
    const geo = await reverseGeocode(lat, lon);
    label = geo.label || geo.city || label;
  } catch { /* 坐标名兜底 */ }
  try {
    const { recordLiveVisit } = await import('./place-trail');
    recordLiveVisit(label, lat, lon, opts);
  } catch { /* ignore */ }
}

/**
 * 订阅原生足迹点 + 开 significant/visits 监听。
 * 幂等;Always 时后台也能推点(壳在后台被系统唤醒时)。
 *
 * ## 为什么除了监听还要 drain 一次
 *
 * 后台的点是在 App **被系统唤醒**时投递的 —— 那会儿 WebView 常常还没起来,
 * `notifyListeners` 发出去没人接,点就丢了。而真正的后台足迹恰恰全是这种点:
 * 「一直开着定位却一个点都没有」有一半是这么来的。
 *
 * 新壳两条都走:事件即时到,同时原生侧攒一份队列。这里回前台时取一次,
 * 把后台攒下的补齐。老壳没有 `drainTrailPoints`,这一段自动跳过。
 */
export async function ensurePlaceTrailWatch(): Promise<{ ok: boolean; reason?: string }> {
  if (typeof window === 'undefined' || !isNativePlatform()) {
    return { ok: false, reason: 'web_unsupported' };
  }
  try {
    if (!trailBridgeStarted) {
      trailBridgeStarted = true;
      await NesioGeolocation.addListener('trailPoint', (point) => {
        if (typeof point?.lat !== 'number' || typeof point?.lon !== 'number') return;
        void ingestTrailPoint(point.lat, point.lon);
      });
    }
    const res = await NesioGeolocation.startTrailWatch();
    if (!res?.ok) return { ok: false, reason: res?.reason || 'start_failed' };
    void drainQueuedTrailPoints();
    return { ok: true };
  } catch {
    return { ok: false, reason: 'start_failed' };
  }
}

/**
 * 取走原生侧攒着的后台足迹点。**取完即清**(原生那边清),
 * 所以这是「至多消费一次」—— 宁可偶尔丢一个点,也不要每次回前台
 * 把同一批点重复灌进足迹。
 *
 * 老壳没有这个方法 → 返回 0,什么都不做。
 */
export async function drainQueuedTrailPoints(): Promise<number> {
  if (typeof window === 'undefined' || !isNativePlatform()) return 0;
  try {
    if (typeof NesioGeolocation.drainTrailPoints !== 'function') return 0;
    const res = await NesioGeolocation.drainTrailPoints();
    const points = Array.isArray(res?.points) ? res.points : [];
    let taken = 0;
    for (const p of points) {
      if (typeof p?.lat !== 'number' || typeof p?.lon !== 'number') continue;
      await ingestTrailPoint(p.lat, p.lon);
      taken += 1;
    }
    return taken;
  } catch {
    return 0;
  }
}

/** 连接器成功拿到点后立刻记一条足迹(不等后台事件)。manual=用户点「标记当前位置」。 */
export async function recordVisitFromCoords(
  lat: number,
  lon: number,
  opts?: { manual?: boolean },
): Promise<void> {
  await ingestTrailPoint(lat, lon, opts);
}
