/**
 * 行为契约:sandbox 混库清洗(财务①)。
 * 锁死:账户按 id 只增合并(临时失败的银行不丢账户 → 不误杀);
 * 孤儿交易(accountId 不属于任何已知账户)读时被滤掉;
 * fail-safe:账户表空不过滤、无 accountId 的老数据保留。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

// 两个可注入的内存 blob 桩(tx / accounts 各一),模拟 IDB 同步缓存语义
const caches = { tx: null, accounts: null };
let storeIdx = 0;
const fakeCreateBlobStore = () => {
  const key = storeIdx++ === 0 ? 'tx' : 'accounts'; // bank-tx 模块内先建 txStore 再建 accountsStore
  return { load: () => caches[key], save: (v) => { caches[key] = v; }, ready: async () => {} };
};

const txCategory = (() => {
  const src = fs.readFileSync(new URL('../lib/portal/tx-category.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console });
  return mod.exports;
})();

function loadBank() {
  const src = fs.readFileSync(new URL('../lib/portal/bank-tx.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, Math, Number, Array, Date, Set, Map, Object, JSON,
    require: (p) => p === './storage-health' ? { reportStorageDropped() {} }
      : p === './tx-category' ? txCategory
      : p === './idb-blob-store' ? { createBlobStore: fakeCreateBlobStore } : ({}),
  });
  return mod.exports;
}
const bank = loadBank();

const tx = (id, accountId, amount = 10) => ({ id, accountId, date: '2026-06-10', name: id, amount, currency: 'USD', category: '' });

// 1. fail-safe:账户表空 → 不过滤(水合未完成/没同步过账户,不敢下结论)
caches.tx = [tx('t1', 'sandbox-acc'), tx('t2', 'real-acc')];
caches.accounts = null;
assert.equal(bank.loadBankTx().length, 2, '账户表空 → 全保留');

// 2. 孤儿过滤:真账户在表、sandbox 账户不在 → sandbox 交易被滤
bank.saveBankAccounts([{ id: 'real-acc', name: 'Chase', currency: 'USD' }]);
const visible = bank.loadBankTx();
assert.equal(visible.length, 1, 'sandbox 孤儿交易被滤掉');
assert.equal(visible[0].id, 't2', '留下的是真账户交易');

// 3. 无 accountId 的老数据保守保留
caches.tx = [tx('t3', undefined), tx('t4', 'ghost-acc')];
const v2 = bank.loadBankTx();
assert.equal(v2.length, 1, '孤儿滤掉、无 accountId 保留');
assert.equal(v2[0].id, 't3');

// 4. 账户只增合并:另一家银行同步(当次不含 real-acc)不抹掉已有账户
bank.saveBankAccounts([{ id: 'bank-b', name: 'BoA', currency: 'USD' }]);
const accs = bank.loadBankAccounts();
assert.equal(accs.length, 2, '账户 union:real-acc 未被整体替换抹掉');
// 同 id 字段更新(余额/名称取最新)
bank.saveBankAccounts([{ id: 'real-acc', name: 'Chase Checking', currency: 'USD', balance: 88 }]);
const updated = bank.loadBankAccounts().find((a) => a.id === 'real-acc');
assert.equal(updated.name, 'Chase Checking', '同 id 名称更新');
assert.equal(updated.balance, 88, '余额更新');
assert.equal(bank.loadBankAccounts().length, 2, '仍是 2 个账户(无重复)');

// 5. 两家银行都在账户表时,两家交易都可见(不误杀活银行)
caches.tx = [tx('a1', 'real-acc'), tx('b1', 'bank-b'), tx('s1', 'sandbox-acc')];
const v3 = bank.loadBankTx();
assert.equal(v3.length, 2, '两家活银行交易都在、sandbox 滤掉');

// ── 财务③:内部调整对识别(同日同账户同额一正一负、双方名字都带调整词) ──
const adj = (id, name, amount, accountId = 'real-acc', date = '2026-06-19') =>
  ({ id, accountId, date, name, amount, currency: 'USD', category: '' });

// 6. 典型对:ADJ REDIST ±150 → 两条都进折叠集
const pair = [adj('p1', 'KC0P ADJ REDIST FR 2892', 150), adj('p2', 'KC0P ADJ REDIST TO 2892', -150)];
const ids1 = bank.internalAdjustmentIds(pair);
assert.equal(ids1.size, 2, '±同额调整对整对识别');
assert.ok(ids1.has('p1') && ids1.has('p2'));

// 7. 配不上的单条保留:三条里只配一对,落单的 +150 不折叠
const trio = [...pair, adj('p3', 'KC0P ADJ REDIST FR 2892', 150)];
const ids2 = bank.internalAdjustmentIds(trio);
assert.equal(ids2.size, 2, '贪心一对一,落单调整条不折叠');

// 8. 金额巧合不误杀:名字不带调整词的同日同额正负真交易不配对
const coincidence = [adj('c1', 'Refund Store', -88), adj('c2', 'Grocery Store', 88)];
assert.equal(bank.internalAdjustmentIds(coincidence).size, 0, '非调整名的巧合金额不折叠');

// 9. 跨账户不配对:同日同额正负但账户不同
const crossAcct = [adj('x1', 'ADJ REDIST FR', 150, 'real-acc'), adj('x2', 'ADJ REDIST TO', -150, 'bank-b')];
assert.equal(bank.internalAdjustmentIds(crossAcct).size, 0, '跨账户不视为内部调整对');

// 10. 单边命中不配对:只有一方名字带调整词
const oneSided = [adj('o1', 'ADJ REDIST FR', 150), adj('o2', 'Coffee Shop', -150)];
assert.equal(bank.internalAdjustmentIds(oneSided).size, 0, '双方名字都须命中关键词');

console.log('bank-orphan: OK');
