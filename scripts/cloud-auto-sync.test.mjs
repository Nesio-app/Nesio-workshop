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
assert.match(portal, /runCloudSyncBatch\(CLOUD_SYNC_TASKS\)/, 'Portal 经批次 runner 触发云同步');
const portalHasTrigger = /canSyncPrivateData\)\s*return;[\s\S]*?runCloudSyncBatch\(CLOUD_SYNC_TASKS\)/.test(portal)
  && /visibilitychange/.test(portal);
assert.ok(portalHasTrigger, 'Portal 登录后触发同步且监听 visibilitychange 回前台再拉');

// ── 合并 last-write-wins(数据安全前提)──
const lg = read('../lib/portal/life-graph.ts');
const mergeRegion = lg.slice(
  lg.indexOf('export function mergeCloudMemorySnapshot'),
  lg.indexOf('export async function backfillLocalLifeGraphToCloud'),
);
assert.match(mergeRegion, /mergeConflictingNodes/, '合并委托 mergeConflictingNodes(批次209:含 attributes/tags 并集)');
assert.ok(!/\{\s*\.\.\.localNode,\s*\.\.\.incomingNode,/.test(mergeRegion), '不再「云端无条件胜」(旧 {...local,...incoming} 已移除)');

// 合并粒度契约在 life-node-merge.ts(纯逻辑,行为测试见 node-conflict-merge.test.mjs)
const merge = read('../lib/portal/life-node-merge.ts');
assert.match(merge, /updatedAt[\s\S]{0,40}createdAt/, '时间戳取 attributes.updatedAt,回退 createdAt');
assert.match(merge, /bWins\s*\?\s*b\s*:\s*a/, 'last-write-wins:新者(updatedAt 大)赢标量');
assert.match(merge, /attributes:\s*\{[\s\S]{0,40}loser\.attributes[\s\S]{0,40}winner\.attributes/, 'attributes 两侧并集(较旧侧独有属性键不丢 ← 批次209 修复)');
assert.match(merge, /tags:\s*Array\.from\(new Set/, 'tags 两侧并集去重');

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

// ── 全量数据跨浏览器同步(健康/足迹/银行流水… 先拉后推,交接清单)──
// 换浏览器登录后自动从云拉回全量本地大数据,一个都不能丢;数据安全第一。
const backup = read('../lib/portal/cloud-backup.ts');
assert.match(backup, /export async function autoSyncBackupWithCloud/, '导出 autoSyncBackupWithCloud(先拉后推编排)');
// 命门①②:pull 走服务端「按账号找最新」,不再依赖本地 last-backup 记录(新浏览器为空 → 拉不回)
assert.match(backup, /\/api\/cloud\/assets\?list=backup/, 'pull 问服务端要账号下最新备份签名 URL(跨浏览器命门)');
assert.ok(!/const last = lastCloudBackup\(\);\s*\n\s*if \(!last\?\.storagePath\) return \{ ok: false, error: 'no_backup' \}/.test(backup), 'pull 不再靠本地 last-backup 记录判 no_backup(否则新浏览器永远拉不回)');
// 先拉后推:pull 成功分支处理(首刷 reload + 推),云端空(no_backup)也推,其余失败态不推
assert.match(backup, /const pull = await pullBackupFromCloud\('merge'\)/, '先拉(merge)');
assert.match(backup, /if \(pull\.ok\)\s*\{[\s\S]{0,1400}scheduleAutoPush\(/, 'pull 成功分支里安排防抖 push(先拉后推)');
assert.match(backup, /pull\.error === 'no_backup'[\s\S]{0,320}scheduleAutoPush\(/, '云端确实空也推(首次上云)');
// 高水位:云端「最完整」那份比本浏览器已反映的更全(cloudN>prevN)且有恢复 → reload 重新水合。
// 用高水位而非一次性首刷标志,才能覆盖「空备份阶段刷过、真数据随后到达」(否则真数据永不显示)。
assert.match(backup, /cloudN > prevN && restoredSomething[\s\S]{0,60}location[\s\S]{0,20}reload/, '云端长大且有恢复 → reload 重新水合');
assert.match(backup, /SYNCED_HIGHWATER_KEY/, 'reload 由「已反映条目数」高水位守卫(只增、增长时才刷,防循环)');
assert.ok(!/FIRST_SYNC_DONE_FLAG/.test(backup), '一次性首刷标志已废弃(会漏掉后到的真数据)');
// 空数据保险丝:0 条目绝不上云(空浏览器绝不用空数据盖云端)
assert.match(backup, /entryCount === 0[\s\S]{0,80}ok: true/, '空数据保险丝:0 条目静默成功、不上云');
// 压缩:高冗余数据(健康/足迹)gzip 后上传;pull 按 gzip magic 字节自动解压(新旧兼容)。
// 用 fflate(纯 JS,所有浏览器都支持),不依赖原生 CompressionStream(旧 Safari 不支持会双向都挂)。
assert.match(backup, /from 'fflate'/, '用 fflate 压缩(纯 JS,全浏览器兼容)');
assert.match(backup, /gzipSync\(strToU8/, 'push 前 gzip 压缩');
assert.ok(!/new (Compression|Decompression)Stream/.test(backup), '不再实例化原生 CompressionStream(旧环境不支持)');
assert.match(backup, /0x1f && buf\[1\] === 0x8b/, 'pull 按 gzip magic 字节(1f 8b)识别并解压');
assert.match(backup, /gunzipToString/, 'pull 有解压路径');
// 防遮盖闸:本机比云端最新那份还少条目就不推(pull 回报 cloudEntryCount,自动推带 skipIfFewerThan)
assert.match(backup, /cloudEntryCount = Object\.keys\(parsed\.entries\)\.length/, 'pull 回报云端最新那份的条目数');
assert.match(backup, /skipIfFewerThan[\s\S]{0,120}entryCount < opts\.skipIfFewerThan[\s\S]{0,60}skippedRegression/, 'push:比云端少 → 跳过上传(防遮盖)');
assert.match(backup, /const cloudN = pull\.cloudEntryCount/, '取云端最完整那份的条目数');
assert.match(backup, /scheduleAutoPush\(cloudN\)/, '自动推带上云端条目数做防遮盖闸');
// 足迹主数据键不被 geo 缓存正则误伤(否则备份里没足迹,换机永远同步不过去)
const manifest = read('../lib/portal/storage-manifest.ts');
assert.ok(!/\|geo\)/.test(manifest.match(/const CACHE_RE =.*/)?.[0] || ''), 'CACHE_RE 不含裸 geo(否则误剔 nesio-place-geo-v1)');
// ③ durability 免费:hasCloudEntitlement 常开(登录即用),付费桩已拆
assert.match(backup, /export function hasCloudEntitlement\(\)[\s\S]{0,140}typeof window !== 'undefined'/, 'durability 免费:hasCloudEntitlement 常开,登录即用');
assert.ok(!/nesio-cloud-entitlement-v1/.test(backup), '④ 付费本地 flag 已拆(不再默认关/手动开)');
// ④ 合并逻辑复用(merge:节点 id union、已有不覆盖)—— restoreCombinedBackup merge 模式
assert.match(backup, /pullBackupFromCloud\(mode: RestoreMode = 'merge'\)/, 'pull 默认 merge(不覆盖本地新编辑)');

// 服务端「列出最新备份」helper + 路由 GET 模式
const runtime = read('../lib/portal/cloud-server-runtime.ts');
assert.match(runtime, /export async function listStorageObjects/, 'runtime 导出 listStorageObjects(列前缀对象)');
assert.match(runtime, /\/storage\/v1\/object\/list\//, '走 Supabase storage list API');
const assetsRoute = read('../app/api/cloud/assets/route.ts');
assert.match(assetsRoute, /list.*===.*'backup'|'backup'/, 'GET 支持 list=backup 模式');
assert.match(assetsRoute, /pickLatestBackupObject/, '挑最完整那份');
assert.match(assetsRoute, /backupObjectSize/, '按体积挑「最完整」备份(而非最新)');
assert.match(assetsRoute, /sb - sa/, 'size 大者优先 —— 空备份哪怕更新也盖不住真备份');
assert.match(assetsRoute, /\$\{identitySegment\}\/backup\//, '前缀按已鉴权身份拼(身份隔离,拿不到别人的)');
assert.match(assetsRoute, /found: false/, '云端确实无备份 → found:false(非错误)');

// 全量备份自动同步已**下线**(降为手动导出/恢复):Portal 不再自动触发 autoSyncBackupWithCloud
// —— 它此前与记录级模块同步并发对同一 key(一个 merge 一个 replace),是换端数据横跳的一大来源。
// 通用自动同步现在**唯一**走 cloud-module-sync;备份引擎仍导出供设置页手动导出/恢复(见 :67)。
assert.doesNotMatch(portal, /autoSyncBackupWithCloud\(\)/, '全量备份自动同步已下线,Portal 不再自动触发(改手动导出/恢复)');
assert.match(portal, /import \{ autoSyncModulesWithCloud \} from '@\/lib\/portal\/cloud-module-sync'/, '通用自动同步改由记录级模块同步承担');

console.log('cloud-auto-sync: OK');
