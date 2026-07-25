/**
 * 行为契约:记录级模块同步(根治换端不显示 · 对齐 Google Contacts 式)。
 * 锁死:
 *  - 逐模块行(gz-b64 压缩块)push/pull;记忆图(life-graph)排除(它另有 signals 同步)。
 *  - push 只推**已变**模块(内容哈希去重);失败不推进 state(下次重推)。
 *  - pull 模块级 LWW:本机缺 → 填充(newlyAdded>0);本机自上次同步未改 → 云端更新胜;
 *    本机改过 → 本机胜(不被云端旧值覆盖)。
 *  - 新设备首拉到本机没有的模块 → newlyAdded>0(调用方据此 reload 水合)。
 * 用真 fflate 压缩;buildCombinedBackup/restoreCombinedBackup/fetch/localStorage 走注入桩。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import * as fflate from 'fflate';

const src = fs.readFileSync(new URL('../lib/portal/cloud-module-sync.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function makeCtx({ lsInit = {}, localEntries = {}, fetchImpl, withReload = false } = {}) {
  const lsMap = new Map(Object.entries(lsInit));
  const localStorage = {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  };
  let lastPost = null;
  let restoreApplied = null;
  let reloaded = false;
  const ctx = {
    module: { exports: {} }, exports: {}, console,
    Date, Math, JSON, btoa, atob, String, Uint8Array, Array, Object, Number,
    window: withReload ? { location: { reload: () => { reloaded = true; } } } : {},
    localStorage,
    fetch: async (url, init) => fetchImpl(url, init, (b) => { lastPost = b; }),
    require: (p) => {
      if (p === 'fflate') return fflate;
      if (p === './cloud-backup') return {
        // 枚举:返回注入的本机模块条目(含记忆图,验证被排除)
        buildCombinedBackup: async () => ({ format: 'nesio-full-backup', version: 1, exportedAt: 'x', entries: { ...localEntries } }),
        // 落地:捕获被应用的 entries(replace)
        restoreCombinedBackup: async (backup, mode) => { restoreApplied = { entries: backup.entries, mode }; return { restoredKeys: 0, idbRestored: Object.keys(backup.entries).length, skippedKeys: [], corruptKeys: [] }; },
      };
      if (p === './storage-health') return { logDropped: () => {} };
      return {};
    },
    _lastPost: () => lastPost,
    _restoreApplied: () => restoreApplied,
    _reloaded: () => reloaded,
    _lsMap: lsMap,
  };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return { mod: ctx.module.exports, ctx, lsMap };
}

// helper:构造云端一行(gz-b64 压缩 json)
function cloudRow(moduleKey, json, updatedAt = '2026-07-25T00:00:00.000Z') {
  const gz = fflate.gzipSync(fflate.strToU8(json));
  let bin = '';
  for (let i = 0; i < gz.length; i += 0x8000) bin += String.fromCharCode(...gz.subarray(i, i + 0x8000));
  return { moduleKey, data: { gz: Buffer.from(bin, 'binary').toString('base64') }, updatedAt };
}

// 1. push:逐模块行(压缩块)、排除记忆图、只推已变
{
  const okPost = async (url, init, cap) => {
    if (url === '/api/cloud/module-data' && init?.method === 'POST') { cap(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true, savedCount: 1 }) }; }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { mod, ctx } = makeCtx({
    localEntries: { 'nesio-health-v1': '{"metrics":[1,2]}', 'nesio-place-geo-v1': '[[1,2]]', 'nesio-life-graph-v1': '[{"id":"n1"}]' },
    fetchImpl: okPost,
  });
  const r = await mod.pushModulesToCloud();
  assert.equal(r.pushed, 2, '只推 2 个模块(记忆图被排除)');
  const posted = ctx._lastPost();
  const keys = posted.modules.map((m) => m.moduleKey).sort();
  assert.deepEqual(keys, ['nesio-health-v1', 'nesio-place-geo-v1'], '记忆图 life-graph 不进模块同步');
  assert.ok(posted.modules.every((m) => typeof m.data.gz === 'string' && m.data.gz.length > 0), '每模块存 gz-b64 压缩块');

  // 再推一次:无变化 → 0
  const r2 = await mod.pushModulesToCloud();
  assert.equal(r2.pushed, 0, '内容未变 → 不重推(增量)');
}

// 2. pull:新设备(本机空)→ 填充全部 + newlyAdded>0 + reload;落地经 restore(replace)
{
  const rows = [cloudRow('nesio-health-v1', '{"metrics":[9]}'), cloudRow('nesio-life-graph-v1', '[{"id":"x"}]')];
  const fetchImpl = async (url) => {
    if (url === '/api/cloud/module-data') return { ok: true, status: 200, json: async () => ({ ok: true, modules: rows }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { mod, ctx } = makeCtx({ localEntries: {}, fetchImpl, withReload: true });
  const r = await mod.pullModulesFromCloud();
  assert.equal(r.newlyAdded, 1, '本机没有健康 → 新增 1(记忆图被排除,不算)');
  assert.equal(r.applied, 1, '应用 1 个模块');
  const applied = ctx._restoreApplied();
  assert.equal(applied.mode, 'replace', '按 replace 覆盖选中 key');
  assert.equal(applied.entries['nesio-health-v1'], '{"metrics":[9]}', '健康解压还原并落地');
  assert.equal(applied.entries['nesio-life-graph-v1'], undefined, '记忆图不由模块同步落地');

  // autoSync:新增>0 → reload
  const auto = makeCtx({ localEntries: {}, fetchImpl, withReload: true });
  await auto.mod.autoSyncModulesWithCloud({ force: true });
  assert.equal(auto.ctx._reloaded(), true, '新设备首拉到数据 → reload 水合');
}

// 3. LWW:本机自上次同步后改过 → 本机胜(云端旧值不覆盖)
{
  const rows = [cloudRow('nesio-health-v1', '{"metrics":["CLOUD"]}')];
  const fetchImpl = async (url) => {
    if (url === '/api/cloud/module-data') return { ok: true, status: 200, json: async () => ({ ok: true, modules: rows }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  // state 记录的是**旧**哈希(本机现值已改成 LOCAL,与 state 不符 → 本机改过)
  const staleState = JSON.stringify({ 'nesio-health-v1': { hash: 'stale:1', syncedAt: '2026-01-01T00:00:00.000Z' } });
  const { mod, ctx } = makeCtx({
    lsInit: { 'nesio-module-sync-state-v1': staleState },
    localEntries: { 'nesio-health-v1': '{"metrics":["LOCAL"]}' },
    fetchImpl,
  });
  const r = await mod.pullModulesFromCloud();
  assert.equal(r.applied, 0, '本机改过 → 云端旧值不覆盖(本机胜)');
  assert.equal(ctx._restoreApplied(), null, '未落地任何 key');
}

// 4. LWW:本机自上次同步未改(哈希吻合)→ 云端更新胜
{
  const localJson = '{"metrics":["SAME_AS_SYNCED"]}';
  const rows = [cloudRow('nesio-health-v1', '{"metrics":["CLOUD_NEWER"]}')];
  const fetchImpl = async (url) => (url === '/api/cloud/module-data'
    ? { ok: true, status: 200, json: async () => ({ ok: true, modules: rows }) }
    : { ok: false, status: 404, json: async () => ({}) });
  // 先跑一次真实 hash:用引擎自己的哈希不方便,这里用「本机现值 == 上次同步值」的语义等价:
  // 让 state 的 hash 恰为本机现值的哈希 —— 通过先 push 建立 state,再 pull。
  const okPost = async (url, init) => (url === '/api/cloud/module-data' && init?.method === 'POST'
    ? { ok: true, status: 200, json: async () => ({ ok: true }) }
    : fetchImpl(url));
  const combined = async (url, init) => (init?.method === 'POST' ? okPost(url, init) : fetchImpl(url, init));
  const { mod, ctx } = makeCtx({ localEntries: { 'nesio-health-v1': localJson }, fetchImpl: combined });
  await mod.pushModulesToCloud();       // 建立 state[health].hash = hash(localJson)
  const r = await mod.pullModulesFromCloud(); // 本机未改(== 上次同步)→ 云端胜
  assert.equal(r.applied, 1, '本机自上次同步未改 → 云端更新胜');
  assert.equal(ctx._restoreApplied().entries['nesio-health-v1'], '{"metrics":["CLOUD_NEWER"]}', '落地云端新值');
}

// 5. 反遮盖闸:云端明显更小/更空的值,绝不覆盖本机非空值(防丢积分/跟练类进度)。
{
  // 本机是「满」的进度;云端是「空」的(远小于一半)。即便 LWW 判云端胜,也不许覆盖。
  const localFull = JSON.stringify({ points: 320, ledger: new Array(40).fill({ k: 'earn', v: 8 }) });
  const cloudEmpty = JSON.stringify({ points: 0, ledger: [] });
  const rows = [cloudRow('nesio-inventory-v1', cloudEmpty)];
  const fetchImpl = async (url) => (url === '/api/cloud/module-data'
    ? { ok: true, status: 200, json: async () => ({ ok: true, modules: rows }) }
    : { ok: false, status: 404, json: async () => ({}) });
  // state.hash 恰为本机满值哈希 → 语义上「本机自上次同步未改」(LWW 本会判云端胜),靠反遮盖闸兜住。
  const { mod, ctx } = makeCtx({
    lsInit: {},
    localEntries: { 'nesio-inventory-v1': localFull },
    fetchImpl,
  });
  // 先 push 建立 state(hash=满值)——用同一 fetchImpl 的 POST 分支
  const okPost = async (url, init) => (url === '/api/cloud/module-data' && init?.method === 'POST'
    ? { ok: true, status: 200, json: async () => ({ ok: true }) }
    : fetchImpl(url));
  const c2 = makeCtx({ localEntries: { 'nesio-inventory-v1': localFull }, fetchImpl: async (u, i) => (i?.method === 'POST' ? okPost(u, i) : fetchImpl(u)) });
  await c2.mod.pushModulesToCloud();
  const r = await c2.mod.pullModulesFromCloud();
  assert.equal(r.applied, 0, '云端空值(<本机一半)→ 反遮盖闸拦下,不覆盖本机满值');
  assert.equal(c2.ctx._restoreApplied(), null, '未落地任何 key(积分/跟练不被空状态盖掉)');
}

console.log('cloud-module-sync: OK');
