/**
 * 地点封面照(足迹世界卡)—— 自动从「带图 + 就近」的记忆里匹配一张,用户可点图从本地换。
 *
 * 覆盖优先:手动上传 > 就近自动匹配 > 无(退化到渐变占位)。手动图存本地图库(putLocalImage),
 * 覆盖映射存 localStorage。全本机,不上传。
 */
import { compressToDataUrl, putLocalImage } from './local-image-store';

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

export interface GeoImageNode { assetId: string; lat: number; lon: number; ts: number }

/** 就近匹配:该地的到访点 coords 与带图节点比,取 25km 内最近的一张(并列取最近记的)。 */
export function matchPlacePhotoAsset(coords: Array<{ lat: number; lon: number }>, imageNodes: GeoImageNode[]): string | null {
  if (!coords.length || !imageNodes.length) return null;
  let best: GeoImageNode | null = null;
  let bestD = Infinity;
  for (const n of imageNodes) {
    for (const c of coords) {
      const d = haversineKm(c.lat, c.lon, n.lat, n.lon);
      if (d < bestD || (d === bestD && best && n.ts > best.ts)) { bestD = d; best = n; }
    }
  }
  return best && bestD <= 25 ? best.assetId : null;
}
