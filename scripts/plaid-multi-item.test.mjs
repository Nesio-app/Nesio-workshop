/**
 * 行为契约:Plaid 多机构一次授权(财务⑥)。
 * 锁死:multi-item Link session 的全部 item public_token 都被交换(用户授权 6 家
 * 不能只连上 1 家);/link/token/get 响应解析容错;token 追加进 cookie 不覆盖;
 * 捞取失败退化为只换 onSuccess 那一个(不阻断);客户端必须回传 linkToken。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const fetchLog = [];
async function fakeFetch(url, opts) {
  const body = JSON.parse(opts?.body || '{}');
  fetchLog.push(`${url}|${body.public_token || body.link_token || ''}`);
  if (url.includes('/link/token/get')) {
    return { json: async () => ({ link_sessions: [{ results: { item_add_results: [
      { public_token: 'pub-chase' }, { public_token: 'pub-amex' }, { public_token: 'pub-citi' },
    ] } }] }) };
  }
  if (url.includes('/item/public_token/exchange')) {
    return { json: async () => ({ access_token: `at-${body.public_token}` }) };
  }
  throw new Error(`unexpected fetch ${url}`);
}

const cookieSets = {};
const fakeNextResponse = {
  json: (b, init) => ({ __json: b, __status: init?.status ?? 200, cookies: { set: (n, v) => { cookieSets[n] = v; } } }),
};

function loadRoute() {
  const src = fs.readFileSync(new URL('../app/api/portal/plaid/exchange/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, fetch: fakeFetch, process: { env: {} },
    require: (p) => p === 'next/server' ? { NextRequest: class {}, NextResponse: fakeNextResponse }
      : p === '@/lib/portal/api-auth' ? { guardAiRoute: async () => null }
      : p === '../link-token/route' ? { plaidBase: () => 'https://sandbox.plaid.com' }
      : p === '@/lib/portal/env' ? { envValue: () => 'k' } : ({}),
  });
  return mod.exports;
}
const route = loadRoute();

// ── sessionPublicTokens:解析 + 容错(vm 数组展开成宿主数组再比) ──
assert.deepEqual([...route.sessionPublicTokens({ link_sessions: [
  { results: { item_add_results: [{ public_token: 'a' }, { public_token: 'b' }] } },
  { results: { item_add_results: [{ public_token: 'a' }] } },
] })], ['a', 'b'], '跨 session 收集并去重');
assert.deepEqual([...route.sessionPublicTokens({})], [], '缺字段返回空');
assert.deepEqual([...route.sessionPublicTokens(null)], [], 'null 返回空');
assert.deepEqual([...route.sessionPublicTokens({ link_sessions: [{}] })], [], '空 session 容错');

// ── POST 端到端:一次授权 3 家 → 3 个 access_token 全部入 cookie ──
const req = (bodyObj, existingTokens) => ({
  json: async () => bodyObj,
  cookies: { get: (n) => n === 'nesio_plaid_tokens' && existingTokens ? { value: JSON.stringify(existingTokens) } : undefined },
});

const res1 = await route.POST(req({ publicToken: 'pub-chase', linkToken: 'lt-1' }));
assert.equal(res1.__json.ok, true);
assert.equal(res1.__json.items, 3, '多机构 session:3 家全部交换');
const stored = JSON.parse(cookieSets['nesio_plaid_tokens']);
assert.deepEqual([...stored], ['at-pub-chase', 'at-pub-amex', 'at-pub-citi'], '3 个 access_token 全入数组 cookie');
const exchanges = fetchLog.filter((u) => u.includes('/item/public_token/exchange'));
assert.equal(new Set(exchanges).size, exchanges.length, '同一 public_token 不重复交换');

// ── 追加不覆盖:已有别家 token 时保留 ──
fetchLog.length = 0;
const res2 = await route.POST(req({ publicToken: 'pub-chase', linkToken: 'lt-1' }, ['at-old-bank']));
assert.equal(res2.__json.ok, true);
const stored2 = JSON.parse(cookieSets['nesio_plaid_tokens']);
assert.ok(stored2.includes('at-old-bank') && stored2.length === 4, '旧银行 token 不被覆盖');

// ── 无 linkToken:退化为单 token 交换(旧行为不破坏) ──
fetchLog.length = 0;
const res3 = await route.POST(req({ publicToken: 'pub-solo' }));
assert.equal(res3.__json.items, 1, '无 linkToken 只换一个');
assert.ok(!fetchLog.some((u) => u.includes('/link/token/get')), '无 linkToken 不调 /link/token/get');

// ── 缺 public_token → 400 ──
const res4 = await route.POST(req({}));
assert.equal(res4.__status, 400);

// ── 客户端契约:onSuccess 必须回传 linkToken(否则服务端捞不到 session) ──
const hub = fs.readFileSync(new URL('../components/portal/ConnectorsHub.tsx', import.meta.url), 'utf8');
assert.ok(/linkToken:\s*data\.linkToken/.test(hub), 'ConnectorsHub exchange 请求带 linkToken');
assert.ok(/void syncPlaid\(\)/.test(hub), '连接成功后自动同步');

console.log('plaid-multi-item: OK');
