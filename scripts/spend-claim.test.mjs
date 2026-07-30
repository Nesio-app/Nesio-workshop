/**
 * spend-claim + tx-node — 「这件东西花的钱是哪一笔」的契约。
 *
 * 三条最贵的错误:
 *
 *   ① **双计**。衣服/一餐加了 price 之后,最自然的写法是「顺手记一笔支出」——
 *      而那笔钱刷卡时 Plaid 已经有了。月支出凭空多一份,两条记录看起来都对。
 *      所以 price 的语义是**认领**,不是记账。
 *
 *   ② **影子节点进聚合**。升格出来的交易节点带着 txAmount。任何按金额求和的
 *      地方读了它,就是同一笔钱算两次 —— 同样不显眼。
 *
 *   ③ **一笔流水被两件东西认领**。同一笔钱同时算成「这件衣服的」和「那顿饭的」,
 *      两边都显示金额,而实际只花了一次。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { deepEqual as looseDeepEqual } from 'node:assert';

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
    module: m, exports: m.exports,
    JSON, Array, Object, Set, Map, Number, Math, String, Boolean, Date, RegExp, isNaN,
    require: () => ({}), ...globals,
  });
  return m.exports;
}

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

// ── ① price 不记账,只认领 ──────────────────────────────────────────────────
check('①a 衣橱/一餐的 price 不会顺手记一笔支出(源码层)', () => {
  for (const f of ['lib/portal/wardrobe.ts', 'lib/cooking/meals.ts']) {
    const c = strip(read(f));
    for (const bad of ['addManualEntry', 'addExpense', 'addReceiptExpense']) {
      assert.ok(!c.includes(bad),
        `${f} 里出现了 ${bad} —— 刷卡买的话 Plaid 已经有那条流水,再记一笔就是双计,月支出凭空多一份`);
    }
    assert.ok(/price/.test(c), `${f} 没有 price 字段`);
  }
});

check('①b price 写进去要读得回来', () => {
  const w = strip(read('lib/portal/wardrobe.ts'));
  assert.ok(/attributes\.price = /.test(w), '衣橱没写 price');
  assert.ok(/price: a\.price != null/.test(w), '衣橱 toGarment 没把 price 读回来 —— 只写不读等于没写');
  const m = strip(read('lib/cooking/meals.ts'));
  assert.ok(/price: Math\.round\(m\.price/.test(m), '一餐没写 price');
  assert.ok(/a\.price != null/.test(m), '一餐 parse 没把 price 读回来');
});

check('①c 实际花了多少:银行说的优先于你填的;都没有返回 **null** 而不是 0', () => {
  const S = runSource('lib/portal/spend-claim.ts', { window: undefined });
  assert.strictEqual(S.actualSpend({ price: 200 }, { amount: 189.99 }), 189.99,
    '认领之后还用你填的数 —— 你填的是回忆,银行是事实');
  assert.strictEqual(S.actualSpend({ price: 200 }, null), 200);
  assert.strictEqual(S.actualSpend({ price: null }, null), null,
    '返回 0 的话,「没记价格」和「免费」长得一模一样');
  assert.strictEqual(S.actualSpend({}, { amount: -35.5 }), 35.5, '方向由聚合层判,这里只报绝对值');
});

// ── ② 影子节点 ─────────────────────────────────────────────────────────────
check('②a 幂等键用 externalId(externalKey 认的三个字段之一)', () => {
  const T = runSource('lib/portal/tx-node.ts', { window: undefined });
  assert.strictEqual(T.txExternalId('tx_abc'), 'plaidtx:tx_abc');
  const c = strip(read('lib/portal/tx-node.ts'));
  assert.ok(/externalId: txExternalId\(tx\.id\)/.test(c),
    '影子节点没带 externalId —— 升格两次会有两个节点(连接器那批就是这么漏的)');
});

check('②b 影子标记要在,且能被问出来', () => {
  const T = runSource('lib/portal/tx-node.ts', { window: undefined });
  assert.strictEqual(T.isTxShadow({ attributes: { txShadow: true } }), true);
  assert.strictEqual(T.isTxShadow({ attributes: {} }), false);
  assert.strictEqual(T.isTxShadow(null), false, '传 null 要能兜住,不能炸');
  const c = strip(read('lib/portal/tx-node.ts'));
  assert.ok(/txShadow: true/.test(c), '影子节点没打标记 —— 聚合层没法把它跳过,同一笔钱会算两次');
});

check('②c 影子只转述,不许改流水的权威值(源码层)', () => {
  const c = strip(read('lib/portal/tx-node.ts'));
  for (const bad of ['saveBankTx', 'localStorage.setItem', 'updateLifeNode']) {
    assert.ok(!c.includes(bad), `影子层出现了 ${bad} —— 它只该建节点,权威仍在 nesio-bank-tx-v1`);
  }
  assert.ok(/txAmount: tx\.amount/.test(c), '金额字段名要带 tx 前缀,免得和账本自己的 amount 语义混起来');
});

check('②d 流水**没有等级**:同步进来就建节点,不看你有没有关联过它', () => {
  // 2026-07-30 更正:第一版做成「你第一次关联它时才建节点」的懒升格 —— 错的。
  // 那让流水的地位取决于你有没有碰过它,后果是「关联过的那笔能搜到,旁边一模一样
  // 的那笔搜不到」。现在同步即建,一视同仁。
  const c = strip(read('lib/portal/providers/connector-sync.ts'));
  assert.ok(/syncTxNodes\(/.test(c),
    '同步里没有建节点 —— 那些流水在记忆那一侧不存在:搜不到、问一问引用不到、不能被关联');
  const at = c.indexOf('saveBankTx(merged)');
  assert.ok(at > 0 && c.indexOf('syncTxNodes(') > at,
    '建节点在 saveBankTx 之前 —— 流水还没落库就先建影子,失败时会留下指向不存在流水的节点');
  const tn = strip(read('lib/portal/tx-node.ts'));
  assert.ok(!/ensureTxNode/.test(tn), '懒升格的入口还留着 —— 会有人照着它继续按「有没有关联」建节点');
});

check('②e 批量写:一次 loadAll/saveAll + 分块让出主线程(否则 iOS 直接被杀)', () => {
  const tn = strip(read('lib/portal/tx-node.ts'));
  assert.ok(/upsertLifeNodesBatch\(/.test(tn),
    '逐条 ingestLifeNode 灌几千条 = O(n²) 写盘 —— flomo 就是这么把 iOS 标签写死的');
  assert.ok(/setTimeout\(/.test(tn), '没有在块之间让出事件循环,主线程会被长时间独占');
  assert.ok(/TX_NODE_CAP/.test(tn), '没有单次上限 —— 首灌超量会一次性写爆');
  const lg = strip(read('lib/portal/life-graph.ts'));
  const fn = lg.slice(lg.indexOf('export function upsertLifeNodesBatch'), lg.indexOf('export function updateLifeNode'));
  assert.strictEqual((fn.match(/saveAll\(/g) || []).length, 1,
    '批量写里 saveAll 不止一次 —— 那就退回逐条写了,批量的意义没了');
  assert.strictEqual((fn.match(/loadAll\(/g) || []).length, 1, '批量写里 loadAll 不止一次');
});

/** 真跑批量写:切出那一段,注入假存储 —— 只查「freshByKey 在不在源码里」钉不住任何东西。 */
function loadBatchWriter(store) {
  const lg = read('lib/portal/life-graph.ts');
  const from = lg.indexOf('export function upsertLifeNodesBatch');
  const to = lg.indexOf('export function updateLifeNode');
  assert.ok(from > 0 && to > from, 'life-graph 的批量写结构变了 —— 这条测试要跟着改');
  const js = ts.transpileModule(lg.slice(from, to), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, {
    module: m, exports: m.exports, JSON, Array, Object, Set, Map, Number, Math, String, Boolean, Date,
    loadAll: () => store.nodes,
    saveAll: (n) => { store.saves += 1; store.nodes = n; },
    nodeFactSink: null, syncLifeGraphUpsertToCloud: () => {}, syncLifeNodeSignalToCloud: () => {},
    require: () => ({}),
  });
  return m.exports;
}
const keyOf = (a) => (typeof a?.externalId === 'string' ? a.externalId : null);
const input = (ext, name) => ({ type: 'event', name, source: 'system', confidence: 1, relations: [], tags: [], attributes: { externalId: ext } });

