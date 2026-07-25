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

function makeCtx({ lsInit = {}, fbEntries = {}, idbBlobs = {}, fetchImpl, idbKeys = [], idbInit = {}, localImages = {}, withReload = false } = {}) {
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
  let scheduledPush = null;
  let reloaded = false;
  const ctx = {
    module: { exports: {} }, exports: {}, console, Date,
    // withReload 时装 location.reload 探针,验证冷浏览器首次拉回后确实 reload 让 store 重新水合
    window: withReload ? { location: { reload: () => { reloaded = true; } } } : {},
    // 防抖 push 用 setTimeout —— 假计时器只捕获回调,测试手动触发(vm 上下文默认无计时器)
    setTimeout: (fn) => { scheduledPush = fn; return 1; },
    clearTimeout: () => { scheduledPush = null; },
    _scheduledPush: () => scheduledPush,
    _reloaded: () => reloaded,
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
      // 批次 52:cache 类 IDB blob(ai-cache/日历缓存)不进备份 —— 与真 manifest 同语义的桩
      if (p === './storage-manifest') return {
        keyKind: (k) => (/nesio-ai-cache|nesio-calendar-local|(^|[-_])cache([-_]|$)/.test(k) ? 'cache' : 'durable'),
        isLocalOnly: (k) => k === 'nesio-person-records-v1',
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

// 1. durability 免费 + 空数据保险丝:登录即可用(常开);0 条目绝不上云(不发网络)——
//    「空浏览器绝不用空数据盖云端」红线,避免空的「最新」遮住云端真备份。
{
  const { mod, ctx } = makeCtx({ fetchImpl: ok200 }); // 无 fbEntries/idbBlobs → 备份 0 条
  assert.equal(mod.hasCloudEntitlement(), true, 'durability 免费:浏览器环境常开,登录即可用');
  const r = await mod.pushBackupToCloud();
  assert.equal(r.ok, true, '空数据视作无事可做,静默成功(不算失败)');
  assert.equal(r.entryCount, 0, '0 条目');
  assert.equal(ctx._lastFetch(), null, '空数据不发网络请求(不遮盖云端真备份)');
}

// 2. happy path:合并 localStorage durable + IDB blob → 上传 → 记 last-backup
{
  const { mod, ctx, lsMap } = makeCtx({
    fbEntries: { 'nesio-life-graph-v1': '[{"id":"n1"}]' },
    // 批次 52 行为锁:cache 类 IDB blob(ai-cache)不进备份,durable 的照常进
    idbBlobs: { 'nesio-health-v1': '{"metrics":[1]}', 'nesio-bank-tx-v1': '[]', 'nesio-ai-cache-v1': '{"chat":{}}' },
    fetchImpl: ok200,
  });
  assert.equal(mod.hasCloudEntitlement(), true, 'durability 免费:登录即可用');
  const r = await mod.pushBackupToCloud();
  assert.equal(r.ok, true, '解锁后推送成功');
  assert.equal(r.storagePath, 'id/backup/1-abc.nesio-backup.json.txt');
  assert.equal(r.entryCount, 3, '3 项:1 localStorage + 2 durable IDB(cache 类被排除)');

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

// 3. 401 → not_signed_in(有数据才会真发网络;empty-fuse 只拦 0 条目)
{
  const { mod } = makeCtx({
    fbEntries: { 'nesio-life-graph-v1': '[{"id":"n1"}]' },
    fetchImpl: () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'not_signed_in' }) }),
  });
  const r = await mod.pushBackupToCloud();
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_signed_in', '401 → not_signed_in');
}

