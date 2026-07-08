/**
 * Restore drill: export → wipe device → import must reproduce full state.
 * Runs lib/portal/full-backup.ts against a fake Storage — verifies the
 * backup actually round-trips before a user bets a device migration on it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

function loadTs(relPath, requireImpl) {
  const p = new URL(relPath, import.meta.url);
  const compiled = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require: requireImpl, Date, JSON, console }, { filename: fileURLToPath(p) });
  return mod.exports;
}

function loadLib() {
  // full-backup 现在把 key 判断收敛到 storage-manifest —— vm 加载时把它接起来。
  const manifest = loadTs('../lib/portal/storage-manifest.ts', () => ({}));
  return loadTs('../lib/portal/full-backup.ts', (spec) => (spec === './storage-manifest' ? manifest : {}));
}

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

const { buildFullBackup, isValidBackup, restoreFullBackup } = loadLib();

// ── Drill 1: full replace round-trip ─────────────────────────────────────────
{
  const device1 = fakeStorage({
    'nesio-life-graph-v1': JSON.stringify([{ id: 'n1', name: '钥匙', createdAt: '2026-07-01' }]),
    'nesio-projects-v1': '[{"id":"p1"}]',
    'nesio-mirror-profile-v1': '{"hourEngagement":[]}',
    'treasurebox-theme': 'dark',
    'nesio-email-signals-cache': 'transient — must be excluded',
    'unrelated-key': 'must not be touched',
  });

  const backup = buildFullBackup(device1);
  assert.equal(isValidBackup(backup), true);
  assert.equal('nesio-email-signals-cache' in backup.entries, false, 'caches excluded');
  assert.equal('unrelated-key' in backup.entries, false, 'foreign keys excluded');
  assert.equal(Object.keys(backup.entries).length, 4);

  // Survives serialization (what actually lands in the .json file)
  const fromFile = JSON.parse(JSON.stringify(backup));
  assert.equal(isValidBackup(fromFile), true);

  const device2 = fakeStorage(); // brand-new device
  const result = restoreFullBackup(device2, fromFile, 'replace');
  assert.equal(result.restoredKeys, 4);
  for (const key of Object.keys(backup.entries)) {
    assert.equal(device2.getItem(key), device1.getItem(key), `roundtrip: ${key}`);
  }
}

// ── Drill 2: merge keeps local data and unions the graph ─────────────────────
{
  const backup = {
    format: 'nesio-full-backup', version: 1, exportedAt: '2026-07-01T00:00:00Z',
    entries: {
      'nesio-life-graph-v1': JSON.stringify([
        { id: 'old', name: '旧记忆', createdAt: '2026-06-01' },
        { id: 'both', name: '备份版', createdAt: '2026-06-10' },
      ]),
      'nesio-projects-v1': '[{"id":"from-backup"}]',
    },
  };
  const device = fakeStorage({
    'nesio-life-graph-v1': JSON.stringify([
      { id: 'new', name: '本机新记忆', createdAt: '2026-07-02' },
      { id: 'both', name: '本机较新版', createdAt: '2026-07-01' },
    ]),
    'nesio-projects-v1': '[{"id":"local"}]',
  });

  const result = restoreFullBackup(device, backup, 'merge');
  const graph = JSON.parse(device.getItem('nesio-life-graph-v1'));
  const ids = graph.map((n) => n.id).sort();
  assert.deepEqual(ids, ['both', 'new', 'old'], 'graph unioned by id');
  assert.equal(graph.find((n) => n.id === 'both').name, '本机较新版', 'newer copy wins');
  assert.equal(result.mergedNodes, 3);
  assert.equal(device.getItem('nesio-projects-v1'), '[{"id":"local"}]', 'merge never clobbers existing keys');
}

// ── Drill 2b: 备份里 life-graph 损坏 —— 不静默当空覆盖本机(静默失败审计 #3)──
{
  const localGraph = JSON.stringify([{ id: 'keep', name: '本机记忆', createdAt: '2026-07-01' }]);
  const backup = {
    format: 'nesio-full-backup', version: 1, exportedAt: '2026-07-01',
    entries: { 'nesio-life-graph-v1': '{半截损坏的 JSON', 'nesio-projects-v1': '[{"id":"p1"}]' },
  };
  const device = fakeStorage({ 'nesio-life-graph-v1': localGraph });
  const result = restoreFullBackup(device, backup, 'merge');
  // corruptKeys 是 vm 子 realm 的数组,跨 realm deepStrictEqual 会因原型不同判不等 → 逐元素比
  assert.equal(result.corruptKeys.length, 1, '损坏备份条目记入 corruptKeys(1 项)');
  assert.equal(result.corruptKeys[0], 'nesio-life-graph-v1', 'corruptKeys 含 life-graph 键');
  assert.equal(device.getItem('nesio-life-graph-v1'), localGraph, '本机原串保留、未被空覆盖(抢救机会不失)');
  assert.equal(result.mergedNodes, undefined, '损坏则不计合并节点数');
  assert.equal(device.getItem('nesio-projects-v1'), '[{"id":"p1"}]', '其余有效键正常恢复');
}

// ── Drill 3: invalid files rejected ──────────────────────────────────────────
{
  assert.equal(isValidBackup(null), false);
  assert.equal(isValidBackup({ format: 'other' }), false);
  assert.equal(isValidBackup({ format: 'nesio-full-backup', version: 2, entries: {} }), false);
  assert.equal(isValidBackup([{ id: 'raw-graph-export' }]), false, 'old memory-only export is not a full backup');
}

console.log('full-backup roundtrip: all drills passed');
