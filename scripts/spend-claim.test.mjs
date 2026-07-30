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

check('②d 升格**不在同步流程里**被顺手调用', () => {
  for (const f of ['lib/portal/providers/connector-sync.ts', 'lib/portal/tesla-finance.ts']) {
    let c;
    try { c = strip(read(f)); } catch { continue; }
    assert.ok(!/ensureTxNode/.test(c),
      `${f} 在同步里调了 ensureTxNode —— 那等于把几千条流水全塞进记忆图,记忆库会被淹掉`);
  }
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