// 4. 503 → cloud_not_configured
{
  const { mod } = makeCtx({
    fbEntries: { 'nesio-life-graph-v1': '[{"id":"n1"}]' },
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

// 5b. 防遮盖闸:本机备份比云端最新那份还少条目 → 跳过上传(不发网络),skippedRegression。
{
  const { mod, ctx } = makeCtx({
    fbEntries: { 'nesio-life-graph-v1': '[{"id":"n1"}]' }, // 本机仅 1 条
    fetchImpl: ok200,
  });
  const r = await mod.pushBackupToCloud({ skipIfFewerThan: 5 }); // 云端最新有 5 条
  assert.equal(r.ok, true, '不算失败(等本机补齐再推)');
  assert.equal(r.skippedRegression, true, '比云端少 → 标记跳过');
  assert.equal(ctx._lastFetch(), null, '防遮盖:比云端少绝不上传(不发网络)');
  // 而条目数 >= 门槛时照常推
  const { mod: m2, ctx: c2 } = makeCtx({
    fbEntries: { 'a': '1', 'b': '2', 'c': '3', 'd': '4', 'e': '5' },
    fetchImpl: ok200,
  });
  const r2 = await m2.pushBackupToCloud({ skipIfFewerThan: 5 });
  assert.equal(r2.ok, true);
  assert.ok(!r2.skippedRegression, '>= 门槛照常推');
  assert.ok(c2._lastFetch(), '>= 门槛真上传');
}

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

// 8. pullBackupFromCloud:命门修复 —— 问服务端「按账号找最新」,不依赖本地记录。
//    新浏览器 localStorage 空也能判定:云端确实无备份(found:false)→ no_backup。
{
  const fetchImpl = (url) => {
    if (String(url).startsWith('/api/cloud/assets?list=backup')) return { ok: true, status: 200, json: async () => ({ ok: true, cloudBackupList: true, found: false }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const noBk = makeCtx({ fetchImpl }); // 无任何本地 last-backup 记录(模拟全新浏览器)
  assert.equal((await noBk.mod.pullBackupFromCloud()).error, 'no_backup', '云端无备份 → no_backup(新浏览器也能判定)');
  // 关键:确实问了服务端的 list 模式,而不是靠本地记录
  assert.ok(String(noBk.ctx._lastFetch().url).includes('list=backup'), 'pull 走服务端 ?list=backup');
}

// 9. pullBackupFromCloud happy path:list=backup 拿最新签名 URL → 拉 blob → 校验 → 分流恢复。
//    模拟全新浏览器(无本地 last-backup 记录)也能拉回,并记下最新路径供 UI 显示。
{
  const fetchImpl = (url) => {
    if (String(url).startsWith('/api/cloud/assets?list=backup')) return { ok: true, status: 200, json: async () => ({ ok: true, found: true, signedUrl: 'https://signed/x', storagePath: 'id/backup/2-latest.nesio-backup.json.txt' }) };
    if (url === 'https://signed/x') return { ok: true, status: 200, text: async () => JSON.stringify(backupDoc({ 'nesio-life-graph-v1': '[]', 'nesio-health-v1': '{"metrics":[]}' })) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { mod, ctx, lsMap } = makeCtx({ idbKeys: ['nesio-health-v1'], fetchImpl });
  const res = await mod.pullBackupFromCloud('merge');
  assert.equal(res.ok, true, '恢复成功');
  assert.equal(res.cloudEntryCount, 2, 'pull 回报云端最新那份的条目数(供防遮盖闸)');
  assert.equal(res.idbRestored, 2, 'health + life-graph 两条落 IDB(图谱已迁 IDB)');
  assert.equal(ctx._idbStore().get('nesio-health-v1'), '{"metrics":[]}', 'health 落 IDB');
  assert.equal(ctx._idbStore().get('nesio-life-graph-v1'), '[]', 'life-graph merge-union 落 IDB');
  assert.equal(JSON.stringify(ctx._lastRestore().entries), JSON.stringify({}), '图谱已迁 IDB,localStorage 侧不含它');
  assert.equal(JSON.parse(lsMap.get('nesio-cloud-backup-last-v1')).storagePath, 'id/backup/2-latest.nesio-backup.json.txt', 'pull 记下最新备份路径(供 UI 显示上次同步)');
}

// 10. 云端 blob 不是有效备份 → invalid_backup,不动本机
{
  const fetchImpl = (url) => {
    if (String(url).startsWith('/api/cloud/assets?list=backup')) return { ok: true, status: 200, json: async () => ({ ok: true, found: true, signedUrl: 'https://signed/x', storagePath: 'p' }) };
    return { ok: true, status: 200, text: async () => 'not json at all' };
  };
  const { mod } = makeCtx({ fetchImpl });
  assert.equal((await mod.pullBackupFromCloud()).error, 'invalid_backup', '坏 blob → invalid_backup');
}

// 13. autoSyncBackupWithCloud 数据安全不变式 + 冷浏览器首刷重新水合。
const okFetch = (url) => {
  if (String(url).startsWith('/api/cloud/assets?list=backup')) return { ok: true, status: 200, json: async () => ({ ok: true, found: true, signedUrl: 'https://signed/x', storagePath: 'id/backup/1.txt' }) };
  if (url === 'https://signed/x') return { ok: true, status: 200, text: async () => JSON.stringify(backupDoc({ 'nesio-health-v1': '{"m":[]}' })) };
  return { ok: false, status: 404, json: async () => ({}) };
};
{
  // (a) 冷浏览器(无 first-sync 标志)首次拉回且有数据 → reload 让各 store 重新水合,不再走 push。
  //     这是「换个网页记录不显示」的根因修复:数据落 IDB 后必须刷新,否则界面仍是空缓存。
  const coldCtx = makeCtx({ idbKeys: ['nesio-health-v1'], fetchImpl: okFetch, withReload: true });
  await coldCtx.mod.autoSyncBackupWithCloud({ force: true });
  assert.equal(coldCtx.ctx._reloaded(), true, '冷浏览器首次拉回有数据 → reload 重新水合');
  assert.equal(coldCtx.ctx._scheduledPush(), null, '首刷这一趟不推(reload 后新页面再推)');
  assert.equal(coldCtx.lsMap.get('nesio-backup-first-sync-done-v1'), '1', '置首刷完成标志(防 reload 循环)');

  // (a2) 已同步过的浏览器(标志已置)→ 不再 reload,正常防抖 push(稳态)。
  const warmCtx = makeCtx({ idbKeys: ['nesio-health-v1'], fetchImpl: okFetch, withReload: true, lsInit: { 'nesio-backup-first-sync-done-v1': '1' } });
  await warmCtx.mod.autoSyncBackupWithCloud({ force: true });
  assert.equal(warmCtx.ctx._reloaded(), false, '已同步过不再 reload(不进循环)');
  assert.ok(warmCtx.ctx._scheduledPush(), '稳态:pull 成功后安排防抖 push');

  // (b) 云端确实空(no_backup)→ 也推(把本机数据首次带上云;empty-fuse 兜住真空账号),不 reload。
  const emptyFetch = (url) => {
    if (String(url).startsWith('/api/cloud/assets?list=backup')) return { ok: true, status: 200, json: async () => ({ ok: true, found: false }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const emptyCtx = makeCtx({ fetchImpl: emptyFetch, withReload: true });
  await emptyCtx.mod.autoSyncBackupWithCloud({ force: true });
  assert.ok(emptyCtx.ctx._scheduledPush(), '云端无备份也推(首次上云;空账号由 empty-fuse 拦)');
  assert.equal(emptyCtx.ctx._reloaded(), false, '云端无备份不 reload');
  assert.equal(emptyCtx.lsMap.get('nesio-backup-first-sync-done-v1'), undefined, 'no_backup 不置首刷标志(等原浏览器推上云后仍会首刷一次)');

  // (c) pull 网络失败 → 不推、不 reload(避免把本地空/旧数据推成新「最新」,遮住云端真备份)
  const failFetch = (url) => {
    if (String(url).startsWith('/api/cloud/assets?list=backup')) return { ok: false, status: 500, json: async () => ({ ok: false }) };
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const failCtx = makeCtx({ fetchImpl: failFetch, withReload: true });
  await failCtx.mod.autoSyncBackupWithCloud({ force: true });
  assert.equal(failCtx.ctx._scheduledPush(), null, 'pull 失败绝不推(防遮盖云端真备份)');
  assert.equal(failCtx.ctx._reloaded(), false, 'pull 失败不 reload');
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
