/**
 * Full Backup — export/restore of ALL local app state, not just the life graph.
 *
 * The old Settings export covered only nesio-life-graph-v1; the other 30+
 * localStorage keys (projects, experiments, mood baseline, freeze vault,
 * mirror profile, dormant store, …) were lost on device migration. A backup
 * now captures every app key except transient caches, as opaque strings —
 * no schema coupling, so new keys are included automatically.
 *
 * Storage access goes through a minimal interface so the restore drill
 * (scripts/full-backup-roundtrip.test.mjs) can run against a fake store.
 */

// 备份的「哪些 key 该进」判断收敛到 storage-manifest(单一真源):现在也覆盖
// baohe_/analyst_ 前缀(此前漏),并统一排除 auth 票据(安全)+ cache(减 bloat)。
import { isBackupKey, type StorageLike } from './storage-manifest';

export type { StorageLike };

export interface FullBackup {
  format: 'nesio-full-backup';
  version: 1;
  exportedAt: string;
  entries: Record<string, string>;
}

export function buildFullBackup(storage: StorageLike): FullBackup {
  const entries: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !isBackupKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) entries[key] = value;
  }
  return {
    format: 'nesio-full-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  };
}

export function isValidBackup(raw: unknown): raw is FullBackup {
  const b = raw as FullBackup | null;
  return Boolean(
    b && b.format === 'nesio-full-backup' && b.version === 1 &&
    b.entries && typeof b.entries === 'object' && !Array.isArray(b.entries),
  );
}

export interface RestoreResult {
  restoredKeys: number;
  mergedNodes?: number;
  skippedKeys: string[];
}

interface GraphNodeLike { id?: string; createdAt?: string }

/** Union two life-graph arrays by node id, keeping the newer copy. */
function mergeLifeGraphs(currentRaw: string | null, incomingRaw: string): string {
  const parse = (s: string | null): GraphNodeLike[] => {
    try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
  };
  const current = parse(currentRaw);
  const incoming = parse(incomingRaw);
  const byId = new Map<string, GraphNodeLike>();
  for (const n of [...current, ...incoming]) {
    if (!n?.id) continue;
    const prev = byId.get(n.id);
    if (!prev || String(n.createdAt || '') > String(prev.createdAt || '')) byId.set(n.id, n);
  }
  return JSON.stringify(Array.from(byId.values()));
}

/**
 * Restore a backup.
 * - 'replace': every backed-up key overwrites the local value.
 * - 'merge': life graph unions by node id (newer wins); every other key is
 *   only written when missing locally — safe on a device that has data.
 */
export function restoreFullBackup(
  storage: StorageLike,
  backup: FullBackup,
  mode: 'merge' | 'replace',
): RestoreResult {
  const skippedKeys: string[] = [];
  let restoredKeys = 0;
  let mergedNodes: number | undefined;

  for (const [key, value] of Object.entries(backup.entries)) {
    if (!isBackupKey(key)) { skippedKeys.push(key); continue; }

    if (mode === 'merge' && key === 'nesio-life-graph-v1') {
      const merged = mergeLifeGraphs(storage.getItem(key), value);
      storage.setItem(key, merged);
      try { mergedNodes = (JSON.parse(merged) as unknown[]).length; } catch { /* count unavailable */ }
      restoredKeys++;
      continue;
    }

    if (mode === 'merge' && storage.getItem(key) !== null) {
      skippedKeys.push(key);
      continue;
    }

    storage.setItem(key, value);
    restoredKeys++;
  }

  return { restoredKeys, mergedNodes, skippedKeys };
}
