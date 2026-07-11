/**
 * capture-location — 记忆自动定位(批次 56,用户定案「enable 手机位置功能」)。
 *
 * 与 location-store(天气链、城市级、机会式刷新)不同,这里是**头等公民**:
 * 用户在设置里显式开启后,直接用手机定位(navigator.geolocation,精确坐标),
 * 每条亲手记下的记忆盖上「当时在哪」—— 多一个可分析的维度(地图上的记忆)。
 *
 * 纪律:
 *  - 开关默认关;开启动作本身就是权限时刻(立即预热一次,系统弹授权框);
 *  - 捕获路径不等 GPS:捕获面打开时预热(prefetch),盖章只读 ≤5 分钟的缓存;
 *  - 地名异步回填:坐标先落节点,反查到城市名后 updateLifeNode 补 capturedPlace。
 */

import { reverseGeocode } from './weather';

const FLAG_KEY = 'nesio-capture-loc-v1';           // durable:用户选择,进备份
const FIX_CACHE_KEY = 'nesio-capture-fix-cache-v1'; // cache:可再生,不进备份
const FIX_MAX_AGE = 5 * 60_000;
const PREFETCH_THROTTLE = 60_000;

export interface CaptureFix {
  lat: number;
  lon: number;
  accuracy: number;
  ts: number;
  label?: string;
}

export function captureLocationEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(FLAG_KEY) === '1'; } catch { return false; }
}

export function setCaptureLocationEnabled(on: boolean): void {
  if (typeof window === 'undefined') return;
  try { if (on) localStorage.setItem(FLAG_KEY, '1'); else localStorage.removeItem(FLAG_KEY); } catch { /* ignore */ }
  if (on) prefetchCaptureLocation(true); // 开启即预热 = 权限时刻在设置页,不在记录途中
}

let memFix: CaptureFix | null = null;

function readFixCache(): CaptureFix | null {
  if (memFix) return memFix;
  try {
    const raw = JSON.parse(localStorage.getItem(FIX_CACHE_KEY) || 'null') as CaptureFix | null;
    if (raw && typeof raw.lat === 'number') memFix = raw;
  } catch { /* ignore */ }
  return memFix;
}

function writeFixCache(fix: CaptureFix): void {
  memFix = fix;
  try { localStorage.setItem(FIX_CACHE_KEY, JSON.stringify(fix)); } catch { /* ignore */ }
}

/** 盖章用:≤maxAge 的最近定位;没有就 null(宁缺毋错)。 */
export function getFreshCaptureFix(maxAgeMs: number = FIX_MAX_AGE): CaptureFix | null {
  if (!captureLocationEnabled()) return null;
  const fix = readFixCache();
  return fix && Date.now() - fix.ts <= maxAgeMs ? fix : null;
}

let lastPrefetchAt = 0;
let labelInFlight = false;

/** 捕获面打开时调用:节流取一次手机定位,写缓存;地名异步反查补进缓存。 */
export function prefetchCaptureLocation(force = false): void {
  if (typeof window === 'undefined' || !captureLocationEnabled()) return;
  if (!('geolocation' in navigator)) return;
  const now = Date.now();
  if (!force && now - lastPrefetchAt < PREFETCH_THROTTLE) return;
  lastPrefetchAt = now;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const prev = readFixCache();
      const fix: CaptureFix = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? 0,
        ts: Date.now(),
        // 没挪窝(<300m)沿用旧地名,省一次反查
        label: prev && distMeters(prev, pos.coords) < 300 ? prev.label : undefined,
      };
      writeFixCache(fix);
      if (!fix.label && !labelInFlight) {
        labelInFlight = true;
        reverseGeocode(fix.lat, fix.lon)
          .then((geo) => { if (geo.label) writeFixCache({ ...(readFixCache() ?? fix), label: geo.label }); })
          .catch(() => {})
          .finally(() => { labelInFlight = false; });
      }
    },
    () => { /* 拒绝/超时:保持旧缓存,盖章自然跳过 */ },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 120_000 },
  );
}

function distMeters(a: { lat: number; lon: number }, b: { latitude: number; longitude: number }): number {
  const dLat = (b.latitude - a.lat) * 111_320;
  const dLon = (b.longitude - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}
