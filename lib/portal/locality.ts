/**
 * locality — 数据落点 / 离线语义登记表。
 * @see docs/design/data-locality-policy.md
 */

export type LocalityClass =
  | 'bundled'
  | 'precache'
  | 'device-authoritative'
  | 'cloud-only'
  | 'cloud-inference';

export interface LocalityEntry {
  id: string;
  locality: LocalityClass;
  note: string;
}

/** 核心登记表；新增 store/adapter 必须补一行（契约测试读取）。 */
export const LOCALITY_REGISTRY: LocalityEntry[] = [
  { id: 'signal-idb', locality: 'device-authoritative', note: 'Signal 主事实表' },
  { id: 'bank-tx', locality: 'device-authoritative', note: 'Plaid 流水本机 blob' },
  { id: 'expense-store', locality: 'device-authoritative', note: '跨域开销汇口 nesio-expenses-v1' },
  { id: 'place-trail', locality: 'device-authoritative', note: '足迹 IDB' },
  { id: 'named-places', locality: 'device-authoritative', note: '命名地点' },
  { id: 'apple-health', locality: 'device-authoritative', note: 'Apple Health 导入本机' },
  { id: 'health-insight-api', locality: 'cloud-inference', note: '本机事实 + 云推理' },
  { id: 'weather', locality: 'cloud-only', note: 'Open-Meteo；可短缓存' },
  { id: 'flight-status', locality: 'cloud-only', note: '预留：实时航班' },
  { id: 'fx-rate', locality: 'precache', note: '预留：出行前汇率表' },
  { id: 'poi-enrich', locality: 'cloud-only', note: '预留：POI 富信息' },
  { id: 'cgm-stream', locality: 'device-authoritative', note: '预留：CGM 本机流' },
  { id: 'nutrition-pack', locality: 'bundled', note: '做饭/营养静态包' },
  { id: 'travel-poi-pack', locality: 'bundled', note: '离线景点 JSON' },
  { id: 'trip-itinerary', locality: 'device-authoritative', note: '行程权威本机' },
];

export function localityOf(id: string): LocalityClass | undefined {
  return LOCALITY_REGISTRY.find((e) => e.id === id)?.locality;
}