check('②f 同一批里出现两次同键 → 只建一个节点(而且不许读到 nodes[-1] 炸掉)', () => {
  const store = { nodes: [], saves: 0 };
  const B = loadBatchWriter(store);
  const r = B.upsertLifeNodesBatch([input('plaidtx:1', 'A'), input('plaidtx:1', 'A 改名'), input('plaidtx:2', 'B')], keyOf);
  assert.strictEqual(store.nodes.length, 2, `同批重复键建出了 ${store.nodes.length} 个节点`);
  assert.strictEqual(r.created, 2);
  assert.strictEqual(store.nodes.find((n) => n.attributes.externalId === 'plaidtx:1').name, 'A 改名',
    '同批第二次没合并进第一次建的那个');
  assert.strictEqual(store.saves, 1);
});

check('②f2 命中已有节点时不许换 id —— 换了关联就全断了', () => {
  const store = { nodes: [{ id: 'old', createdAt: 'X', name: 'A', attributes: { externalId: 'plaidtx:1', keep: 1 }, relations: [], tags: [], type: 'event', source: 'system', confidence: 1 }], saves: 0 };
  const B = loadBatchWriter(store);
  // 输入里**带上** id/createdAt —— 类型上 Omit 掉了,但运行时挡不住调用方漏传
  // (比如从云端拿回来的对象直接丢进来)。不带的话 {...prev, ...input} 本来就保住了
  // prev 的 id,这条断言钉不住任何东西 —— 自查反证时抓到的。
  const r = B.upsertLifeNodesBatch(
    [{ ...input('plaidtx:1', 'A 新名'), id: 'leaked', createdAt: 'Y' }],
    keyOf,
  );
  assert.strictEqual(r.updated, 1);
  assert.strictEqual(store.nodes.length, 1, '命中了却又建了一个');
  assert.strictEqual(store.nodes[0].id, 'old', 'id 被 input 顶掉了 —— 那等于换了一个节点,指向它的关联全断');
  assert.strictEqual(store.nodes[0].createdAt, 'X');
  assert.strictEqual(store.nodes[0].name, 'A 新名');
  assert.strictEqual(store.nodes[0].attributes.keep, 1, 'attributes 被整块替换 —— 上次写进去的字段会被抹掉');
});

