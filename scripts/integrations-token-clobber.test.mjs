// 静默失败审计 #5:integrations token 回写不得以「读失败→空」为基底覆写,
// 否则会静默清掉另一 provider 的 refresh token(跨设备断连)。
// 契约:readIntegrations 读失败返回哨兵 null(非 {});save 读失败则放弃回写,不 clobber。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadIntegrations(fetchImpl) {
  const src = fs.readFileSync(new URL('../lib/portal/integrations.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require2 = (p) => {
    if (p === 'next/headers') return { cookies: async () => ({ get: () => undefined }) };
    if (p === '@/lib/portal/production-runtime') return { normalizeSupabaseRuntimeUrl: (u) => u };
    if (p === '@/lib/portal/env') return { envValue: (k) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon' }[k] || '') };
    if (p === '@/lib/portal/cloud-server-runtime') return { getCloudConfig: () => ({}), getSignedInUser: async () => null };
    return {};
  };
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: require2,
    fetch: fetchImpl, console: { error() {}, log() {} }, JSON, Date, Promise, Object, Array, String,
    URL, TextEncoder, TextDecoder,
  });
  return mod.exports;
}

// ── 1. 读失败(HTTP 非 2xx)→ null,不是 {} ──
{
  const m = loadIntegrations(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const r = await m.readIntegrations('u1', 'tok');
  assert.equal(r, null, '5xx 读失败返回哨兵 null');
}

// ── 2. 读抛异常(网络)→ null ──
{
  const m = loadIntegrations(async () => { throw new Error('network'); });
  assert.equal(await m.readIntegrations('u1', 'tok'), null, '网络异常返回 null');
}

// ── 3. 读成功但无数据 → {}(真空,可作基底)──
{
  const m = loadIntegrations(async () => ({ ok: true, status: 200, json: async () => [{ integrations: null }] }));
  const r = await m.readIntegrations('u1', 'tok');
  // 跨 realm 不能 deepEqual({}),逐项判:非 null 的空对象
  assert.ok(r !== null && typeof r === 'object' && Object.keys(r).length === 0, '成功但空 → 空对象(非 null)');
}

// ── 4. 读失败时 save 放弃回写,不 clobber(核心)──
{
  const calls = [];
  const m = loadIntegrations(async (url, init) => {
    const method = init?.method || 'GET';
    calls.push(method);
    if (method === 'GET') return { ok: false, status: 503, json: async () => ({}) }; // 读失败
    return { ok: true, status: 200, json: async () => [{}] }; // 写(不应发生)
  });
  const ok = await m.saveIntegrationTokenByUserId('u1', 'notion', { accessToken: 'n1' });
  assert.equal(ok, false, '读失败 → save 返回 false(放弃)');
  assert.equal(calls.filter((c) => c === 'PATCH' || c === 'POST').length, 0, '读失败绝不触发写(不 clobber 另一 provider)');
}

// ── 5. 读成功时 save 合并写入,保留既有 provider ──
{
  const written = [];
  const m = loadIntegrations(async (url, init) => {
    const method = init?.method || 'GET';
    if (method === 'GET') return { ok: true, status: 200, json: async () => [{ integrations: { gmail: { accessToken: 'g1', connectedAt: 'x' } } }] };
    written.push(JSON.parse(init.body).integrations);
    return { ok: true, status: 200, json: async () => [{}] };
  });
  const ok = await m.saveIntegrationTokenByUserId('u1', 'notion', { accessToken: 'n1' });
  assert.equal(ok, true, '读成功 → save 成功');
  const payload = written[0];
  assert.ok(payload.gmail?.accessToken === 'g1', '既有 gmail token 保留(不 clobber)');
  assert.ok(payload.notion?.accessToken === 'n1', '新 notion token 写入');
}

console.log('integrations token-clobber: OK');
