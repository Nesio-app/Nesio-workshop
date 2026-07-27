/**
 * 行为契约:免费最大化·Google 扩展授权 —— Drive appDataFolder 免费云备份。
 * 锁死:三个新 scope 并入 gmail/calendar connect 常量(一次授权);POST 上传备份到
 * appDataFolder(首次 POST 带 parents:['appDataFolder'],已存在 PATCH 覆盖同一文件);
 * GET 下载最近备份(无则 backup:null);未连接 401;缺 body 400;上游失败 502。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

// ── scope 合并(源码级) ──
const gmailConnect = fs.readFileSync(new URL('../app/api/portal/gmail/connect/route.ts', import.meta.url), 'utf8');
const calConnect = fs.readFileSync(new URL('../app/api/portal/calendar/connect/route.ts', import.meta.url), 'utf8');
for (const s of ['drive.appdata', 'auth/tasks', 'contacts.readonly']) {
  assert.ok(gmailConnect.includes(s), `gmail/connect scope 含 ${s}`);
  assert.ok(calConnect.includes(s), `calendar/connect scope 含 ${s}`);
}

// ── Drive 路由行为 ──
function loadRoute(token, fetchImpl) {
  const src = fs.readFileSync(new URL('../app/api/portal/drive/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Object, Array, String, Date, encodeURIComponent, fetch: fetchImpl,
    require: (p) => p === 'next/server' ? { NextRequest: class {}, NextResponse: { json: (b, init) => ({ __json: b, __status: init?.status ?? 200 }) } }
      : p.includes('gmail-access') ? { resolveGmailAccessToken: async () => token }
      : p.includes('api-auth') ? { guardAiRoute: async () => null }
      : ({}),
  });
  return mod.exports;
}
const reqBody = (backup) => ({ json: async () => ({ backup }) });

// 未连接 → 401
{
  const route = loadRoute(null, async () => ({ ok: true, json: async () => ({}) }));
  assert.equal((await route.POST(reqBody({ a: 1 }))).__status, 401, '未连接 POST 401');
  assert.equal((await route.GET({})).__status, 401, '未连接 GET 401');
}
// 缺 backup → 400
{
  const route = loadRoute('tkn', async () => ({ ok: true, json: async () => ({ files: [] }) }));
  assert.equal((await route.POST({ json: async () => ({}) })).__status, 400, '缺 backup 400');
}
// 首次上传:list 空 → POST 到 appDataFolder(带 parents)
{
  const calls = [];
  const route = loadRoute('tkn', async (url, opt) => {
    calls.push({ url: String(url), method: opt?.method, body: opt?.body });
    if (String(url).includes('/files?spaces=appDataFolder')) return { ok: true, json: async () => ({ files: [] }) };
    return { ok: true, json: async () => ({ id: 'newid' }) }; // upload
  });
  const res = await route.POST(reqBody({ hello: 'world' }));
  assert.equal(res.__json.ok, true, '首次上传成功');
  const upload = calls.find((c) => c.url.includes('/upload/'));
  assert.ok(upload && upload.method === 'POST', '首次用 POST 新建');
  assert.ok(upload.url.includes('uploadType=multipart'), 'multipart 上传');
  assert.ok(upload.body.includes('appDataFolder'), '新建到 appDataFolder(parents)');
  assert.ok(upload.body.includes('"hello":"world"'), '备载荷进 multipart');
}
// 已存在:list 命中 → PATCH 覆盖同一文件(不带 parents)
{
  const calls = [];
  const route = loadRoute('tkn', async (url, opt) => {
    calls.push({ url: String(url), method: opt?.method, body: opt?.body });
    if (String(url).includes('/files?spaces=appDataFolder')) return { ok: true, json: async () => ({ files: [{ id: 'exist', name: 'nesio-backup.json' }] }) };
    return { ok: true, json: async () => ({ id: 'exist' }) };
  });
  await route.POST(reqBody({ v: 2 }));
  const upload = calls.find((c) => c.url.includes('/upload/'));
  assert.equal(upload.method, 'PATCH', '已存在用 PATCH 覆盖');
  assert.ok(upload.url.includes('/files/exist'), '覆盖同一文件 id');
  assert.ok(!upload.body.includes('appDataFolder'), 'PATCH 不重复带 parents');
}
// GET 下载:命中 → 返回 backup;无文件 → backup:null
{
  const route = loadRoute('tkn', async (url) => {
    if (String(url).includes('spaces=appDataFolder')) return { ok: true, json: async () => ({ files: [{ id: 'exist', name: 'nesio-backup.json' }] }) };
    return { ok: true, json: async () => ({ restored: true }) };
  });
  const res = await route.GET({});
  assert.deepEqual(res.__json.backup, { restored: true }, 'GET 返回备份内容');

  const empty = loadRoute('tkn', async () => ({ ok: true, json: async () => ({ files: [] }) }));
  assert.equal((await empty.GET({})).__json.backup, null, '无备份 backup:null');
}
// 上游上传失败 → 502
{
  const route = loadRoute('tkn', async (url) => String(url).includes('spaces=appDataFolder')
    ? { ok: true, json: async () => ({ files: [] }) }
    : { ok: false, status: 500, json: async () => ({}) });
  assert.equal((await route.POST(reqBody({ a: 1 }))).__status, 502, '上游失败 502');
}

// 客户端接线(源码级)
const settings = fs.readFileSync(new URL('../components/portal/SettingsSheets.tsx', import.meta.url), 'utf8');
assert.ok(settings.includes('pushBackupToDrive') && settings.includes('免费备份到 Google Drive'), '设置页免费 Drive 备份按钮');
assert.ok(settings.includes('pullBackupFromDrive'), '设置页 Drive 恢复接线');

console.log('drive-backup: OK');
