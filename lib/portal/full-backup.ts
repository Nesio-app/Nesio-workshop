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
  /** 备份里损坏/不可解析、无法恢复的键(不覆盖本机原串,返回给 UI 提示)。 */
  corruptKeys: string[];
}

interface GraphNodeLike { id?: string; createdAt?: string }

/**
 * Union two life-graph arrays by node id, keeping the newer copy.
 * 关键:区分「备份该条损坏」与「空」。备份(incoming)解析失败/非数组 →
 * corrupt=true、merged=null,调用方据此**不写回**(否则静默当空覆盖本机 =
 * 假成功)。本机(current)损坏时当空并入(备份有效即视为一次有效恢复)。
 */
function mergeLifeGraphs(currentRaw: string | null, incomingRaw: string): { merged: string | null; corrupt: boolean } {
  const parse = (s: string | null): GraphNodeLike[] | null => {
    try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : null; }
    catch { return null; }
  };
  const incoming = parse(incomingRaw);
  if (incoming === null) return { merged: null, corrupt: true };
  const current = parse(currentRaw) ?? [];
  const byId = new Map<string, GraphNodeLike>();
  for (const n of [...current, ...incoming]) {
    if (!n?.id) continue;
    const prev = byId.get(n.id);
    if (!prev || String(n.createdAt || '') > String(prev.createdAt || '')) byId.set(n.id, n);
  }
  return { merged: JSON.stringify(Array.from(byId.values())), corrupt: false };
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
  const corruptKeys: string[] = [];
  let restoredKeys = 0;
  let mergedNodes: number | undefined;

  for (const [key, value] of Object.entries(backup.entries)) {
    if (!isBackupKey(key)) { skippedKeys.push(key); continue; }

    if (mode === 'merge' && key === 'nesio-life-graph-v1') {
      const { merged, corrupt } = mergeLifeGraphs(storage.getItem(key), value);
      if (corrupt || merged === null) {
        // 备份该条损坏:不能静默当空覆盖本机 → 记为损坏,保留本机原串抢救机会
        corruptKeys.push(key);
        continue;
      }
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

  return { restoredKeys, mergedNodes, skippedKeys, corruptKeys };
}
