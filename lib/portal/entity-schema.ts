/**
 * entity-schema — 跨域实体焊点类型(Person / Place / Item / Dish / Meal / Trip / Expense)。
 * 解析入口尽量复用现有模块;这里只定契约,避免各域自造 ID。
 */

import { geoBucketKey, placeKey } from '@/lib/portal/geo';
import { getNamedPlaces } from '@/lib/portal/named-places';
import { canonicalPlaceLabel, displayLabel, loadPlaceTrail } from '@/lib/portal/place-trail';

export type EntityKind =
  | 'person'
  | 'place'
  | 'item'
  | 'dish'
  | 'meal'
  | 'trip'
  | 'expense'
  | 'ingredient';

export interface EntityRef {
  kind: EntityKind;
  id: string;
  /** 展示名(可变);id 稳定 */
  label?: string;
}

export type PlaceKind = 'visit' | 'named' | 'poi' | 'node';

export interface PlaceRef {
  id: string;
  label: string;
  lat?: number;
  lon?: number;
  kind: PlaceKind;
  sourceIds?: string[];
}

/** 地点解析:优先稳定 placeId,否则 label+坐标 → placeKey / geo 桶。 */
export function resolvePlaceKey(input: {
  placeId?: string;
  label?: string;
  lat?: number;
  lon?: number;
}): string {
  if (input.placeId?.trim()) return `place:${input.placeId.trim()}`;
  if (input.lat != null && input.lon != null) {
    const label = (input.label || '').trim();
    if (label) return placeKey(label, input.lat, input.lon);
    return geoBucketKey(input.lat, input.lon);
  }
  const label = (input.label || '').trim();
  return label ? placeKey(label) : 'place:unknown';
}

/** 规范显示名:改名表 → 显示别名 → 原文。 */
export function resolvePlaceLabel(raw: string): string {
  if (!raw) return '';
  const canon = canonicalPlaceLabel(raw.trim());
  return displayLabel(canon) || canon;
}

/**
 * 从命名地点 + 足迹解析 PlaceRef(读时不写)。
 * 旅行 POI / 在外吃 / 足迹共用此门。
 */
export function resolvePlace(raw: string): PlaceRef | null {
  const label = resolvePlaceLabel(raw);
  if (!label) return null;
  const id = resolvePlaceKey({ label });

  const named = getNamedPlaces().find(
    (p) => p.name.trim().toLowerCase() === label.toLowerCase() || p.id === raw,
  );
  if (named) {
    return {
      id: `named:${named.id}`,
      label: named.name,
      lat: named.lat || undefined,
      lon: named.lon || undefined,
      kind: 'named',
      sourceIds: [named.id],
    };
  }

  const hit = loadPlaceTrail().find((v) => resolvePlaceLabel(v.label) === label);
  if (hit) {
    return {
      id,
      label,
      lat: hit.lat,
      lon: hit.lon,
      kind: 'visit',
      sourceIds: [hit.label],
    };
  }

  return { id, label, kind: 'poi', sourceIds: [raw] };
}

export function entityRefKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.id}`;
}