check('②g 记忆库默认列表把交易收进可展开分组,但**搜索时不折叠**', () => {
  const m = strip(read('components/portal/MemoryTab.tsx'));
  assert.ok(/isTxShadow/.test(m), '记忆库没识别交易节点');
  assert.ok(/!showTx\) result = result\.filter\(\(n\) => !isTxShadow\(n\)\)/.test(m),
    '默认列表没把交易收起来 —— 几千条会把手记/照片/心情挤没');
  assert.ok(/!isSearching && !typeFilter && txCount > 0/.test(m),
    '搜索或按类型筛选时还显示折叠条 —— 那时候你就是在找它,不该再折');
  // 折叠只影响**浏览**列表;搜索走的是 results 的另一条分支,不许被过滤
  const at = m.indexOf('const results = query.trim()');
  const line = m.slice(at, m.indexOf(';', at + 30));
  assert.ok(!/isTxShadow/.test(line),
    '搜索结果里也把交易过滤掉了 —— 那「可搜」就是假的');
});

// ── ③ 一笔流水只能被一件东西认领 ────────────────────────────────────────────
check('③a claimSpend 会挡住已被认领的流水', () => {
  const S = runSource('lib/portal/spend-claim.ts', {
    window: {},
    getLifeGraph: () => ([{ id: 'shirt', relations: [{ targetId: 'txnode1', relation: 'paid_by_tx' }] }]),
    linkNodes: () => ({ ok: true, created: true }),
    unlinkNodes: () => true,
    receiptMatchCandidates: () => [],
    loadRejectedPairs: () => new Set(),
    rejectPair: () => {},
    pairKey: (a, b) => `${a}|${b}`,
  });
  looseDeepEqual(S.claimSpend('meal1', 'txnode1'), { ok: false, reason: 'tx_taken' },
    '同一笔钱被两件东西认领 —— 两边都显示金额,而实际只花了一次');
  looseDeepEqual(S.claimSpend('meal1', 'txnode2'), { ok: true });
});

check('③b 没有节点 id 时**诚实报 no_tx_node**,不假装成功', () => {
  const S = runSource('lib/portal/spend-claim.ts', {
    window: {}, getLifeGraph: () => [], linkNodes: () => ({ ok: true, created: true }),
    unlinkNodes: () => true, receiptMatchCandidates: () => [], loadRejectedPairs: () => new Set(),
    rejectPair: () => {}, pairKey: (a, b) => `${a}|${b}`,
  });
  looseDeepEqual(S.claimSpend('shirt', ''), { ok: false, reason: 'no_tx_node' });
});

check('③c 认领关系走 A 类(relations),不是又一个 overlay', () => {
  const c = strip(read('lib/portal/spend-claim.ts'));
  assert.ok(/linkNodes\(itemNodeId, txNodeId, CLAIM_RELATION\)/.test(c),
    '认领没走 linkNodes —— 那就是第四个只有一个页面读得到的 overlay(矩阵里所有 🟡 的成因)');
  assert.ok(!/localStorage/.test(c), '认领关系又落了一张自己的表');
});

check('③d 配对判据复用小票那套,不另发明', () => {
  const c = strip(read('lib/portal/spend-claim.ts'));
  assert.ok(/receiptMatchCandidates\(/.test(c), '没复用 receipt-match —— 那套判据已经在小票上跑了很久');
  assert.ok(/rejected: loadRejectedPairs\(\)/.test(c), '没接否决记忆 —— 被否过的建议会反复弹');
  assert.ok(/taken: claimedTxIds\(\)/.test(c), '候选里没排除已被认领的流水');
});

check('③e 认领窗口比小票宽,但金额仍然卡死', () => {
  const c = strip(read('lib/portal/spend-claim.ts'));
  assert.ok(/windowDays \?\? 7/.test(c), '窗口应为 7 天:衣服/饭常常是过两天才想起来记,而小票是当场拍的');
  assert.ok(!/tol|0\.05|amountTolerance/.test(c), '在这一层又放宽了金额 —— 金额是唯一能挡住巧合的判据');
});

const fails = results.filter((r) => r[0] === 'FAIL');
if (fails.length) {
  assert.fail(`spend-claim 有 ${fails.length} 条不过:\n  - `
    + fails.map(([, n, m]) => `${n}${m ? ` → ${m}` : ''}`).join('\n  - '));
}
console.log(`spend-claim: OK(${results.length} 条,price 只认领不记账 / 影子不进聚合 / 一笔流水只能被认领一次 / 关联走 A 类)`);
