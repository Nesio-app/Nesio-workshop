/**
 * geo — 地点共享原语(全仓唯一 haversine / placeKey)。
 * 旅行 POI、足迹、命名地点、分享图一律从此 import,禁止再抄一份。
 */

/** 球面距离(公里)。 */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** 球面距离(米)——命名地点半径匹配用。 */
export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  return haversineKm(aLat, aLon, bLat, bLon) * 1000;
}

const GENERIC_PLACE_RE = /^(unknown|未知|未知地点|aliased location|searched address|地址)$/i;

export function isGenericPlaceLabel(label: string): boolean {
  return GENERIC_PLACE_RE.test((label || '').trim());
}

/**
 * 地点稳定键:有名用名;无名占位 + 坐标 → ~1km 粗桶,避免「Unknown」糊成一点。
 * 与足迹/POI/行程共享同一套键语义。
 */
export function placeKey(label: string, lat?: number, lon?: number): string {
  const name = (label || '').trim() || '未知地点';
  if (isGenericPlaceLabel(name) && lat != null && lon != null) {
    return `${name} ·${lat.toFixed(2)},${lon.toFixed(2)}`;
  }
  return name;
}

/** 粗 geo 桶(约 1km),无标签时也能跨模块对齐。 */
export function geoBucketKey(lat: number, lon: number, precision = 2): string {
  return `geo:${lat.toFixed(precision)},${lon.toFixed(precision)}`;
}
