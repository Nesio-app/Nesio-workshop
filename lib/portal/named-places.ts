export interface NamedPlace {
  id: string;
  name: string;
  emoji: string;
  lat: number;
  lon: number;
  radiusMeters: number;
  rooms: string[];
  subRooms: Record<string, string[]>;
}

const STORAGE_KEY = 'nesio-named-places';

const DEFAULT_HOME: NamedPlace = {
  id: 'home',
  name: '家',
  emoji: '🏠',
  lat: 0,
  lon: 0,
  radiusMeters: 150,
  rooms: ['客厅', '卧室', '书房', '厨房', '卫生间', '阳台', '门口', '储物间'],
  subRooms: {
    客厅: ['电视柜', '沙发旁', '茶几', '书架', '边柜'],
    卧室: ['床头柜', '衣柜', '梳妆台', '床底'],
    书房: ['书桌', '书架', '文件柜', '抽屉'],
    厨房: ['橱柜', '冰箱', '台面', '抽屉'],
    储物间: ['上层', '中层', '下层', '角落'],
  },
};

export function getNamedPlaces(): NamedPlace[] {
  if (typeof window === 'undefined') return [DEFAULT_HOME];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [DEFAULT_HOME];
    const parsed = JSON.parse(raw) as NamedPlace[];
    return parsed.length ? parsed : [DEFAULT_HOME];
  } catch {
    return [DEFAULT_HOME];
  }
}

export function saveNamedPlaces(places: NamedPlace[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
}

export function upsertNamedPlace(place: NamedPlace): void {
  const places = getNamedPlaces();
  const idx = places.findIndex((p) => p.id === place.id);
  if (idx >= 0) places[idx] = place;
  else places.push(place);
  saveNamedPlaces(places);
}

export function deleteNamedPlace(id: string): void {
  saveNamedPlaces(getNamedPlaces().filter((p) => p.id !== id));
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function matchNearestPlace(lat: number, lon: number): NamedPlace | null {
  const places = getNamedPlaces().filter((p) => p.lat !== 0 || p.lon !== 0);
  let best: NamedPlace | null = null;
  let bestDist = Infinity;
  for (const p of places) {
    const d = haversine(lat, lon, p.lat, p.lon);
    if (d < p.radiusMeters && d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export function formatLocation(placeId: string, room: string, subRoom: string): string {
  const places = getNamedPlaces();
  const place = places.find((p) => p.id === placeId);
  if (!place) return [placeId, room, subRoom].filter(Boolean).join(' · ');
  // 设计:存放位置显示一律线性无 emoji(🏠 等图形字符不进 UI 文本)。只保留地点名,
  // 图标交给渲染层。存储是结构化 placeId/room/subRoom,这里纯展示,去 emoji 不影响匹配。
  const parts = [place.name];
  if (room) parts.push(room);
  if (subRoom) parts.push(subRoom);
  return parts.join(' · ');
}

/**
 * 批次192(存放位置闭环):把物品存的位置解析成**当前**显示串。
 * 有稳定 placeId → 用当前命名地点重建(命名地点改名后自动传导到所有物品);
 * 没有 placeId(自由文本/老数据)→ 回退存的 location 字符串。
 */
export function displayStoredLocation(attrs: Record<string, unknown> | null | undefined): string {
  const pid = typeof attrs?.placeId === 'string' ? attrs.placeId : '';
  if (pid && getNamedPlaces().some((p) => p.id === pid)) {
    return formatLocation(
      pid,
      typeof attrs?.placeRoom === 'string' ? attrs.placeRoom : '',
      typeof attrs?.placeSubRoom === 'string' ? attrs.placeSubRoom : '',
    );
  }
  return typeof attrs?.location === 'string' ? attrs.location : '';
}
