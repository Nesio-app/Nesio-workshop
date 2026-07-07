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

// ══ 财务⑦/⑧:transactions 路由 —— NOT_READY 不静默 + 重复 item 摘除 + 机构元数据 ══
// 台账:TOKENS[at] = { inst, accounts:[{id,mask,subtype}], sync 响应 }
function makeTxWorld(world, opts = {}) {
  const cookies = {};
  const removedItems = [];
  async function fakeFetch(url, fetchOpts) {
    const body = JSON.parse(fetchOpts?.body || '{}');
    const tok = world[body.access_token];
    if (url.includes('/transactions/sync')) return { json: async () => tok.sync };
    if (url.includes('/accounts/get')) {
      return { json: async () => ({ accounts: tok.accounts.map((a) => ({ account_id: a.id, name: a.id, mask: a.mask, type: a.type || 'depository', subtype: a.subtype, balances: { current: 10, iso_currency_code: 'USD' } })) }) };
    }
    if (url.includes('/item/get')) return { json: async () => ({ item: { institution_id: tok.inst } }) };
    if (url.includes('/institutions/get_by_id')) {
      if (opts.failInstMeta) throw new Error('inst meta down');
      return { json: async () => ({ institution: { name: `Bank ${body.institution_id}`, logo: 'bG9nbw==', primary_color: '#123456' } }) };
    }
    if (url.includes('/item/remove')) { removedItems.push(body.access_token); return { json: async () => ({}) }; }
    throw new Error(`unexpected fetch ${url}`);
  }
  const src = fs.readFileSync(new URL('../app/api/portal/plaid/transactions/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Map, Set, fetch: fakeFetch, process: { env: {} },
    require: (p) => p === 'next/server' ? { NextRequest: class {}, NextResponse: { json: (b, init) => ({ __json: b, __status: init?.status ?? 200, cookies: { set: (n, v) => { cookies[n] = v; } } }) } }
      : p === '@/lib/portal/api-auth' ? { guardAiRoute: async () => null }
      : p === '../link-token/route' ? { plaidBase: () => 'https://sandbox.plaid.com' }
      : p === '@/lib/portal/env' ? { envValue: () => 'k' } : ({}),
  });
  return { route: mod.exports, cookies, removedItems };
}
const reqWithTokens = (toks) => ({ cookies: { get: (n) => n === 'nesio_plaid_tokens' ? { value: JSON.stringify(toks) } : undefined } });
const syncTx = (id, acc) => ({ added: [{ transaction_id: id, account_id: acc, date: '2026-07-01', name: id, amount: 5, iso_currency_code: 'USD', personal_finance_category: { primary: 'FOOD_AND_DRINK' } }], has_more: false, next_cursor: `c-${id}`, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' });

// 场景 A(财务⑦):一家就绪、一家 NOT_READY
{
  const w = makeTxWorld({
    'at-ready': { inst: 'ins-a', accounts: [{ id: 'acc-ready', mask: '1111' }], sync: syncTx('t1', 'acc-ready') },
    'at-new': { inst: 'ins-b', accounts: [{ id: 'acc-new', mask: '2222' }], sync: { added: [], transactions_update_status: 'NOT_READY', next_cursor: 'should-not-be-saved' } },
  });
  const res = await w.route.GET(reqWithTokens(['at-ready', 'at-new']));
  assert.equal(res.__json.ok, true);
  assert.equal(res.__json.pendingItems, 1, '未就绪机构计入 pendingItems');
  assert.equal(res.__json.transactions.length, 1, '就绪机构的流水照常返回');
  assert.equal(res.__json.accounts.length, 2, '两家账户都在(未就绪只影响流水)');
  assert.equal(res.__json.accounts[0].institution, 'Bank ins-a', '账户带机构名');
  assert.equal(res.__json.accounts[0].logo, 'bG9nbw==', '账户带机构 logo');
  const savedCursors = JSON.parse(w.cookies['nesio_plaid_cursors']);
  assert.equal(savedCursors[0], 'c-t1', '就绪机构游标推进');
  assert.equal(savedCursors[1], '', 'NOT_READY 机构游标不动(下次从头拉)');
  assert.equal(w.removedItems.length, 0, '不同机构不摘除');
}

// 场景 B(财务⑧):重复授权同一银行 → 旧 item 摘除,账户/交易不再双份
{
  const w = makeTxWorld({
    'at-old': { inst: 'ins-chase', accounts: [{ id: 'acc-old', mask: '7937', subtype: 'checking' }], sync: syncTx('t-old', 'acc-old') },
    'at-dup': { inst: 'ins-chase', accounts: [{ id: 'acc-dup', mask: '7937', subtype: 'checking' }], sync: syncTx('t-dup', 'acc-dup') },
  });
  const res = await w.route.GET(reqWithTokens(['at-old', 'at-dup']));
  assert.equal(res.__json.ok, true);
  assert.equal(res.__json.accounts.length, 1, '同实体卡只留一个账户');
  assert.equal(res.__json.accounts[0].id, 'acc-dup', '留的是更新授权的那个');
  assert.deepEqual([...res.__json.transactions].map((t) => t.id), ['t-dup'], '旧 item 的交易不返回(不再双份计数)');
  assert.deepEqual([...w.removedItems], ['at-old'], '旧 item best-effort /item/remove');
  assert.deepEqual(JSON.parse(w.cookies['nesio_plaid_tokens']), ['at-dup'], '旧 token 从 cookie 摘除');
  assert.equal(JSON.parse(w.cookies['nesio_plaid_cursors']).length, 1, '游标数组与 token 同步瘦身');
  assert.equal(res.__json.authoritative, true, '全部存活 token 账户拉齐 → 权威快照');
}

// 场景 D(财务⑪):机构元数据接口挂了 → logo/名称缺,但机构 id 已保住,重复 item 照样摘除
{
  const w = makeTxWorld({
    'at-old': { inst: 'ins-chase', accounts: [{ id: 'acc-old', mask: '7937', subtype: 'checking' }], sync: syncTx('t-old', 'acc-old') },
    'at-dup': { inst: 'ins-chase', accounts: [{ id: 'acc-dup', mask: '7937', subtype: 'checking' }], sync: syncTx('t-dup', 'acc-dup') },
  }, { failInstMeta: true });
  const res = await w.route.GET(reqWithTokens(['at-old', 'at-dup']));
  assert.equal(res.__json.accounts.length, 1, '元数据失败不击穿去重');
  assert.equal(res.__json.accounts[0].id, 'acc-dup');
  assert.equal(res.__json.accounts[0].logo, undefined, 'logo 缺失是预期(UI 有首字母兜底)');
  assert.deepEqual([...w.removedItems], ['at-old'], '旧 item 仍被摘除');
}

// 场景 C:staleTokenIndexes 纯函数边界(保守不误杀)
{
  const w = makeTxWorld({});
  const S = w.route.staleTokenIndexes;
  const acc = (mask, subtype = 'checking') => ({ mask, subtype });
  assert.deepEqual([...S([
    { institutionId: 'i1', accounts: [acc('1'), acc('2')] },
    { institutionId: 'i1', accounts: [acc('1'), acc('2')] },
  ])], [0], '完全覆盖 → 旧的摘除');
  assert.deepEqual([...S([
    { institutionId: 'i1', accounts: [acc('1'), acc('9')] },
    { institutionId: 'i1', accounts: [acc('1')] },
  ])], [], '部分覆盖(旧 item 有独有账户)不摘');
  assert.deepEqual([...S([
    { institutionId: 'i1', accounts: [{ subtype: 'checking' }] },
    { institutionId: 'i1', accounts: [{ subtype: 'checking' }] },
  ])], [], '缺 mask 不敢下结论');
  assert.deepEqual([...S([
    { institutionId: '', accounts: [acc('1')] },
    { institutionId: '', accounts: [acc('1')] },
  ])], [], '缺机构不敢下结论');
  assert.deepEqual([...S([
    { institutionId: 'i1', accounts: [acc('1')] },
    { institutionId: 'i2', accounts: [acc('1')] },
  ])], [], '不同机构同 mask 不摘(两家银行都可能有 ····1234)');
  assert.deepEqual([...S([
    { institutionId: 'i1', accounts: [acc('1')] },
    { institutionId: 'i1', accounts: [acc('1')] },
    { institutionId: 'i1', accounts: [acc('1')] },
  ])], [0, 1], '三重授权只留最新');
}

// 客户端:pendingItems 必须有可见状态 + 自动重试;上限 5000
assert.ok(/pendingItems/.test(hub), 'syncPlaid 处理 pendingItems');
assert.ok(/syncPlaid\(retry \+ 1\)/.test(hub), 'pending 时自动重试');
assert.ok(/slice\(0, 5000\)/.test(hub), '本机保留上限 5000');

console.log('plaid-multi-item: OK');
