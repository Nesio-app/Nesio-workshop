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

function makeCtx({ lsInit = {}, fbEntries = {}, idbBlobs = {}, fetchImpl, idbKeys = [], idbInit = {}, localImages = {} } = {}) {
  const lsMap = new Map(Object.entries(lsInit));
  const localStorage = {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  };
  let lastFetch = null;
  let lastRestore = null;
  let restoredImages = null;
  const idbStore = new Map(Object.entries(idbInit));
  const idbBackend = {
    get: async (k) => (idbStore.has(k) ? idbStore.get(k) : null),
    set: async (k, v) => { idbStore.set(k, v); },
    delete: async (k) => { idbStore.delete(k); },
    keys: async () => [...idbStore.keys()],
  };
  const ctx = {
    module: { exports: {} }, exports: {}, console, Date,
    window: {},
    localStorage,
    Blob: class { constructor(parts) { this.size = parts.join('').length; } },
    File: class { constructor(parts, name, opts) { this._content = parts.join(''); this.name = name; this.type = opts && opts.type; } },
    FormData: class { constructor() { this._d = new Map(); } append(k, v) { this._d.set(k, v); } get(k) { return this._d.get(k); } },
    fetch: async (url, init) => { lastFetch = { url, init }; return fetchImpl(url, init); },
    require: (p) => {
      if (p === './full-backup') return {
        buildFullBackup: () => ({ format: 'nesio-full-backup', version: 1, exportedAt: '2026-01-01T00:00:00.000Z', entries: { ...fbEntries } }),
        // 捕获 localStorage 侧收到的 entries(验证路由);返回条数
        restoreFullBackup: (_storage, backup, mode) => { lastRestore = { entries: backup.entries, mode }; return { restoredKeys: Object.keys(backup.entries).length, skippedKeys: [], corruptKeys: [], mergedNodes: undefined }; },
        isValidBackup: (v) => !!(v && typeof v === 'object' && v.entries && v.format === 'nesio-full-backup'),
      };
      if (p === './idb-blob-store') return {
        collectIdbBlobs: async () => ({ ...idbBlobs }),
        isIdbBlobKey: (k) => idbKeys.includes(k) || k === 'nesio-life-graph-v1',
        registerIdbBlobKey: (k) => { if (!idbKeys.includes(k)) idbKeys.push(k); },
        idbBackend,
      };
      if (p === './local-image-store') return {
        collectLocalImages: async () => ({ ...localImages }),
        restoreLocalImages: async (m) => { restoredImages = { ...m }; return Object.keys(m).length; },
      };
      return {};
    },
    _lastFetch: () => lastFetch,
    _lastRestore: () => lastRestore,
    _restoredImages: () => restoredImages,
    _idbStore: () => idbStore,
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

// ── 恢复(pull / restoreCombinedBackup)──

const backupDoc = (entries) => ({ format: 'nesio-full-backup', version: 1, exportedAt: 'x', entries });

// 6. restoreCombinedBackup 路由:IDB key 落 idbBackend、其余走 restoreFullBackup(localStorage)
{
  const { mod, ctx } = makeCtx({ idbKeys: ['nesio-health-v1'] });
  const res = await mod.restoreCombinedBackup(backupDoc({ 'nesio-life-graph-v1': '[]', 'nesio-health-v1': '{"metrics":[1]}' }), 'replace');
  // 图谱已迁 IDB(主存迁移):restore 把它路由到 idbBackend,不再落 localStorage
  assert.equal(JSON.stringify(ctx._lastRestore().entries), JSON.stringify({}), 'life-graph 现走 IDB,localStorage 侧不含它');
  assert.equal(ctx._idbStore().get('nesio-health-v1'), '{"metrics":[1]}', 'health 落 IDB');
  assert.equal(ctx._idbStore().get('nesio-life-graph-v1'), '[]', 'life-graph 现落 IDB(主存迁移)');
  assert.equal(res.idbRestored, 2, 'health + life-graph 两条落 IDB');
  assert.equal(res.restoredKeys, 0, 'localStorage 侧无恢复');
}

// 7. merge 不覆盖已有 IDB;replace 覆盖(= 修复的坑)
{
  const { mod, ctx } = makeCtx({ idbKeys: ['nesio-health-v1'], idbInit: { 'nesio-health-v1': 'OLD' } });
  await mod.restoreCombinedBackup(backupDoc({ 'nesio-health-v1': 'NEW' }), 'merge');
  assert.equal(ctx._idbStore().get('nesio-health-v1'), 'OLD', 'merge 保留已有 IDB(仅补缺)');

  const { mod: m2, ctx: c2 } = makeCtx({ idbKeys: ['nesio-health-v1'], idbInit: { 'nesio-health-v1': 'OLD' } });
  await m2.restoreCombinedBackup(backupDoc({ 'nesio-health-v1': 'NEW' }), 'replace');
  assert.equal(c2._idbStore().get('nesio-health-v1'), 'NEW', 'replace 覆盖 IDB(修 #43 迁移留下的 replace 静默失效)');
}

// 8. pullBackupFromCloud:付费门 + 无备份
{
  const off = makeCtx({});
  assert.equal((await off.mod.pullBackupFromCloud()).error, 'entitlement_required', '未解锁不恢复');

  const noBk = makeCtx({ lsInit: { 'nesio-cloud-entitlement-v1': 'on' } });
  assert.equal((await noBk.mod.pullBackupFromCloud()).error, 'no_backup', '无上次备份记录 → no_backup');
}

// 9. pullBackupFromCloud happy path:签名 URL → 拉 blob → 校验 → 分流恢复
{
  const fetchImpl = (url) => {
    if (String(url).startsWith('/api/cloud/assets?')) return { ok: true, status: 200, json: async () => ({ ok: true, signedUrl: 'https://signed/x' }) };
    if (url === 'https://signed/x') return { ok: true, status: 200, text: async () => JSON.stringify(backupDoc({ 'nesio-life-graph-v1': '[]', 'nesio-health-v1': '{"metrics":[]}' })) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { mod, ctx } = makeCtx({
    lsInit: { 'nesio-cloud-entitlement-v1': 'on', 'nesio-cloud-backup-last-v1': JSON.stringify({ at: 'x', storagePath: 'id/backup/x.txt', bytes: 1, entryCount: 2 }) },
    idbKeys: ['nesio-health-v1'], fetchImpl,
  });
  const res = await mod.pullBackupFromCloud('merge');
  assert.equal(res.ok, true, '恢复成功');
  assert.equal(res.idbRestored, 2, 'health + life-graph 两条落 IDB(图谱已迁 IDB)');
  assert.equal(ctx._idbStore().get('nesio-health-v1'), '{"metrics":[]}', 'health 落 IDB');
  assert.equal(ctx._idbStore().get('nesio-life-graph-v1'), '[]', 'life-graph merge-union 落 IDB');
  assert.equal(JSON.stringify(ctx._lastRestore().entries), JSON.stringify({}), '图谱已迁 IDB,localStorage 侧不含它');
}

// 10. 云端 blob 不是有效备份 → invalid_backup,不动本机
{
  const fetchImpl = (url) => {
    if (String(url).startsWith('/api/cloud/assets?')) return { ok: true, status: 200, json: async () => ({ ok: true, signedUrl: 'https://signed/x' }) };
    return { ok: true, status: 200, text: async () => 'not json at all' };
  };
  const { mod } = makeCtx({
    lsInit: { 'nesio-cloud-entitlement-v1': 'on', 'nesio-cloud-backup-last-v1': JSON.stringify({ at: 'x', storagePath: 'p', bytes: 1, entryCount: 1 }) },
    fetchImpl,
  });
  assert.equal((await mod.pullBackupFromCloud()).error, 'invalid_backup', '坏 blob → invalid_backup');
}

// 11. 记忆照片导出:includeImages 才带图(默认导出不含图,避免云备份塞满);
//     图以 local-image: 前缀落 entries(隐私审计:导出要全覆盖,否则删/换机丢照片)
{
  const withImg = makeCtx({ localImages: { a1: 'data:jpg;A', a2: 'data:jpg;B' } });
  const full = await withImg.mod.buildCombinedBackup({ includeImages: true });
  assert.equal(full.entries['local-image:a1'], 'data:jpg;A', 'includeImages 把照片 a1 打进备份');
  assert.equal(full.entries['local-image:a2'], 'data:jpg;B', 'includeImages 把照片 a2 打进备份');

  const noImg = makeCtx({ localImages: { a1: 'data:jpg;A' } });
  const lean = await noImg.mod.buildCombinedBackup();
  assert.equal(Object.keys(lean.entries).some((k) => k.startsWith('local-image:')), false, '默认不带图(云备份体积门)');
}

// 12. 记忆照片恢复:local-image: 前缀路由到 restoreLocalImages(nesio-images IDB),
//     不落 localStorage、不落 blob IDB;imagesRestored 如实计数
{
  const { mod, ctx } = makeCtx({ idbKeys: ['nesio-health-v1'] });
  const res = await mod.restoreCombinedBackup(
    backupDoc({ 'local-image:a1': 'data:jpg;A', 'local-image:a2': 'data:jpg;B', 'nesio-health-v1': 'H' }),
    'replace',
  );
  assert.equal(res.imagesRestored, 2, '两张照片恢复计数');
  assert.equal(JSON.stringify(ctx._restoredImages()), JSON.stringify({ a1: 'data:jpg;A', a2: 'data:jpg;B' }), '照片按 assetId 路由到 nesio-images');
  assert.equal(ctx._idbStore().has('local-image:a1'), false, '照片不落 blob IDB');
  assert.equal(JSON.stringify(ctx._lastRestore().entries), JSON.stringify({}), '照片不落 localStorage');
  assert.equal(ctx._idbStore().get('nesio-health-v1'), 'H', '同批非图数据照常恢复');
}

console.log('cloud-backup: OK');
