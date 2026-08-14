/**
 * 行为契约:Google Drive 可见备份(「我的云端硬盘 / 宝盒备份」)+ 含照片客户端直传。
 * 锁死:gmail/calendar connect 含 drive.appdata + drive.file;小包 POST 写可见文件夹;
 * session action 发 token;GET 可读;未连接 401;缺 body 400。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import assert from 'node:assert/strict';

const nodeRequire = createRequire(import.meta.url);

// ── scope 合并(源码级) ──
const gmailConnect = fs.readFileSync(new URL('../app/api/portal/gmail/connect/route.ts', import.meta.url), 'utf8');
const calConnect = fs.readFileSync(new URL('../app/api/portal/calendar/connect/route.ts', import.meta.url), 'utf8');
for (const s of ['drive.appdata', 'drive.file', 'auth/tasks', 'contacts.readonly']) {
  assert.ok(gmailConnect.includes(s), `gmail/connect scope 含 ${s}`);
  assert.ok(calConnect.includes(s), `calendar/connect scope 含 ${s}`);
}

// ── Drive 路由行为 ──
function loadRoute(token, fetchImpl) {
  const src = fs.readFileSync(new URL('../app/api/portal/drive/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Object, Array, String, Date, encodeURIComponent, Buffer, fetch: fetchImpl,
    require: (p) => p === 'next/server' ? { NextRequest: class {}, NextResponse: { json: (b, init) => ({ __json: b, __status: init?.status ?? 200 }) } }
      : p.includes('gmail-access') ? { resolveGmailAccessToken: async () => token }
      : p.includes('api-auth') ? { guardAiRoute: async () => null }
      : p === 'node:zlib' || p === 'zlib' ? nodeRequire('node:zlib')
      : ({}),
  });
  return mod.exports;
}
const reqBody = (backup) => ({ json: async () => ({ backup }) });

function folderListOk() {
  return { ok: true, json: async () => ({ files: [{ id: 'folder1', name: '宝盒备份' }] }) };
}

// 未连接 → 401
{
  const route = loadRoute(null, async () => ({ ok: true, json: async () => ({}) }));
  assert.equal((await route.POST(reqBody({ a: 1 }))).__status, 401, '未连接 POST 401');
  assert.equal((await route.GET({})).__status, 401, '未连接 GET 401');
}
// 缺 backup → 400
{
  const route = loadRoute('tkn', async () => folderListOk());
  assert.equal((await route.POST({ json: async () => ({}) })).__status, 400, '缺 backup 400');
}
// Drive list 403 → insufficient_scope
{
  const route = loadRoute('tkn', async () => ({ ok: false, status: 403, text: async () => 'PERMISSION_DENIED', json: async () => ({}) }));
  const res = await route.POST(reqBody({ a: 1 }));
  assert.equal(res.__status, 403, '缺 Drive scope → 403');
  assert.equal(res.__json.error, 'insufficient_scope', 'error=insufficient_scope');
}
// session → 发 token + 文件夹
{
  const route = loadRoute('tkn', async (url) => {
    if (String(url).includes('mimeType')) return folderListOk();
    if (String(url).includes('/files?')) return { ok: true, json: async () => ({ files: [] }) };
    return { ok: true, json: async () => ({}) };
  });
  const res = await route.POST({ json: async () => ({ action: 'session' }) });
  assert.equal(res.__json.ok, true, 'session ok');
  assert.equal(res.__json.accessToken, 'tkn', 'session 带 accessToken');
  assert.equal(res.__json.folderName, '宝盒备份', '可见文件夹名');
  assert.ok(res.__json.folderId, 'folderId');
}
// beginResumable → 返回 uploadUrl(服务端读 Location,避开浏览器 CORS)
{
  const route = loadRoute('tkn', async (url, opt) => {
    if (String(url).includes('mimeType')) return folderListOk();
    if (String(url).includes('uploadType=resumable')) {
      return {
        ok: true,
        status: 200,
        headers: { get: (h) => (h === 'Location' ? 'https://www.googleapis.com/upload/drive/v3/files?upload_id=abc' : null) },
        json: async () => ({}),
        text: async () => '',
      };
    }
    if (String(url).includes('/files?')) return { ok: true, json: async () => ({ files: [] }) };
    return { ok: true, json: async () => ({}), headers: { get: () => null } };
  });
  const res = await route.POST({ json: async () => ({ action: 'beginResumable', byteSize: 1024 }) });
  assert.equal(res.__json.ok, true, 'beginResumable ok');
  assert.match(res.__json.uploadUrl, /upload_id=abc/, 'uploadUrl 来自 Location');
  assert.equal(res.__json.fileName, 'nesio-backup.json.gz');
}
// putChunk:仅允许 googleapis upload 域;成功返回 done
{
  const route = loadRoute('tkn', async (url, opt) => {
    if (String(url).includes('upload_id=abc')) {
      assert.equal(opt?.method, 'PUT');
      return { ok: true, status: 200, json: async () => ({ id: 'file1' }), text: async () => '' };
    }
    return { ok: true, json: async () => ({}) };
  });
  const bad = await route.POST({
    json: async () => ({
      action: 'putChunk', uploadUrl: 'https://evil.example/x', offset: 0, total: 3,
      chunkBase64: Buffer.from('abc').toString('base64'),
    }),
  });
  assert.equal(bad.__status, 400, '非法 uploadUrl → 400');

  const ok = await route.POST({
    json: async () => ({
      action: 'putChunk',
      uploadUrl: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=abc',
      offset: 0, total: 3,
      chunkBase64: Buffer.from('abc').toString('base64'),
    }),
  });
  assert.equal(ok.__json.ok, true);
  assert.equal(ok.__json.done, true);
  assert.equal(ok.__json.fileId, 'file1');
}
// uploadGzip 小包代传
{
  const { gzipSync } = nodeRequire('node:zlib');
  const gz = gzipSync(Buffer.from(JSON.stringify({ v: 1 })));
  const calls = [];
  const route = loadRoute('tkn', async (url, opt) => {
    calls.push(String(url));
    if (String(url).includes('mimeType')) return folderListOk();
    if (String(url).includes('/files?') && !String(url).includes('/upload/')) {
      return { ok: true, json: async () => ({ files: [] }) };
    }
    return { ok: true, json: async () => ({ id: 'gz1' }) };
  });
  const res = await route.POST({
    json: async () => ({ action: 'uploadGzip', gzipBase64: gz.toString('base64') }),
  });
  assert.equal(res.__json.ok, true, 'uploadGzip ok');
  assert.equal(res.__json.fileName, 'nesio-backup.json.gz');
  assert.ok(calls.some((u) => u.includes('/upload/')), '走了 upload API');
}
// 首次上传:文件夹存在、无备份文件 → POST 带 parents=folderId
{
  const calls = [];
  const route = loadRoute('tkn', async (url, opt) => {
    calls.push({ url: String(url), method: opt?.method, body: opt?.body });
    if (String(url).includes('mimeType')) return folderListOk();
    if (String(url).includes('/files?') && !String(url).includes('/upload/')) {
      return { ok: true, json: async () => ({ files: [] }) };
    }
    return { ok: true, json: async () => ({ id: 'newid' }) };
  });
  const res = await route.POST(reqBody({ hello: 'world' }));
  assert.equal(res.__json.ok, true, '首次上传成功');
  assert.equal(res.__json.folderName, '宝盒备份');
  const upload = calls.find((c) => c.url.includes('/upload/'));
  assert.ok(upload && upload.method === 'POST', '首次用 POST 新建');
  assert.ok(upload.url.includes('uploadType=multipart'), 'multipart 上传');
  assert.ok(upload.body.includes('folder1'), '新建到可见文件夹 parents');
  assert.ok(!upload.body.includes('appDataFolder'), '不再默认写 appDataFolder');
  assert.ok(upload.body.includes('"hello":"world"'), '备载荷进 multipart');
}
// 已存在明文 json → PATCH 覆盖
{
  const calls = [];
  const route = loadRoute('tkn', async (url, opt) => {
    calls.push({ url: String(url), method: opt?.method, body: opt?.body });
    if (String(url).includes('mimeType')) return folderListOk();
    if (String(url).includes('/files?') && !String(url).includes('/upload/')) {
      return { ok: true, json: async () => ({ files: [{ id: 'exist', name: 'nesio-backup.json' }] }) };
    }
    return { ok: true, json: async () => ({ id: 'exist' }) };
  });
  await route.POST(reqBody({ v: 2 }));
  const upload = calls.find((c) => c.url.includes('/upload/'));
  assert.equal(upload.method, 'PATCH', '已存在用 PATCH 覆盖');
  assert.ok(upload.url.includes('/files/exist'), '覆盖同一文件 id');
}
// GET 下载:命中 → 返回 backup;无文件 → backup:null(仍查 appData 回退)
{
  const route = loadRoute('tkn', async (url) => {
    if (String(url).includes('mimeType')) return folderListOk();
    if (String(url).includes('spaces=appDataFolder')) return { ok: true, json: async () => ({ files: [] }) };
    if (String(url).includes('/files?')) return { ok: true, json: async () => ({ files: [{ id: 'exist', name: 'nesio-backup.json' }] }) };
    if (String(url).includes('alt=media')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ restored: true })), json: async () => ({ restored: true }) };
    return { ok: true, json: async () => ({}) };
  });
  const res = await route.GET({});
  assert.deepEqual(res.__json.backup, { restored: true }, 'GET 返回备份内容');

  const empty = loadRoute('tkn', async (url) => {
    if (String(url).includes('mimeType')) return folderListOk();
    if (String(url).includes('spaces=appDataFolder')) return { ok: true, json: async () => ({ files: [] }) };
    return { ok: true, json: async () => ({ files: [] }) };
  });
  assert.equal((await empty.GET({})).__json.backup, null, '无备份 backup:null');
}
// 上游上传失败 → 502
{
  const route = loadRoute('tkn', async (url) => {
    if (String(url).includes('mimeType')) return folderListOk();
    if (String(url).includes('/upload/')) return { ok: false, status: 500, text: async () => '', json: async () => ({}) };
    return { ok: true, json: async () => ({ files: [] }) };
  });
  assert.equal((await route.POST(reqBody({ a: 1 }))).__status, 502, '上游失败 502');
}

// 客户端接线(源码级)
const settings = fs.readFileSync(new URL('../components/portal/SettingsSheets.tsx', import.meta.url), 'utf8');
assert.ok(settings.includes('pushBackupToDrive'), '设置页 Drive 备份接线');
assert.ok(settings.includes('includeImages: true'), 'Drive 备份默认含照片');
assert.ok(settings.includes('宝盒备份') || settings.includes('folderName'), '成功文案指向可见文件夹');
assert.ok(settings.includes('pullBackupFromDrive'), '设置页 Drive 恢复接线');

const client = fs.readFileSync(new URL('../lib/portal/drive-backup.ts', import.meta.url), 'utf8');
assert.ok(client.includes('includeImages'), '客户端支持含图');
assert.ok(client.includes('beginResumable') && client.includes('putChunk'), '大包走服务端可续传分片');
assert.ok(client.includes('uploadGzip'), '小包整份代传');
assert.ok(!client.includes('googleapis.com/upload/drive'), '客户端上传不直连 Google');

console.log('drive-backup: OK');
