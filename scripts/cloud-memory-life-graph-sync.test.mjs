import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const lifeGraphPath = path.join(root, 'lib', 'portal', 'life-graph.ts');
const memoryTabPath = path.join(root, 'components', 'portal', 'MemoryTab.tsx');
const packagePath = path.join(root, 'package.json');

const lifeGraph = fs.readFileSync(lifeGraphPath, 'utf8');
const memoryTab = fs.readFileSync(memoryTabPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'cloudMemorySyncEnabled',
  'CLOUD_SYNC_STATUS_KEY',
  'CLOUD_SYNC_OUTBOX_KEY',
  'export type CloudSyncStatus',
  'export function getLifeGraphCloudSyncSummary',
  'export function getLifeGraphCloudSyncRecords',
  'export interface LifeGraphCloudSyncOutboxItem',
  'export async function retryLifeGraphCloudSync',
  'queueCloudSyncOutboxItem',
  'removeCloudSyncOutboxItem',
  'markCloudSyncPending',
  'markCloudSyncSynced',
  'markCloudSyncFailed',
  'syncLifeGraphUpsertToCloud',
  'syncLifeGraphDeleteToCloud',
  '/api/cloud/memory',
  'credentials: \'include\'',
  'void syncLifeGraphUpsertToCloud(newNode)',
  'void syncLifeGraphUpsertToCloud(nodes[idx])',
  'void syncLifeGraphDeleteToCloud(id)',
  'return newNode',
  'return true',
]) {
  assert.ok(lifeGraph.includes(marker), `life-graph cloud sync missing marker: ${marker}`);
}

for (const marker of [
  'export function mergeCloudMemorySnapshot',
  'incomingAssetsByNodeId',
  'saveAll(mergedNodes)',
  'nesio-life-graph-cloud-hydrated',
]) {
  assert.ok(lifeGraph.includes(marker), `life-graph cloud hydration missing marker: ${marker}`);
}

for (const marker of [
  'export async function backfillLocalLifeGraphToCloud',
  'const nodes = loadAll()',
  'nodes.slice(0, limit)',
  'flatMap((node) =>',
  'node.assets',
  'body: JSON.stringify({ nodes: backfillNodes, assets: backfillAssets, backfill: true })',
  'attemptedNodeCount: backfillNodes.length',
]) {
  assert.ok(lifeGraph.includes(marker), `life-graph cloud backfill missing marker: ${marker}`);
}

for (const marker of [
  'getLifeGraphCloudSyncRecords().filter',
  'record.status === \'pending\' || record.status === \'failed\'',
  'const outboxItemsByKey = loadCloudSyncOutboxMap()',
  'removeCloudSyncOutboxItem(item.resourceId, item.operation)',
  'retriedCount',
  'succeededCount',
  'failedCount',
]) {
  assert.ok(lifeGraph.includes(marker), `life-graph cloud sync retry missing marker: ${marker}`);
}

// 存储修复:同步 outbox 不再持久化整条节点 —— 否则未登录设备上它在 localStorage
// 里堆成第二份完整图谱,顶爆 ~5MB 配额(用户实测 761 条待同步 + 空间满)。
// retry 时从权威图谱按 id 取回;首写/Memory 挂载时压缩旧胖 outbox 回收空间。
for (const marker of [
  'compactCloudSyncOutboxOnce',
  'const graphById = new Map(loadAll().map',
]) {
  assert.ok(lifeGraph.includes(marker), `life-graph slim-outbox missing marker: ${marker}`);
}
const outboxIface = lifeGraph.match(/export interface LifeGraphCloudSyncOutboxItem \{[\s\S]*?\n\}/)?.[0] || '';
assert.ok(outboxIface, 'LifeGraphCloudSyncOutboxItem interface must exist');
assert.ok(!/node\?:\s*LifeNode/.test(outboxIface), 'cloud-sync outbox must not persist a full node copy (localStorage bloat / quota exhaustion).');

