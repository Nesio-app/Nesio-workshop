/**
 * 地点封面照(足迹世界卡)—— 自动从「带图 + 就近」的记忆里匹配一张,用户可点图从本地换。
 *
 * 覆盖优先:手动上传 > 就近自动匹配 > 无(退化到渐变占位)。手动图存本地图库(putLocalImage),
 * 覆盖映射存 localStorage。全本机,不上传。
 */
import { compressToDataUrl, putLocalImage } from './local-image-store';
import { canonicalCountryKey } from './country-normalize';

const KEY = 'nesio-place-photos-v1';
export const PLACE_PHOTOS_EVENT = 'nesio-place-photos-updated';

export function loadPlacePhotoOverrides(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string>; } catch { return {}; }
}

/** 手动换图:压缩存本地图库,记下 placeKey → assetId 覆盖。返回 assetId。 */
export async function setPlacePhotoOverride(placeKey: string, file: File): Promise<string> {
  const dataUrl = await compressToDataUrl(file, 1000, 0.82);
  const assetId = `placephoto-${placeKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  await putLocalImage(assetId, dataUrl);
  const map = loadPlacePhotoOverrides();
  map[placeKey] = assetId;
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* 满了也不拦上传 */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PLACE_PHOTOS_EVENT));
  return assetId;
}

export function placePhotoOverrideId(placeKey: string): string | null {
  return loadPlacePhotoOverrides()[placeKey] ?? null;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180, la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// lat/lon 可缺省 —— 没坐标的带图记忆也纳入,按 city/country 地名回退匹配。
// storagePath:云端图兜底用(本机 IDB 取不到时,用它换签名 URL,否则云端图永远显示不出)。
export interface GeoImageNode { assetId: string; lat?: number; lon?: number; ts: number; city?: string; country?: string; storagePath?: string }

/** 卡片的地点描述(城市卡传 city,国家卡传 country)—— 坐标匹配不到时按名回退。 */
export interface PlaceDescriptor { city?: string; country?: string }

/**
 * 给地点卡挑一张封面照(用户:有对应记忆照片就自动展示最好的一张,别空着):
 *  1) 坐标就近:到访点 coords 与带坐标的照片比,取 25km 内最近的一张(并列取最近记的);
 *  2) 时间归属:照片拍摄时间落在该地某次到访的时段内 → 算这地的照片(现拍/无坐标照片全靠它);
 *  3) 地名回退:按该照片记忆归属的 city/country 与卡片一致来配,取最近记的一张。
 * 「最好」这里取最近记录的(时间新),稳定且可解释。
 */
export function matchPlacePhotoAsset(
  coords: Array<{ lat: number; lon: number }>,
  imageNodes: GeoImageNode[],
  place?: PlaceDescriptor,
  timeRanges?: Array<[number, number]>,
): string | null {
  if (!imageNodes.length) return null;

  // 1) 坐标就近
  if (coords.length) {
    let best: GeoImageNode | null = null;
    let bestD = Infinity;
    for (const n of imageNodes) {
      if (typeof n.lat !== 'number' || typeof n.lon !== 'number') continue;
      for (const c of coords) {
        const d = haversineKm(c.lat, c.lon, n.lat, n.lon);
        if (d < bestD || (d === bestD && best && n.ts > best.ts)) { bestD = d; best = n; }
      }
    }
    if (best && bestD <= 25) return best.assetId;
  }

  // 2) 时间归属:照片拍摄时间落在该地到访时段内(现拍照片常无坐标,靠这条兜住)
  if (timeRanges && timeRanges.length) {
    let best: GeoImageNode | null = null;
    for (const n of imageNodes) {
      if (timeRanges.some(([s, e]) => n.ts >= s && n.ts <= e) && (!best || n.ts > best.ts)) best = n;
    }
    if (best) return best.assetId;
  }

  // 3) 地名回退:城市卡按城市、国家卡按国家匹配归属照片,取最新
  if (place) {
    const wantCity = place.city?.trim().toLowerCase();
    const wantCountry = place.country ? canonicalCountryKey(place.country) : '';
    let best: GeoImageNode | null = null;
    for (const n of imageNodes) {
      const hit = wantCity
        ? Boolean(n.city && n.city.trim().toLowerCase() === wantCity)
        : Boolean(wantCountry && n.country && canonicalCountryKey(n.country) === wantCountry);
      if (hit && (!best || n.ts > best.ts)) best = n;
    }
    if (best) return best.assetId;
  }

  return null;
}
