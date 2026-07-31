/**
 * link-usecases —— ①②③④ 四条关联链 + 月度小结的契约。
 *
 * 这一批修的都是同一类毛病:**关联做了,但只有一个地方认**。
 * 所以断言的重点不是「有没有这个函数」,而是「写进去之后别处看不看得到」。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(ROOT + rel, 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function runSource(rel, globals = {}) {
  const src = read(rel).replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, {
    module: m, exports: m.exports, JSON, Array, Object, Set, Map, Number, Math, String, Boolean, Date, RegExp, isNaN,
    console, require: () => ({}), ...globals,
  });
  return m.exports;
}

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

// ── ① 交易关联人:必须落在图上,不能只在财务页 ─────────────────────────────
check('①a 人是按身份键找的,不是字符串相等 —— 「妈妈/母亲」要认成同一个人', () => {
  const c = strip(read('lib/portal/tx-graph-bridge.ts'));
  assert.ok(/resolveEntityKey/.test(c),
    '按 name 字符串比对的话,「妈妈」和「母亲」会是两个人,关联会落到错的节点上');
  assert.ok(/loadEntityAliases/.test(c), '没加载别名表 —— resolveEntityKey 拿不到映射');
});

check('①b 两头缺谁要分开报 —— 「人不在通讯录」和「流水没同步」是两个问题', () => {
  const B = runSource('lib/portal/tx-graph-bridge.ts', {
    window: {},
    getLifeGraph: () => [],
    findTxNode: () => null,
    linkNodes: () => ({ ok: true }), unlinkNodes: () => true, updateLifeNode: () => true,
    resolveEntityKey: (s) => String(s || '').toLowerCase(), loadEntityAliases: () => ({}),
  });
  assert.strictEqual(B.linkTxToPerson('tx1', 'linda').reason, 'no_tx_node');

  const B2 = runSource('lib/portal/tx-graph-bridge.ts', {
    window: {},
    getLifeGraph: () => ([{ id: 'txn', type: 'event', attributes: { txId: 'tx1' } }]),
    findTxNode: () => ({ id: 'txn', attributes: { txId: 'tx1' } }),
    linkNodes: () => ({ ok: true }), unlinkNodes: () => true, updateLifeNode: () => true,
    resolveEntityKey: (s) => String(s || '').toLowerCase(), loadEntityAliases: () => ({}),
  });
  assert.strictEqual(B2.linkTxToPerson('tx1', 'linda').reason, 'no_person_node',
    '流水节点在、人不在 —— 要报 no_person_node,合并成一句「失败了」用户不知道该干什么');
});

check('①c 解除关联:节点不在时算成功(不存在就是解除的目的)', () => {
  const B = runSource('lib/portal/tx-graph-bridge.ts', {
    window: {}, getLifeGraph: () => [], findTxNode: () => null,
    linkNodes: () => ({ ok: true }), unlinkNodes: () => true, updateLifeNode: () => true,
    resolveEntityKey: (s) => String(s || '').toLowerCase(), loadEntityAliases: () => ({}),
  });
  assert.strictEqual(B.unlinkTxFromPerson('tx1', 'linda').graphOk, true,
    '解除的语义是「让它不存在」—— 本来就不存在时报失败会让 UI 弹一个假错误');
});

// ── ② 认领按钮 ────────────────────────────────────────────────────────────
check('②a 认领 UI 三条硬规矩都在(一笔只能认领一次 / 你点头 / 否决有记忆)', () => {
  const c = strip(read('components/portal/finance/SpendClaimRow.tsx'));
  assert.ok(/tx_taken/.test(c), '没处理「已被别的东西认领」—— 同一笔钱会被算两次');
  assert.ok(/rejectClaim\(/.test(c), '没有「不是这笔」的否决记忆 —— 每次进来都推同一个错的');
  assert.ok(/claimSpend\(/.test(c) && !/自动认领|autoClaim/.test(c), '认领必须是你点头,不能自动连');
  assert.ok(/no_tx_node|还没同步进记忆|hasn't synced/.test(c),
    '流水还没进图时要说清楚,不能只说「失败」');
});

check('②b 没填价格/没日期时不摆一个点了没反应的按钮', () => {
  const c = strip(read('components/portal/finance/SpendClaimRow.tsx'));
  assert.ok(/if \(!\(item\.price > 0\) \|\| !item\.occurredAt\) return null;/.test(c),
    '配不了的时候要整行不渲染 —— 摆一颗死按钮是本仓反复踩的坑');
});

check('②c 一餐的 price 空着时不存 0 ——「没记价格」和「免费」不能长得一样', () => {
  const c = strip(read('components/portal/cooking/CookingSheet.tsx'));
  assert.ok(/Number\.isFinite\(p\) && p > 0 \? \{ price: p \} : \{\}/.test(c),
    '空输入 Number() 是 0,存 0 会让 actualSpend 把「没记」当成「花了 0 元」');
  assert.ok(!/addManualEntry|addExpense/.test(c),
    '美味页出现了记账调用 —— 刷卡的话 Plaid 已经有那条流水,再记一笔就是双计');
});

// ── ③ 行程建议:建议,不自动建 ──────────────────────────────────────────────
const TS = () => runSource('lib/portal/trip-suggest.ts', {
  window: { localStorage: { getItem: () => null, setItem: () => {} } },
  localStorage: { getItem: () => null, setItem: () => {} },
  getLifeGraph: () => [],
  linkNodes: () => ({ ok: true }),
  ingestLifeNode: (i) => ({ id: 'new', createdAt: 'x', ...i }),
  reportStorageDropped: () => {},
  extractTravelAnchors: (text) => ({
    flightNos: new Set((text.match(/\b[A-Z]{2}\d{2,4}\b/g) || [])),
    airportPairs: new Set((text.match(/\b[A-Z]{3}>[A-Z]{3}\b/g) || [])),
    pnrs: new Set((text.match(/PNR:([A-Z0-9]{5,8})/g) || []).map((s) => s.slice(4))),
    dateKeys: new Set((text.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [])),
  }),
});

check('③a 光有机场码不提 —— 签名档里的地址也能凑出三字母', () => {
  const T = TS();
  const out = T.suggestTripsFromEmails(
    // 日期**要给全** —— 不给的话它会被「必须有日期」那一关挡掉,
    // 这条断言就钉不住「航班号/PNR 必须有」了(自查反证时抓到的)。
    [{ id: 'e1', source: 'email', name: 'SFO>NRT 我们在 SFO 见 2026-08-12', relations: [], attributes: {}, tags: [] }],
    new Date('2026-07-30'),
  );
  assert.strictEqual(out.length, 0, '没有航班号也没有 PNR 就不该提 —— 那是噪声');
});

check('③b 有航班号 + 日期 → 提;并且**不自动建**', () => {
  const T = TS();
  const out = T.suggestTripsFromEmails(
    [{ id: 'e1', source: 'email', name: 'UA837 2026-08-12 SFO>NRT', relations: [], attributes: {}, tags: [] }],
    new Date('2026-07-30'),
  );
  assert.strictEqual(out.length, 1, '该提的没提');
  assert.strictEqual(out[0].emailNodeId, 'e1');
  const c = strip(read('lib/portal/trip-suggest.ts'));
  // 建节点只能发生在 acceptTripSuggestion 里 —— 扫描函数里出现 ingest 就是自动建了
  const scan = c.slice(c.indexOf('export function suggestTripsFromEmails'), c.indexOf('export function acceptTripSuggestion'));
  assert.ok(!/ingestLifeNode/.test(scan),
    '扫描的时候就把行程建出来了 —— 那是替用户下判断「你要去这趟」,错了他不会知道');
});

check('③c 图里已经有带同一航班号的行程 → 不再提(交给 plan-links 去连)', () => {
  const T = TS();
  const out = T.suggestTripsFromEmails([
    { id: 'p1', source: 'manual', name: 'UA837 东京', tags: ['行程'], relations: [], attributes: {} },
    { id: 'e1', source: 'email', name: 'UA837 2026-08-12 SFO>NRT', relations: [], attributes: {}, tags: [] },
  ], new Date('2026-07-30'));
  assert.strictEqual(out.length, 0, '已经有行程了还提「要建吗」—— 会建出重复的第二条');
});

check('③d 已经连上行程的邮件不再提(否则每次进来推同一条)', () => {
  const T = TS();
  const out = T.suggestTripsFromEmails(
    [{ id: 'e1', source: 'email', name: 'UA837 2026-08-12', relations: [{ targetId: 'p1', relation: 'confirms_plan' }], attributes: {}, tags: [] }],
    new Date('2026-07-30'),
  );
  assert.strictEqual(out.length, 0, '它的活已经干完了,还提就是骚扰');
});

check('③e 建好了但没连上邮件 → 报 link_failed,**不回滚行程**', () => {
  const T = runSource('lib/portal/trip-suggest.ts', {
    window: { localStorage: { getItem: () => null, setItem: () => {} } },
    localStorage: { getItem: () => null, setItem: () => {} },
    getLifeGraph: () => [], linkNodes: () => ({ ok: false }),
    ingestLifeNode: (i) => ({ id: 'new', createdAt: 'x', ...i }),
    reportStorageDropped: () => {}, extractTravelAnchors: () => ({ flightNos: new Set(), airportPairs: new Set(), pnrs: new Set(), dateKeys: new Set() }),
  });
  const r = T.acceptTripSuggestion({ emailNodeId: 'e1', title: '8/12 SFO→NRT', route: 'SFO>NRT', dateKey: '2026-08-12', flightNos: ['UA837'], pnrs: [] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'link_failed', '为了一条关联把用户要的行程删掉更糟');
});

// ── ④ 发票抽金额 ──────────────────────────────────────────────────────────
const RE = () => runSource('lib/portal/receipt-extract.ts');

check('④a 有「合计」关键词时取合计,不取最大的单价', () => {
  const R = RE();
  const f = R.extractReceiptFields('Whole Foods\n牛排 $88.00\n小计 $88.00\n税 $7.04\n合计 $95.04');
  assert.strictEqual(f.amount, 95.04);
  assert.strictEqual(f.amountFrom, 'keyword');
});

check('④b 没有「合计」关键词时取最大,但找零/税那几行要排除', () => {
  const R = RE();
  // ⚠️ 样本里**不能**出现 Total —— 有的话走第①分支就 break 了,
  // 第②分支(取最大 + 排除找零)根本不会跑,断言等于没测(自查反证时抓到的)。
  const f = R.extractReceiptFields('Store\n牛排 $20.00\nCash $100.00\nChange $80.00');
  assert.strictEqual(f.amount, 20, `找零 $80 / 收现 $100 被当成了合计(得到 ${f.amount})`);
  assert.strictEqual(f.amountFrom, 'largest');

  // 有关键词时仍然以关键词为准
  const g = R.extractReceiptFields('Store\nTotal $20.00\nChange $80.00');
  assert.strictEqual(g.amount, 20);
});

check('④c 抽不到金额返回 null —— 猜一个会让你认领错流水', () => {
  const R = RE();
  assert.strictEqual(R.extractReceiptFields('谢谢惠顾\n欢迎再来'), null);
  assert.strictEqual(R.extractReceiptFields(''), null);
});

check('④d 连续调两次结果一样 —— 带 /g 的正则 .test() 有状态,第二张发票会串', () => {
  const R = RE();
  // 第一行**要带金额** —— 不带的话 .test() 匹配失败会自动把 lastIndex 归零,
  // 有状态的 bug 根本不会显形,这条断言就是摆设(自查反证时抓到的)。
  const text = '$5.00 优惠券 Cafe\nTotal $12.50\n2026-07-01';
  const a = R.extractReceiptFields(text);
  const b = R.extractReceiptFields(text);
  const c = R.extractReceiptFields(text);
  // 同上:跨 realm 用 JSON 比值,别比 prototype
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b), '第二次调用结果不同 —— lastIndex 没复位');
  assert.strictEqual(JSON.stringify(b), JSON.stringify(c), '第三次调用结果不同');
  assert.strictEqual(a.date, '2026-07-01');
});

// ── ⑤ 分摊 ────────────────────────────────────────────────────────────────
check('⑤a 分摊差一分都不存,并且要说清还差多少', () => {
  const c = strip(read('lib/portal/tx-annotations.ts'));
  assert.ok(/validateAllocation\(total, splits\)/.test(c), '没走校验 —— 「大致分了一下」的分摊会让分类汇总少钱');
  assert.ok(/sum_mismatch.*delta|delta: v\.delta/.test(c), 'delta 没透出来 —— UI 只能说「合计不对」,你不知道还差多少');
  const ui = strip(read('components/portal/finance/FinanceTab.tsx'));
  assert.ok(/还剩 \$\{|还剩 \$\{r\.delta|r\.delta\.toFixed/.test(ui), 'UI 没显示还差多少');
});

check('⑤b 分摊算「有批注」—— 漏掉的话存进去当场被空键清理删掉', () => {
  const c = strip(read('lib/portal/tx-annotations.ts'));
  const fn = c.slice(c.indexOf('export function hasTxAnnotation'), c.indexOf('export function hasTxAnnotation') + 400);
  assert.ok(/a\.splits/.test(fn) && /a\.amortize/.test(fn),
    'hasTxAnnotation 不认 splits/amortize —— write() 会把这条批注当成空的删掉,分摊存不进去');
});

// ── ⑥ 月度小结 ────────────────────────────────────────────────────────────
const MD = () => runSource('lib/portal/monthly-digest.ts', {
  window: {}, getLifeGraph: () => [], ingestLifeNode: (i) => ({ id: 'n', createdAt: 'x', ...i }),
});

check('⑥a 按月折 + 明细去重 + 当月标 partial', () => {
  const M = MD();
  const out = M.foldEventsToDigests('workout', [
    { date: '2026-07-01', label: '深蹲' }, { date: '2026-07-08', label: '深蹲' },
    { date: '2026-07-15', label: '硬拉' }, { date: '2026-06-20', label: '跑步' },
  ], new Date('2026-07-30'));
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].month, '2026-07');
  assert.strictEqual(out[0].count, 3);
  // 比 join 而不是 deepStrictEqual:vm 里造的数组原型跟本 realm 不同,
  // deepStrictEqual 会因为 prototype 不一致误判成失败(自查时踩到了)。
  assert.strictEqual(out[0].items.join(','), '深蹲,硬拉', '一个月练了 12 次深蹲,明细写 12 遍没意义');
  assert.strictEqual(out[0].partial, true, '当月没过完 —— 不标的话你会以为这就是最终数字');
  assert.strictEqual(out[1].partial, false);
});

check('⑥b 次数为 0 不建节点 ——「这个月练了 0 次」是条没用的记忆', () => {
  const M = MD();
  assert.strictEqual(M.upsertMonthlyDigest({ kind: 'workout', month: '2026-07', count: 0, items: [], partial: true }), null);
});

check('⑥c 幂等键按 (类型, 月份) —— 每次开机重算不能多出一条', () => {
  const M = MD();
  assert.strictEqual(M.digestExternalId('workout', '2026-07'), 'digest:workout:2026-07');
  const n = M.upsertMonthlyDigest({ kind: 'workout', month: '2026-07', count: 3, items: ['深蹲'], partial: true });
  assert.strictEqual(n.attributes.externalId, 'digest:workout:2026-07');
});

check('⑥c2 内容没变**不写** —— 每开一次家庭板就把小结顶到「最近更新」是不行的', () => {
  // 行为测试,不是 grep:`ingestLifeNode` 命中已有节点时是无条件 updateLifeNode,
  // 而那一步会盖 updatedAt + 整图 saveAll + 两条云推送。这个函数被调的场合恰好都是
  // **反复重算同一份内容**(开机一次 · 每开一次家庭板一次),所以不比一下就是纯浪费,
  // 而且会把三条月度小结不断顶到记忆库「最近更新」的最前面。
  let writes = 0;
  const same = {
    id: 'n1', createdAt: 'x',
    attributes: { externalId: 'digest:chore:2026-07', count: 3, partial: true, items: '洗碗,倒垃圾' },
  };
  const M = runSource('lib/portal/monthly-digest.ts', {
    window: {},
    getLifeGraph: () => [same],
    ingestLifeNode: (i) => { writes += 1; return { id: 'n1', createdAt: 'x', ...i }; },
  });
  const input = { kind: 'chore', month: '2026-07', count: 3, items: ['洗碗', '倒垃圾'], partial: true };

  M.upsertMonthlyDigest(input);
  assert.strictEqual(writes, 0, '内容一模一样却还是写了 —— 那每开一次家庭板就是 3 次整图重写 + 6 条云推送');

  // 数字变了就必须写,否则这个优化会把真更新也吞掉
  M.upsertMonthlyDigest({ ...input, count: 4 });
  assert.strictEqual(writes, 1, '次数变了却没写 —— 跳过写入不能跳过真的变化');
  M.upsertMonthlyDigest({ ...input, items: ['洗碗'] });
  assert.strictEqual(writes, 2, '明细变了却没写');
  M.upsertMonthlyDigest({ ...input, partial: false });
  assert.strictEqual(writes, 3, '月份过完了(partial false)却没写 —— 正文里的「到目前为止」会一直挂着');
});

check('⑥d 明细写进**正文** —— 搜索是全文扫的,只放 attributes 搜不到', () => {
  const M = MD();
  const t = M.digestText({ kind: 'workout', month: '2026-07', count: 3, items: ['深蹲', '硬拉'], partial: true });
  assert.ok(t.includes('深蹲') && t.includes('硬拉'), '明细没进正文 —— 搜「深蹲」命中不了这条小结');
  assert.ok(t.includes('到目前为止'), '当月的数字是「到目前为止」,不说的话月中看到偏小的数会以为漏了');
});

check('⑥e 训练留了历史 —— 只存 last 的话「我上周练了什么」永远答不上来', () => {
  const c = strip(read('lib/portal/workout-generate.ts'));
  assert.ok(/HISTORY_KEY/.test(c) && /export function loadWorkoutHistory/.test(c),
    '只存 last 是那一格红的根因 —— 那个问题问的是历史');
  assert.ok(/\.slice\(0, 400\)/.test(c), '没有上限 —— 流水会无限涨');
});

const bad = results.filter((r) => r[0] === 'FAIL');
if (bad.length) {
  console.error(`link-usecases 有 ${bad.length} 条不过:`);
  for (const [, name, msg] of bad) console.error(`  - ${name} → ${msg}`);
  process.exit(1);
}
console.log(`link-usecases: OK(${results.length} 条:关联落图 / 认领三规矩 / 建议不自动建 / 抽金额 / 分摊卡到分 / 月度小结)`);
