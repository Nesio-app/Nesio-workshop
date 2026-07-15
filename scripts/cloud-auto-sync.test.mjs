/**
 * 行为契约:前台自动云同步(批次198 P1 · 把记忆图存进账号级银行)。
 * 锁死:
 *  - 共享 syncMemoryWithCloud:拉云快照 → 合并 → backfill,带节流。
 *  - Portal 顶层在登录态(canUsePrivateRuntime)触发,并监听 visibilitychange 回前台再拉。
 *  - mergeCloudMemorySnapshot 是 last-write-wins(按 attributes.updatedAt),不覆盖本地新编辑
 *    —— 这是自动拉云的安全前提,防止陈旧云快照盖掉本地更新的编辑(丢数据)。
 *  - 免费(P3):同步路径不查 hasCloudEntitlement —— durability 不锁付费墙。
 *  - 云快照契约诚实声明前台读同步 + last_write_wins,且仍无后台同步。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ── 共享同步模块 ──
const sync = read('../lib/portal/cloud-memory-sync.ts');
assert.match(sync, /export async function syncMemoryWithCloud/, '导出 syncMemoryWithCloud');
assert.match(sync, /fetchCloudMemorySnapshot/, '拉云端快照');
assert.match(sync, /mergeCloudMemorySnapshot/, '合并进本地图谱');
assert.match(sync, /backfillLocalLifeGraphToCloud/, '顺带 backfill 本地→云');
assert.match(sync, /MIN_INTERVAL_MS|force/, '带节流,避免 mount+visibility 重复真拉');
// P3:durability 免费 —— 同步不查权益门
assert.ok(!/hasCloudEntitlement/.test(sync), 'P3:自动同步不锁付费墙(不查 hasCloudEntitlement)');

// ── Portal 顶层触发 ──
const portal = read('../components/portal/Portal.tsx');
assert.match(portal, /import \{ syncMemoryWithCloud \} from '@\/lib\/portal\/cloud-memory-sync'/, 'Portal 引入共享同步');
const portalHasTrigger = /canUsePrivateRuntime\)\s*return;[\s\S]*?syncMemoryWithCloud\(\)/.test(portal)
  && /visibilitychange/.test(portal);
assert.ok(portalHasTrigger, 'Portal 登录后触发同步且监听 visibilitychange 回前台再拉');

// ── 合并 last-write-wins(数据安全前提)──
const lg = read('../lib/portal/life-graph.ts');
const mergeRegion = lg.slice(
  lg.indexOf('export function mergeCloudMemorySnapshot'),
  lg.indexOf('export async function backfillLocalLifeGraphToCloud'),
);
assert.match(mergeRegion, /stampOf/, '合并用编辑时间戳比较(stampOf)');
assert.match(mergeRegion, /updatedAt[\s\S]{0,40}createdAt/, '时间戳取 attributes.updatedAt,回退 createdAt');
assert.match(mergeRegion, /incomingWins/, 'last-write-wins:云端更新才胜,否则保留本地');
assert.ok(!/\{\s*\.\.\.localNode,\s*\.\.\.incomingNode,/.test(mergeRegion), '不再「云端无条件胜」(旧 {...local,...incoming} 已移除)');

// ── 云快照契约诚实声明 ──
function compileContract() {
  const src = read('../lib/portal/cloud-snapshot-contract.ts');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console });
  return mod.exports;
}
const contract = compileContract().buildCloudSnapshotContract();
assert.equal(contract.semantics.conflictResolution, 'last_write_wins', '冲突解决声明为 last_write_wins');
assert.equal(contract.semantics.foregroundReadSyncEnabled, true, '声明前台读同步已启用');
assert.equal(contract.boundaries.noBackgroundSync, true, '仍无后台同步(边界不变)');

console.log('cloud-auto-sync: OK');
