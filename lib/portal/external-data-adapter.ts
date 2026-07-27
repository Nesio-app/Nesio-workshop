/**
 * external-data-adapter — 外部数据源统一契约。
 * 银行/健康/天气/日历等 pull 源实现同一接口;同步调度仍各走 connector。
 */

export type ExternalAdapterKind =
  | 'bank'
  | 'health'
  | 'weather'
  | 'calendar'
  | 'mail'
  | 'vehicle'
  | 'other';

export interface ExternalSyncResult {
  ok: boolean;
  kind: ExternalAdapterKind;
  /** 写入/刷新的记录数 */
  count: number;
  message?: string;
  syncedAt?: string;
}

export interface ExternalDataAdapter {
  kind: ExternalAdapterKind;
  id: string;
  label: string;
  /** 本机是否已配置/可同步 */
  isConfigured: () => boolean;
  /** 拉取并落本地权威存储 */
  sync: () => Promise<ExternalSyncResult>;
}

const adapters = new Map<string, ExternalDataAdapter>();

export function registerExternalAdapter(adapter: ExternalDataAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getExternalAdapter(id: string): ExternalDataAdapter | undefined {
  return adapters.get(id);
}

export function listExternalAdapters(): ExternalDataAdapter[] {
  return [...adapters.values()];
}

/** 启动时登记已知 pull 源骨架(业务仍走各自 connector;禁止旁路再造同职责 fetch)。 */
export function ensureDefaultExternalAdapters(): void {
  if (adapters.has('weather')) return;
  registerExternalAdapter({
    kind: 'weather',
    id: 'weather',
    label: 'Weather',
    isConfigured: () => true,
    sync: async () => ({
      ok: true,
      kind: 'weather',
      count: 0,
      message: 'delegate:providers/weather',
      syncedAt: new Date().toISOString(),
    }),
  });
  for (const id of ['flight-status', 'fx-rate', 'poi-enrich', 'cgm-stream'] as const) {
    registerExternalAdapter({
      kind: 'other',
      id,
      label: id,
      isConfigured: () => false,
      sync: async () => ({
        ok: false,
        kind: 'other',
        count: 0,
        message: 'reserved',
      }),
    });
  }
}

ensureDefaultExternalAdapters();