for (const marker of [
  'createAppApiClient',
  'fetchCloudMemorySnapshot',
  'mergeCloudMemorySnapshot',
  'retryLifeGraphCloudSync',
  'getLifeGraphCloudSyncSummary',
  'backfillLocalLifeGraphToCloud',
  'cloudSyncSummary',
  'setCloudSyncSummary',
  'nesio-life-graph-cloud-sync-updated',
  'nesio-memory-sync-status',
  '同步失败',
  '等待同步',
  '已同步',
    'void retryLifeGraphCloudSync()',
  'void backfillLocalLifeGraphToCloud',
  "const retrySync = () => { if (canUsePrivateData) void retryLifeGraphCloudSync(); }",
  'window.addEventListener(\'online\', retrySync)',
  'window.addEventListener(\'nesio-life-graph-cloud-sync-updated\', onSyncUpdate)',
  'window.removeEventListener(\'online\', retrySync)',
  'window.removeEventListener(\'nesio-life-graph-cloud-sync-updated\', onSyncUpdate)',
  'setNodes(readNodes())',
]) {
  assert.ok(memoryTab.includes(marker), `MemoryTab cloud hydration missing marker: ${marker}`);
}

assert.match(
  memoryTab,
  /const retrySync = \(\) => \{ if \(canUsePrivateData\) void retryLifeGraphCloudSync\(\); \}/,
  'MemoryTab must retry pending/failed cloud Memory sync only when private signed-in data is allowed.',
);
assert.match(
  memoryTab,
  /const onSyncUpdate = \(\) => setCloudSyncSummary\(getLifeGraphCloudSyncSummary\(\)\)/,
  'MemoryTab must refresh visible cloud sync summary when cloud sync status changes.',
);
assert.match(
  memoryTab,
  /cloudSyncSummary\.failedCount > 0[\s\S]*copy\.syncFailed\(cloudSyncSummary\.failedCount\)/,
  'MemoryTab must surface failed cloud Memory sync instead of hiding backend failures.',
);
assert.match(
  memoryTab,
  /cloudSyncSummary\.pendingCount > 0[\s\S]*copy\.syncPending\(cloudSyncSummary\.pendingCount\)/,
  'MemoryTab must surface pending local-first Memory sync while offline or retrying.',
);

assert.match(
  lifeGraph,
  /catch\s*\([^)]*\)\s*\{[\s\S]*markCloudSyncFailed/,
  'cloud sync failures must be recorded so local-first Memory does not silently pretend cloud persistence succeeded.',
);
assert.match(
  lifeGraph,
  /if\s*\(!response\.ok\)[\s\S]*throw new Error\('cloud_memory_sync_failed'\)/,
  'non-2xx cloud memory writes must be marked failed instead of counted as synced.',
);
assert.match(
  lifeGraph,
  /queueCloudSyncOutboxItem\([^)]*node[^)]*'upsert'/,
  'upsert payloads must be queued locally before best-effort cloud sync.',
);
assert.match(
  lifeGraph,
  /queueCloudSyncOutboxItem\([^)]*id[^)]*'delete'/,
  'delete tombstones must be queued locally before best-effort cloud sync.',
);
assert.match(
  lifeGraph,
  /body: JSON\.stringify\(\{ nodes: \[node\], assets \}\)/,
  'retry must replay upsert payloads reconstructed from the authoritative graph (outbox stores id only, not a node copy).',
);
assert.match(
  lifeGraph,
  /body: JSON\.stringify\(\{ nodeId: item\.resourceId \}\)/,
  'retry must replay queued delete tombstones.',
);
assert.match(
  memoryTab,
  /async function hydrateCloud\(\)[\s\S]*catch \{ \/\* best-effort \*\/ \}/,
  'cloud hydration failures must be swallowed so signed-in Memory still works offline.',
);
assert.doesNotMatch(
  lifeGraph,
  /await\s+syncLifeNodeToCloud/,
  'local Memory writes must not block on cloud sync.',
);
assert.doesNotMatch(
  memoryTab,
  /await\s+backfillLocalLifeGraphToCloud/,
  'signed-in local-to-cloud backfill must not block Memory hydration/rendering.',
);
assert.doesNotMatch(
  lifeGraph,
  /deleteMissing|deleteUnmatched|filter\(\(node\)\s*=>\s*incoming/,
  'cloud hydration must not delete unmatched local Memory nodes by default.',
);
assert.equal(
  pkg.scripts['test:cloud-memory-life-graph-sync'],
  'node scripts/cloud-memory-life-graph-sync.test.mjs',
  'package.json must expose cloud memory life-graph sync test.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:cloud-memory-life-graph-sync/,
  'test:contracts must include cloud memory life-graph sync test.',
);

console.log('cloud memory life-graph sync contract passed');
