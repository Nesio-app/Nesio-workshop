/**
 * 行为契约:IDB blob store —— 水合、localStorage→IDB 迁移、save/load、导出/删除收口。
 * 用可注入的假后端 + 假 window/localStorage(不依赖真 IndexedDB)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/idb-blob-store.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function makeCtx(lsInit = {}) {
  const lsMap = new Map(Object.entries(lsInit));
  const localStorage = {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  };
  const ctx = {
    module: { exports: {} }, exports: {}, require: () => ({}), console,
    window: { dispatchEvent: () => {} },
    CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
    localStorage,
    _lsMap: lsMap,
  };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return { mod: ctx.module.exports, lsMap };
}

function fakeBackend(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    keys: async () => [...m.keys()],
    _m: m,
  };
}

// 1. 从 IDB 后端水合
{
  const { mod } = makeCtx();
  const be = fakeBackend({ 'nesio-health-v1': '{"metrics":[1,2]}' });
  const store = mod.createBlobStore({ key: 'nesio-health-v1', updateEvent: 'e', validate: (v) => Array.isArray(v.metrics), backend: be, autoHydrate: false });
  assert.equal(store.load(), null, '水合前为空');
  await store.ready();
  assert.equal(JSON.stringify(store.load().metrics), '[1,2]', '水合后读到 IDB 数据');
}

// 2. localStorage → IDB 迁移(IDB 空、旧 localStorage 有 → 搬进 IDB + 删 localStorage)
{
  const { mod, lsMap } = makeCtx({ 'nesio-health-v1': '{"metrics":[9]}' });
  const be = fakeBackend();
  const store = mod.createBlobStore({ key: 'nesio-health-v1', updateEvent: 'e', backend: be, autoHydrate: false });
  await store.ready();
  assert.equal(JSON.stringify(store.load().metrics), '[9]', '迁移后缓存有数据');
  assert.equal(be._m.get('nesio-health-v1'), '{"metrics":[9]}', 'IDB 里有了');
  assert.equal(lsMap.has('nesio-health-v1'), false, '旧 localStorage key 已删(腾配额)');
}

// 3. validate 拦截坏数据
{
  const { mod } = makeCtx();
  const be = fakeBackend({ 'k': '{"nope":1}' });
  const store = mod.createBlobStore({ key: 'k', updateEvent: 'e', validate: (v) => Array.isArray(v.metrics), backend: be, autoHydrate: false });
  await store.ready();
  assert.equal(store.load(), null, '不合法 blob 不进缓存');
}

// 4. save 写缓存 + 后端
{
  const { mod } = makeCtx();
  const be = fakeBackend();
  const store = mod.createBlobStore({ key: 'k', updateEvent: 'e', backend: be, autoHydrate: false });
  store.save({ metrics: [7] });
  assert.equal(JSON.stringify(store.load().metrics), '[7]', 'save 后 load 立即拿到(同步缓存)');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(be._m.get('k'), '{"metrics":[7]}', '异步落 IDB');
}

// 5. 导出/删除收口:collectIdbBlobs / purgeIdbBlobs
{
  const { mod } = makeCtx();
  const be = fakeBackend({ 'nesio-health-v1': '{"metrics":[]}', 'nesio-place-trail-v1': '[]' });
  const blobs = await mod.collectIdbBlobs(be);
  assert.equal(Object.keys(blobs).length, 2, 'collect 出全部 IDB blob(给备份合并)');
  assert.equal(blobs['nesio-place-trail-v1'], '[]');
  const n = await mod.purgeIdbBlobs(be);
  assert.equal(n, 2, 'purge 删掉全部 IDB blob');
  assert.equal((await be.keys()).length, 0, 'IDB 已清空(彻底删除本机数据不漏)');
}

// 6. syncSeed:第一帧就能从 LS 读,水合不删种子
{
  const { mod, lsMap } = makeCtx();
  const be = fakeBackend();
  const store = mod.createBlobStore({
    key: 'nesio-tesla-snapshot-v1', updateEvent: 'e', backend: be, autoHydrate: false, syncSeed: true,
  });
  store.save({ drives: [{ vehicleId: '1' }], charges: [] });
  assert.equal(lsMap.get('nesio-tesla-snapshot-v1')?.includes('"vehicleId":"1"'), true, 'save 双写 LS 种子');
  const { mod: mod2, lsMap: ls2 } = makeCtx({ 'nesio-tesla-snapshot-v1': lsMap.get('nesio-tesla-snapshot-v1') });
  const be2 = fakeBackend();
  const store2 = mod2.createBlobStore({
    key: 'nesio-tesla-snapshot-v1', updateEvent: 'e', backend: be2, autoHydrate: false, syncSeed: true,
  });
  assert.equal(store2.load().drives[0].vehicleId, '1', '水合前 load() 就能读到种子');
  await store2.ready();
  assert.equal(ls2.has('nesio-tesla-snapshot-v1'), true, 'syncSeed 水合后不删 LS');
  assert.equal(JSON.parse(be2._m.get('nesio-tesla-snapshot-v1')).drives[0].vehicleId, '1', '种子搬进 IDB');
}

{
  const rules = fs.readFileSync(new URL('../lib/portal/bank-rules-store.ts', import.meta.url), 'utf8');
  assert.match(rules, /from '\.\/idb-blob-store'/,
    'bank-rules-store 与 idb-blob-store 同在 lib/portal,必须是 ./ —— ../ 会让 Vercel Turbopack Module not found(2026-08-11 连红三次)');
  assert.match(rules, /from '\.\/storage-health'/);
}

console.log('idb-blob-store: OK');
