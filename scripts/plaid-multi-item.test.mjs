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
      return { json: async () => ({ accounts: tok.accounts.map((a) => ({ account_id: a.id, name: a.id, mask: a.mask, type: a.type || 'depository', subtype: a.subtype, balances: { current: 10, limit: a.limit ?? null, iso_currency_code: 'USD' } })) }) };
    }
    if (url.includes('/item/get')) return { json: async () => ({ item: { institution_id: tok.inst } }) };
    if (url.includes('/institutions/get_by_id')) {
      if (opts.failInstMeta) throw new Error('inst meta down');
      return { json: async () => ({ institution: { name: `Bank ${body.institution_id}`, logo: 'bG9nbw==', primary_color: '#123456' } }) };
    }
    if (url.includes('/item/remove')) { removedItems.push(body.access_token); return { json: async () => ({}) }; }
    if (url.includes('/investments/transactions/get')) {
      return { json: async () => ({ investment_transactions: tok.invTxs || [], total_investment_transactions: (tok.invTxs || []).length }) };
    }
    if (url.includes('/investments/holdings/get')) {
      if (!tok.holdings) throw new Error('holdings down'); // 未配持仓的场景 = 接口失败,验证不阻断
      return { json: async () => tok.holdings };
    }
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
const syncTx = (id, acc) => ({ added: [{ transaction_id: id, account_id: acc, date: '2026-07-01', name: id, amount: 5, iso_currency_code: 'USD', personal_finance_category: { primary: 'FOOD_AND_DRINK' }, merchant_entity_id: `ent-${id}`, logo_url: `https://logo/${id}.png` }], has_more: false, next_cursor: `c-${id}`, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' });

// 场景 A(财务⑦):一家就绪、一家 NOT_READY
{
  const w = makeTxWorld({
    'at-ready': { inst: 'ins-a', accounts: [{ id: 'acc-ready', mask: '1111', type: 'credit', limit: 5000 }], sync: syncTx('t1', 'acc-ready') },
    'at-new': { inst: 'ins-b', accounts: [{ id: 'acc-new', mask: '2222' }], sync: { added: [], transactions_update_status: 'NOT_READY', next_cursor: 'should-not-be-saved' } },
  });
  const res = await w.route.GET(reqWithTokens(['at-ready', 'at-new']));
  assert.equal(res.__json.ok, true);
  assert.equal(res.__json.pendingItems, 1, '未就绪机构计入 pendingItems');
  assert.equal(res.__json.transactions.length, 1, '就绪机构的流水照常返回');
  assert.equal(res.__json.accounts.length, 2, '两家账户都在(未就绪只影响流水)');
  assert.equal(res.__json.accounts[0].institution, 'Bank ins-a', '账户带机构名');
  assert.equal(res.__json.accounts[0].logo, 'bG9nbw==', '账户带机构 logo');
  // 财务㉙:信用卡额度透传;无额度数据的账户为 undefined 不硬编
  assert.equal(res.__json.accounts[0].limit, 5000, '信用卡 balances.limit 透传');
  assert.equal(res.__json.accounts[1].limit, undefined, '无 limit → undefined');
  // 财务⑲:商户实体 id 与 logo 透传(响应自带的富化,不再丢弃)
  assert.equal(res.__json.transactions[0].merchantId, 'ent-t1', '透传 merchant_entity_id');
  assert.equal(res.__json.transactions[0].merchantLogo, 'https://logo/t1.png', '透传商户 logo');
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

// 场景 E(财务⑯):投资账户走 investments 产品 —— 分红=收入细分、买入=转账,Fidelity 不再全空
{
  const w = makeTxWorld({
    'at-fid': {
      inst: 'ins-fid',
      accounts: [{ id: 'acc-ira', mask: '0921', subtype: 'ira', type: 'investment' }],
      sync: { added: [], has_more: false, next_cursor: 'c0', transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' },
      invTxs: [
        { investment_transaction_id: 'inv-div', account_id: 'acc-ira', date: '2026-07-01', name: 'FIDELITY DIVIDEND', amount: -50, iso_currency_code: 'USD', type: 'cash', subtype: 'dividend' },
        { investment_transaction_id: 'inv-buy', account_id: 'acc-ira', date: '2026-07-02', name: 'BUY FXAIX', amount: 100, iso_currency_code: 'USD', type: 'buy', subtype: 'buy' },
      ],
    },
  });
  const res = await w.route.GET(reqWithTokens(['at-fid']));
  const byId = new Map([...res.__json.transactions].map((t) => [t.id, t]));
  assert.ok(byId.has('inv-div') && byId.has('inv-buy'), '投资流水进响应');
  assert.equal(byId.get('inv-div').category, 'INCOME', '分红 → 收入');
  assert.equal(byId.get('inv-div').categoryDetail, 'INCOME_DIVIDENDS', '分红细分,喂收入构成');
  assert.equal(byId.get('inv-buy').category, 'TRANSFER_OUT', '买入是内部流转,不计收支');
  // invTxCategory 纯函数边界
  assert.equal(w.route.invTxCategory({ subtype: 'interest', amount: -3 }).detail, 'INCOME_INTEREST_EARNED');
  assert.equal(w.route.invTxCategory({ subtype: 'management fee', amount: 10 }).category, 'BANK_FEES');
  assert.equal(w.route.invTxCategory({ subtype: 'contribution', amount: -500 }).category, 'TRANSFER_IN', '缴存是转入');
  // 财务㉗:holdings 接口失败(此场景未配持仓 → fake 抛错)不阻断,响应仍带空持仓
  assert.deepEqual([...res.__json.holdings], [], 'holdings 失败不阻断同步');
}

// 场景 E2(财务㉗):持仓快照 —— holdings × securities join(名称/代码/数量/市值/成本)
{
  const w = makeTxWorld({
    'at-fid': {
      inst: 'ins-fid',
      accounts: [{ id: 'acc-ira', mask: '0921', subtype: 'ira', type: 'investment' }],
      sync: { added: [], has_more: false, next_cursor: 'c0', transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' },
      invTxs: [],
      holdings: {
        holdings: [
          { account_id: 'acc-ira', security_id: 'sec-1', quantity: 10, institution_value: 3000, cost_basis: 2400, iso_currency_code: 'USD' },
          { account_id: 'acc-ira', security_id: 'sec-missing', quantity: 1, institution_value: 50, iso_currency_code: 'USD' },
        ],
        securities: [{ security_id: 'sec-1', name: 'Apple Inc', ticker_symbol: 'AAPL', type: 'equity' }],
      },
    },
  });
  const res = await w.route.GET(reqWithTokens(['at-fid']));
  const hs = [...res.__json.holdings].map((h) => ({ ...h }));
  assert.equal(hs.length, 2, '持仓全量进响应');
  assert.deepEqual(hs[0], { accountId: 'acc-ira', name: 'Apple Inc', ticker: 'AAPL', type: 'equity', quantity: 10, value: 3000, costBasis: 2400, currency: 'USD' }, 'securities join 出名称/代码/类型');
  assert.equal(hs[1].name, 'Security', 'security 缺失 → 兜底名,不丢持仓');
  assert.equal(hs[1].costBasis, undefined, '缺成本透传 undefined(下游不硬算盈亏)');
}
// link-token 源码级:investments 作为 optional_products(不支持的机构不受影响)
{
  const lt = fs.readFileSync(new URL('../app/api/portal/plaid/link-token/route.ts', import.meta.url), 'utf8');
  assert.ok(/optional_products:\s*\['investments'\]/.test(lt), 'link-token 带 optional investments');
}

// 场景 F(财务㉑):?full=1 忽略已存游标从头重拉(富化回填);默认请求仍用游标
{
  const seenCursors = [];
  const world = {
    'at-a': { inst: 'ins-a', accounts: [{ id: 'acc-a', mask: '1111' }], sync: syncTx('tf1', 'acc-a') },
  };
  const w = makeTxWorld(world);
  const wrapFetch = global.fetch; // makeTxWorld 的 fetch 在 vm 里,这里用请求对象断言游标
  const reqFull = {
    cookies: { get: (n) => n === 'nesio_plaid_tokens' ? { value: JSON.stringify(['at-a']) }
      : n === 'nesio_plaid_cursors' ? { value: JSON.stringify(['c-old']) } : undefined },
    nextUrl: { searchParams: { get: (k) => (k === 'full' ? '1' : null) } },
  };
  const resFull = await w.route.GET(reqFull);
  assert.equal(resFull.__json.ok, true, 'full=1 正常返回');
  // 全量:next_cursor 推进为响应值(而非续用 c-old 起点);默认请求对照组用旧游标
  assert.equal(JSON.parse(w.cookies['nesio_plaid_cursors'])[0], 'c-tf1', '回填后游标回到增量轨道');
  void wrapFetch; void seenCursors;
}
// 客户端契约:每设备一次全量回填 + 回填完成落标记(数据核心已收编到 connector-sync)
{
  const syncCore = fs.readFileSync(new URL('../lib/portal/providers/connector-sync.ts', import.meta.url), 'utf8');
  assert.ok(syncCore.includes('?full=1'), 'runPlaidSync 支持全量回填');
  assert.ok(syncCore.includes('nesio-plaid-enrich-v1'), '回填只做一次(localStorage 标记)');
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

// 客户端:pendingItems 必须有可见状态 + 自动重试(UI 留在 Hub);数据口径在 connector-sync
const syncCore2 = fs.readFileSync(new URL('../lib/portal/providers/connector-sync.ts', import.meta.url), 'utf8');
assert.ok(/r\.pending/.test(hub), 'syncPlaid 处理 pending 可见状态');
assert.ok(/syncPlaid\(retry \+ 1\)/.test(hub), 'pending 时自动重试');
assert.ok(/slice\(0, 5000\)/.test(syncCore2), '本机保留上限 5000');
assert.ok(/saveHoldings/.test(syncCore2), '财务㉗:同步回包的持仓落本机 store');
assert.ok(/runPlaidSync/.test(hub), 'Hub 收编到 connector-sync 核心,不留双实现');

// ══ 错付防线:失败链接释放 Item(/api/portal/plaid/remove)——「失败也烧名额」的根治 ══
// 一个 connection = 一个活 Item;Item 在 onSuccess 那刻已建。exchange 失败 → 没拿到 token →
// 常规去重看不见 → 名额永久被占(20/10 的根因)。remove 路由用 publicToken 换 token 再 /item/remove。
{
  const removeLog = { exchanges: [], removes: [], cookieSets: 0 };
  async function removeFetch(url, opts) {
    const body = JSON.parse(opts?.body || '{}');
    if (url.includes('/link/token/get')) {
      return { json: async () => ({ link_sessions: [{ results: { item_add_results: [
        { public_token: 'pub-a' }, { public_token: 'pub-b' }, { public_token: 'pub-c' },
      ] } }] }) };
    }
    if (url.includes('/item/public_token/exchange')) {
      removeLog.exchanges.push(body.public_token);
      return { json: async () => ({ access_token: `at-${body.public_token}` }) };
    }
    if (url.includes('/item/remove')) {
      removeLog.removes.push(body.access_token);
      return { json: async () => ({}) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }
  const removeNextResponse = {
    json: (b, init) => ({ __json: b, __status: init?.status ?? 200, cookies: { set: () => { removeLog.cookieSets++; } } }),
  };
  const src = fs.readFileSync(new URL('../app/api/portal/plaid/remove/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, fetch: removeFetch, process: { env: {} },
    require: (p) => p === 'next/server' ? { NextRequest: class {}, NextResponse: removeNextResponse }
      : p === '@/lib/portal/api-auth' ? { guardAiRoute: async () => null }
      : p === '../link-token/route' ? { plaidBase: () => 'https://sandbox.plaid.com' }
      : p === '../exchange/route' ? { sessionPublicTokens: route.sessionPublicTokens }
      : p === '@/lib/portal/env' ? { envValue: () => 'k' } : ({}),
  });
  const removeRoute = mod.exports;
  const rReq = (bodyObj) => ({ json: async () => bodyObj });

  // 多机构一次授权失败 → session 里 3 个 Item 全部释放
  const r1 = await removeRoute.POST(rReq({ publicToken: 'pub-a', linkToken: 'lt-1' }));
  assert.equal(r1.__json.ok, true);
  assert.equal(r1.__json.removed, 3, '失败链接:session 3 个 Item 全部 /item/remove 释放名额');
  assert.deepEqual([...removeLog.removes].sort(), ['at-pub-a', 'at-pub-b', 'at-pub-c'], '每个都先换 token 再 remove');
  assert.equal(removeLog.cookieSets, 0, '清理路由绝不写 cookie(纯释放,不落连接态)');

  // 无 linkToken:只释放 onSuccess 那一个
  removeLog.removes.length = 0;
  const r2 = await removeRoute.POST(rReq({ publicToken: 'pub-solo' }));
  assert.equal(r2.__json.removed, 1, '无 linkToken 只释放一个');

  // 缺 publicToken → 400(没有可释放目标)
  const r3 = await removeRoute.POST(rReq({}));
  assert.equal(r3.__status, 400, '缺 publicToken → 400');
}

// ── 客户端契约:失败链接必调 remove 释放名额 + 发起阶段防连点 ──
assert.ok(/\/api\/portal\/plaid\/remove/.test(hub), 'ConnectorsHub 失败时调 /plaid/remove 释放 Item');
assert.ok(/releaseFailedPlaidItem\(publicToken, data\.linkToken\)/.test(hub), 'exchange 失败与网络异常两条路径都释放刚建的 Item');
assert.ok(/plaidBusyRef\.current/.test(hub), '发起阶段互斥,防连点各建一个 Item 多烧名额');
// OAuth 续接页同样在 exchange 失败/网络异常时释放 Item
const oauthPage = fs.readFileSync(new URL('../app/plaid-oauth/page.tsx', import.meta.url), 'utf8');
assert.ok(/\/api\/portal\/plaid\/remove/.test(oauthPage), 'OAuth 续接页失败时也释放 Item(不烧名额)');

console.log('plaid-multi-item: OK');
