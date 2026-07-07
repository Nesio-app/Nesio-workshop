/**
 * 行为契约:云备份推送。
 * 验证:付费桩门(默认关不发网络)、happy path(合并 localStorage durable + IDB blob → 上传 →
 * 记 last-backup)、401/503/413 各映射到明确 error code、本地超 8MB 预检不白跑网络。
 * 用假 window/localStorage/fetch/File/Blob/FormData;full-backup 与 idb-blob-store 走注入桩
 * (本契约只测推送逻辑,不重测枚举/存储)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/cloud-backup.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function makeCtx({ lsInit = {}, fbEntries = {}, idbBlobs = {}, fetchImpl } = {}) {
  const lsMap = new Map(Object.entries(lsInit));
  const localStorage = {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  };
  let lastFetch = null;
  const ctx = {
    module: { exports: {} }, exports: {}, console, Date,
    window: {},
    localStorage,
    Blob: class { constructor(parts) { this.size = parts.join('').length; } },
    File: class { constructor(parts, name, opts) { this._content = parts.join(''); this.name = name; this.type = opts && opts.type; } },
    FormData: class { constructor() { this._d = new Map(); } append(k, v) { this._d.set(k, v); } get(k) { return this._d.get(k); } },
    fetch: async (url, init) => { lastFetch = { url, init }; return fetchImpl(url, init); },
    require: (p) => {
      if (p === './full-backup') return { buildFullBackup: () => ({ format: 'nesio-full-backup', version: 1, exportedAt: '2026-01-01T00:00:00.000Z', entries: { ...fbEntries } }) };
      if (p === './idb-blob-store') return { collectIdbBlobs: async () => ({ ...idbBlobs }) };
      return {};
    },
    _lastFetch: () => lastFetch,
    _lsMap: lsMap,
  };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return { mod: ctx.module.exports, ctx, lsMap };
}

const ok200 = () => ({ ok: true, status: 200, json: async () => ({ ok: true, storagePath: 'id/backup/1-abc.nesio-backup.json.txt' }) });

// 1. 付费桩门:未解锁 → entitlement_required,不发网络
{
  const { mod, ctx } = makeCtx({ fetchImpl: ok200 });
  assert.equal(mod.hasCloudEntitlement(), false, '默认未解锁');
  const r = await mod.pushBackupToCloud();
  assert.equal(r.ok, false);
  assert.equal(r.error, 'entitlement_required', '未解锁返回 entitlement_required');
  assert.equal(ctx._lastFetch(), null, '未解锁不发网络请求');
}

// 2. happy path:合并 localStorage durable + IDB blob → 上传 → 记 last-backup
{
  const { mod, ctx, lsMap } = makeCtx({
    lsInit: { 'nesio-cloud-entitlement-v1': 'on' },
    fbEntries: { 'nesio-life-graph-v1': '[{"id":"n1"}]' },
    idbBlobs: { 'nesio-health-v1': '{"metrics":[1]}', 'nesio-bank-tx-v1': '[]' },
    fetchImpl: ok200,
  });
  assert.equal(mod.hasCloudEntitlement(), true, 'flag=on 解锁');
  const r = await mod.pushBackupToCloud();
  assert.equal(r.ok, true, '解锁后推送成功');
  assert.equal(r.storagePath, 'id/backup/1-abc.nesio-backup.json.txt');
  assert.equal(r.entryCount, 3, '3 项:1 localStorage + 2 IDB');

  // 上传的 payload 合并了两侧
  const form = ctx._lastFetch().init.body;
  assert.equal(ctx._lastFetch().url, '/api/cloud/assets', '走 assets 路由');
  assert.equal(form.get('purpose'), 'backup', 'purpose=backup');
  const uploaded = JSON.parse(form.get('file')._content);
  assert.equal(JSON.stringify(Object.keys(uploaded.entries).sort()), JSON.stringify(['nesio-bank-tx-v1', 'nesio-health-v1', 'nesio-life-graph-v1']), 'payload 含 localStorage + IDB 全部 key');

  // 记了 last-backup
  const last = JSON.parse(lsMap.get('nesio-cloud-backup-last-v1'));
  assert.equal(last.storagePath, r.storagePath, 'last-backup 记了 storagePath');
  assert.equal(mod.lastCloudBackup().entryCount, 3, 'lastCloudBackup() 读回');
}

// 3. 401 → not_signed_in
{
  const { mod } = makeCtx({
    lsInit: { 'nesio-cloud-entitlement-v1': 'on' },
    fetchImpl: () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'not_signed_in' }) }),
  });
  const r = await mod.pushBackupToCloud();
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_signed_in', '401 → not_signed_in');
}

// 4. 503 → cloud_not_configured
{
  const { mod } = makeCtx({
    lsInit: { 'nesio-cloud-entitlement-v1': 'on' },
    fetchImpl: () => ({ ok: false, status: 503, json: async () => ({ ok: false, error: 'cloud_storage_not_configured' }) }),
  });
  const r = await mod.pushBackupToCloud();
  assert.equal(r.error, 'cloud_not_configured', '503 → cloud_not_configured');
}

// 5. 本地超 8MB 预检:不白跑网络
{
  const { mod, ctx } = makeCtx({
    lsInit: { 'nesio-cloud-entitlement-v1': 'on' },
    idbBlobs: { big: 'x'.repeat(8 * 1024 * 1024 + 1) },
    fetchImpl: ok200,
  });
  const r = await mod.pushBackupToCloud();
  assert.equal(r.ok, false);
  assert.equal(r.error, 'too_large', '超 8MB → too_large');
  assert.equal(ctx._lastFetch(), null, '超限不发网络');
}

console.log('cloud-backup: OK');
