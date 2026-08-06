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
 *
 * 批次 P2-geo:FIX_CACHE_KEY 从 localStorage 迁到 IDB blob-store,
 * 减少 5MB 配额压力与频繁 JSON parse 的内存抖动。
 */

import { reverseGeocode } from './weather';
import { getDevicePosition } from './native-geolocation';
import { createBlobStore } from './idb-blob-store';

const FLAG_KEY = 'nesio-capture-loc-v1';           // durable:用户选择,进备份
const FIX_MAX_AGE = 5 * 60_000;
const PREFETCH_THROTTLE = 60_000;

export interface CaptureFix {
  lat: number;
  lon: number;
  accuracy: number;
  ts: number;
  label?: string;
}

const fixStore = createBlobStore<CaptureFix>({
  key: 'nesio-capture-fix-cache-v1',
  updateEvent: 'nesio-capture-fix-updated',
  validate: (v) => v != null && typeof (v as CaptureFix).lat === 'number',
});

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
  const cached = fixStore.load();
  if (cached && typeof cached.lat === 'number') memFix = cached;
  return memFix;
}

function writeFixCache(fix: CaptureFix): void {
  memFix = fix;
  fixStore.save(fix);
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
  const now = Date.now();
  if (!force && now - lastPrefetchAt < PREFETCH_THROTTLE) return;
  lastPrefetchAt = now;
  void getDevicePosition({ timeoutMs: 8_000, maximumAgeMs: 120_000, enableHighAccuracy: false })
    .then((pos) => {
      if (!pos) return;
      const prev = readFixCache();
      const fix: CaptureFix = {
        lat: pos.lat,
        lon: pos.lon,
        accuracy: pos.accuracy,
        ts: Date.now(),
        // 没挪窝(<300m)沿用旧地名,省一次反查
        label: prev && distMeters(prev, { latitude: pos.lat, longitude: pos.lon }) < 300 ? prev.label : undefined,
      };
      writeFixCache(fix);
      if (!fix.label && !labelInFlight) {
        labelInFlight = true;
        reverseGeocodeRobust(fix.lat, fix.lon)
          .then((geo) => {
            const label = geo.label;
            if (label) {
              writeFixCache({ ...(readFixCache() ?? fix), label });
              healCoordEntryOrFeed(label, fix.lat, fix.lon);
              // 批次 61:城市/国家顺手入库(World tab 按国聚合的数据源,
              // 手动「找真名」按钮已撤,这里就是它的自动化替身)
              if (geo.city || geo.country) {
                import('./place-trail')
                  .then((m) => m.setPlaceGeo(label, { name: label, city: geo.city, country: geo.country, resolved: true }))
                  .catch(() => {});
              }
            } else {
              // 两级反查都空手:足迹先用坐标名记上(可改名);不写进 fix.label,
              // 下次仍会尝试真名,拿到后自动把坐标条目改名认亲。
              feedFootprints(coordLabel(fix.lat, fix.lon), fix.lat, fix.lon);
            }
          })
          .catch(() => { feedFootprints(coordLabel(fix.lat, fix.lon), fix.lat, fix.lon); })
          .finally(() => { labelInFlight = false; });
      } else if (fix.label) {
        feedFootprints(fix.label, fix.lat, fix.lon);
      }
    })
    .catch(() => { /* 拒绝/超时:保持旧缓存,盖章自然跳过 */ });
}

function coordLabel(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

/** 批次 60:两级健壮反查 —— 天气链(open-meteo/BigDataCloud)空手时落到
 *  服务端 /api/portal/geocode(OSM/Foursquare 代理,不受设备侧网络怪癖影响)。
 *  返回人话地名(Cary, NC, US / 商户名, 城市, 国家),两级都空返回 ''。 */
export interface RobustGeo { label: string; city?: string; country?: string }

export async function reverseGeocodeRobust(lat: number, lon: number): Promise<RobustGeo> {
  try {
    const geo = await reverseGeocode(lat, lon);
    if (geo.label) {
      return { label: geo.country ? `${geo.label}, ${geo.country}` : geo.label, city: geo.city, country: geo.country };
    }
  } catch { /* 落到服务端 */ }
  try {
    const res = await fetch('/api/portal/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon }),
    });
    const d = await res.json() as { ok?: boolean; name?: string; city?: string; country?: string };
    if (d.ok) {
      const parts = [d.name, d.city && d.city !== d.name ? d.city : '', d.country].filter(Boolean) as string[];
      if (parts.length) return { label: parts.join(', '), city: d.city, country: d.country };
    }
  } catch { /* 两级全空 */ }
  return { label: '' };
}

/** 批次 60:反查迟到时,先前用坐标名记下的足迹条目就地改名认亲(displayLabel
 *  全站生效),同一停留窗内不再重复打点;没有坐标条目则正常记真名。 */
function healCoordEntryOrFeed(label: string, lat: number, lon: number): void {
  import('./place-trail')
    .then((m) => {
      const cl = coordLabel(lat, lon);
      const now = Date.now();
      const coordEntry = m.loadPlaceTrail().find(
        (v) => v.label === cl && now - new Date(v.ts).getTime() < 2 * 3_600_000,
      );
      if (coordEntry) {
        // 批次 61:改写存储本体(不再只别名)—— 同名地点的次数/停留全站归一
        m.renamePlaceLabel(cl, label);
      } else {
        m.recordLiveVisit(label, lat, lon);
      }
    })
    .catch(() => {});
}

/** 批次 57:定位开关开着时,每次拿到定位顺手喂足迹(2h 同地去重在 place-trail 内),
 *  修「足迹一直空」—— 不再只依赖天气链那条喂养路径。 */
function feedFootprints(label: string, lat: number, lon: number): void {
  import('./place-trail')
    .then((m) => m.recordLiveVisit(label, lat, lon))
    .catch(() => {});
}

function distMeters(a: { lat: number; lon: number }, b: { latitude: number; longitude: number }): number {
  const dLat = (b.latitude - a.lat) * 111_320;
  const dLon = (b.longitude - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}
