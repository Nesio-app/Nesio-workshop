/**
 * Tesla 上次成功快照 —— IDB durable(与银行流水同档)。
 * 实时仍走 API;车休眠时坐标常空,界面必须能立刻拿出上次看到的位置/电量,
 * 而不是每次进页从零 loading。
 */
import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';

export const TESLA_SNAPSHOT_KEY = 'nesio-tesla-snapshot-v1';
export const TESLA_SNAPSHOT_UPDATED = 'nesio-tesla-snapshot-updated';

export type TeslaSnapshotDrive = {
  vehicleId: string;
  displayName?: string;
  at: string;
  latitude?: number | null;
  longitude?: number | null;
  odometerMi?: number | null;
  locationStale?: boolean;
};

export type TeslaSnapshotCharge = {
  vehicleId: string;
  displayName?: string;
  at: string;
  batteryLevel?: number | null;
  chargingState?: string;
  rangeMi?: number | null;
  chargeLimitPct?: number | null;
  costUsd?: number | null;
  energyAddedKwh?: number | null;
  location?: string;
};

export type TeslaSnapshot = {
  at: string;
  drives: TeslaSnapshotDrive[];
  charges: TeslaSnapshotCharge[];
  health: unknown[];
  energy: unknown;
  locationHint?: 'ok' | 'scope' | 'asleep' | 'unknown';
  placeByVehicle?: Record<string, string>;
};

const store = createBlobStore<TeslaSnapshot>({
  key: TESLA_SNAPSHOT_KEY,
  updateEvent: TESLA_SNAPSHOT_UPDATED,
  validate: (v) => Boolean(v && typeof v === 'object' && Array.isArray((v as TeslaSnapshot).drives)),
  onWriteError: reportStorageDropped,
  syncSeed: true,
});

export function readTeslaSnapshot(): TeslaSnapshot | null {
  return store.load();
}

export function saveTeslaSnapshot(snap: TeslaSnapshot): void {
  store.save(snap);
}

export function whenTeslaSnapshotReady(): Promise<void> {
  return store.ready();
}

/** 新快照没坐标时,把上次看到的经纬度补回去(休眠会抹坐标)。 */
export function mergeLastKnownLocation<T extends TeslaSnapshotDrive>(
  next: T[],
  previous: TeslaSnapshotDrive[] | undefined,
): T[] {
  if (!previous?.length) return next;
  const last = new Map(previous.map((d) => [d.vehicleId, d]));
  return next.map((d) => {
    if (d.latitude != null && d.longitude != null) return { ...d, locationStale: false };
    const prev = last.get(d.vehicleId);
    if (prev?.latitude == null || prev.longitude == null) return d;
    return {
      ...d,
      latitude: prev.latitude,
      longitude: prev.longitude,
      locationStale: true,
    };
  });
}
