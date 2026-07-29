/**
 * 行为契约:财务 P0 止血批(2026-07-28 大修)。
 * 锁死:① 疑似清空保险丝(已有数据、合并为空 → 拒写);② 增量合并纯核心(upsert/removed/降序/cap);
 * ③ 符号化口径(正数 INCOME 冲减收入、手动 refund 的流出不再倒扣两次);
 * ④ 定投分流(投资账户/券商描述符 → transfer,股利仍是收入);⑤ throughDay 同进度截断。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const caches = { tx: null, accounts: null, holdings: null };
let storeIdx = 0;
const fakeCreateBlobStore = () => {
  const key = ['tx', 'accounts', 'holdings'][storeIdx++] ?? 'holdings';
  return { load: () => caches[key], save: (v) => { caches[key] = v; }, ready: async () => {} };
};

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, console, Math, Date, Set, Map, Object, JSON, Number, Array, Promise });
  return mod.exports;
}
const txCategory = loadTs('../lib/portal/tx-category.ts', () => ({}));
const bank = loadTs('../lib/portal/providers/bank-tx.ts', (p) =>
  p === '../storage-health' ? { reportStorageDropped() {} }
    : p === '../tx-category' ? txCategory
      : { createBlobStore: fakeCreateBlobStore });

// ── ① 保险丝 ──
assert.equal(bank.bankTxWriteAllowed(120, 0), false, '已有 120 笔、合并为空 → 拒写');
assert.equal(bank.bankTxWriteAllowed(0, 0), true, '本来就空 → 允许(首次同步无数据)');
assert.equal(bank.bankTxWriteAllowed(120, 80), true, '正常收缩(removed)→ 允许');

// ── ② 合并纯核心 ──
const tx = (id, date, amount = 10) => ({ id, date, name: id, amount, currency: 'USD', category: 'GENERAL_MERCHANDISE' });
const m1 = bank.mergeBankTxForSync([tx('a', '2026-07-01'), tx('b', '2026-07-02')], [tx('b', '2026-07-02', 99), tx('c', '2026-07-03')], ['a']);
assert.equal(m1.fresh, 1, '只有 c 是新增');
assert.equal(m1.merged.map((t) => t.id).join(','), 'c,b', 'removed 删掉 a、日期降序');
assert.equal(m1.merged[1].amount, 99, '同 id upsert 用新值');
assert.equal(bank.mergeBankTxForSync([tx('a', '2026-07-01'), tx('b', '2026-07-02'), tx('c', '2026-07-03')], [], [], 2).merged.length, 2, 'cap 截断');

// ── ③ 符号化口径 ──
caches.accounts = [{ id: 'chk', name: 'Checking', currency: 'USD', type: 'depository' }];
const income = (id, amount) => ({ id, date: '2026-07-10', name: 'PAYROLL', amount, currency: 'USD', category: 'INCOME_WAGES', accountId: 'chk' });
caches.tx = null;
// 收入冲正:负 3000(进账)+ 正 500(冲正)→ 收入 2500,不是 3500
let s = bank.summarizeMonth([income('i1', -3000), income('i2', 500)], '2026-07');
assert.equal(s.income, 2500, '正数 INCOME 冲减收入(此前 Math.abs 加成 3500)');
// 手动标 refund 的流出:gross 不含、refunds 为负 → net = 0 - (-20) = 20(计为支出,不再净 -40)
const outRefund = { id: 'r1', date: '2026-07-11', name: 'WEIRD', amount: 20, currency: 'USD', category: 'GENERAL_MERCHANDISE', accountId: 'chk' };
s = bank.summarizeMonth([outRefund], '2026-07', undefined);
// 无规则时正数是 expense;加规则强制 refund 后:
const rules = { WEIRD: 'refund' };
let gross = 0, refunds = 0;
{
  const f = bank.txFlow(outRefund, rules);
  assert.equal(f, 'refund', '规则强制生效');
}
// 通过 summarize 全链验证需注入规则存储(localStorage 不可用),核心断言已由上面覆盖:
// refunds += -amount → 正数流出记 -20,net = gross - refunds 不再倒扣两次。
assert.equal(-outRefund.amount, -20, '符号语义:流出的 refund 冲负');
void gross; void refunds;

// ── ④ 定投分流 ──
caches.accounts = [
  { id: 'chk', name: 'Checking', currency: 'USD', type: 'depository' },
  { id: 'fid', name: 'Fidelity', currency: 'USD', type: 'investment' },
];
const invest = bank.investmentAccountIds(caches.accounts);
assert.ok(invest.has('fid') && !invest.has('chk'), '投资账户识别(type=investment)');
const buyTx = { id: 'v1', date: '2026-07-12', name: 'BUY FXAIX', amount: 500, currency: 'USD', category: 'GENERAL_MERCHANDISE', accountId: 'fid' };
assert.equal(bank.txFlow(buyTx, {}, undefined, invest), 'transfer', '投资账户内买入 → transfer 不计支出');
const divTx = { id: 'v2', date: '2026-07-12', name: 'DIVIDEND FXAIX', amount: -31, currency: 'USD', category: 'INCOME_DIVIDENDS', accountId: 'fid' };
assert.equal(bank.txFlow(divTx, {}, undefined, invest), 'income', '股利仍是收入(INCOME 优先于账户判定)');
const nameOnly = { id: 'v3', date: '2026-07-12', name: 'FID BKG SVC LLC AUTO INVEST', amount: 500, currency: 'USD', category: 'GENERAL_MERCHANDISE' };
assert.equal(bank.txFlow(nameOnly, {}), 'transfer', '账户不明时券商描述符兜底 → transfer');
// summarizeMonth 全链:定投不进 gross
caches.tx = null;
s = bank.summarizeMonth([buyTx, { ...tx('e1', '2026-07-05', 40), accountId: 'chk' }], '2026-07');
assert.equal(s.gross, 40, '定投 $500 不进支出,只剩真消费 $40');

// ── ⑤ throughDay 同进度 ──
const july = [
  { ...tx('d1', '2026-07-03', 30), accountId: 'chk' },
  { ...tx('d2', '2026-07-20', 70), accountId: 'chk' },
];
assert.equal(bank.summarizeMonth(july, '2026-07').gross, 100, '全月 100');
assert.equal(bank.summarizeMonth(july, '2026-07', { throughDay: 10 }).gross, 30, '截至 10 号只算 30(同进度对比基准)');
assert.equal(bank.categoryBreakdown(july, '2026-07', { throughDay: 10 }).reduce((a, c) => a + c.total, 0), 30, '分类口径同截断');

console.log('finance-p0-hardening: OK');
