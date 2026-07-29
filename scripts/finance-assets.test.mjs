/**
 * 行为契约:财务 P1 数据层(手动资产/锚点/净值快照/小票对账/手动收支)。
 * 锁死:锚点即值(最新锚点=当前值,同日覆盖)、liability 减号、快照按日 upsert+cap、
 * 日变化不足两条不编数、小票候选(金额±1%/日期窗/否决排除/商户加权)、
 * Expense income 方向进收入、已关联小票不进 financeOnly 聚合(防双计)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, console, Math, Date, Set, Map, Object, JSON, Number, Array, Promise });
  return mod.exports;
}

// finance-assets:桩掉 bank-tx / idb / storage-health(只测纯核心)
const assets = loadTs('../lib/portal/finance-assets.ts', (p) =>
  p === './idb-blob-store' ? { createBlobStore: () => ({ load: () => null, save: () => {}, ready: async () => {} }) }
    : p === './storage-health' ? { reportStorageDropped() {} }
      : { loadBankAccounts: () => [], assetSummary: () => ({ net: 0 }), loadHoldings: () => [] });

// ── 锚点与净值 ──
const asset = (kind, cls, anchors) => ({ id: 'x', name: 'x', kind, classification: cls, anchors, createdAt: '' });
assert.equal(assets.assetCurrentValue({ anchors: [{ date: '2026-05-01', value: 100 }, { date: '2026-07-01', value: 130 }] }), 130, '当前值=最新锚点(无关传入顺序)');
assert.equal(assets.assetCurrentValue({ anchors: [] }), 0, '无锚点为 0');
assert.equal(
  assets.manualNetWorth([asset('property', 'asset', [{ date: '2026-07-01', value: 2450 }]), asset('loan', 'liability', [{ date: '2026-07-01', value: 515 }])]),
  1935, 'liability 减号:2450-515',
);

// ── 快照序列 ──
const s1 = assets.upsertSnapshot([], { date: '2026-07-01', plaidNet: 1, manualNet: 0, investTotal: 100 });
const s2 = assets.upsertSnapshot(s1, { date: '2026-07-02', plaidNet: 1, manualNet: 0, investTotal: 108.6 });
const s2b = assets.upsertSnapshot(s2, { date: '2026-07-02', plaidNet: 2, manualNet: 0, investTotal: 109 });
assert.equal(s2b.length, 2, '同日 upsert 不加行');
assert.equal(s2b[0].investTotal, 109, '同日后写覆盖');
assert.equal(assets.upsertSnapshot(s2, { date: '2026-07-03', plaidNet: 1, manualNet: 0, investTotal: 1 }, 2).length, 2, 'cap 截断');
const chg = assets.investDailyChange(s2b);
assert.equal(chg.delta, 9, '今日变化 = 109-100');
assert.equal(chg.fromDate, '2026-07-01', '基准=上一快照');
assert.equal(assets.investDailyChange(s1), null, '不足两条不编数');

// ── 小票对账 ──
const rm = loadTs('../lib/portal/receipt-match.ts', () => ({ reportStorageDropped() {} }));
const btx = (id, date, amount, name) => ({ id, date, amount, name, currency: 'USD', category: '' });
const receipt = { id: 'r1', amount: 86.4, occurredAt: '2026-07-24', merchant: 'Costco' };
const pool = [
  btx('t1', '2026-07-25', 86.4, 'COSTCO WHSE #423'),
  btx('t2', '2026-07-25', 86.4, 'WALMART'),
  btx('t3', '2026-07-30', 86.4, 'COSTCO WHSE'),   // 日期窗外
  btx('t4', '2026-07-24', 50, 'COSTCO'),           // 金额不符
  btx('t5', '2026-07-24', -86.4, 'COSTCO REFUND'), // 进账方向不匹配
];
const cands = rm.receiptMatchCandidates(receipt, pool);
assert.equal(cands[0].id, 't1', '同日差+商户命中排第一');
assert.ok(!cands.some((t) => t.id === 't3' || t.id === 't4' || t.id === 't5'), '窗外/金额不符/方向不符排除');
const rejected = new Set([rm.pairKey('r1', 't1')]);
assert.ok(!rm.receiptMatchCandidates(receipt, pool, { rejected }).some((t) => t.id === 't1'), '否决记忆生效,永不重推');
assert.equal(rm.receiptMatchCandidates(receipt, pool, { taken: new Set(['t1', 't2']) }).length, 0, '已被占用的交易不再推荐');

// ── finance-sources:income 方向 + 防双计(静态断言,行为由 aggregate 测) ──
const srcTxt = fs.readFileSync(new URL('../lib/portal/finance-sources.ts', import.meta.url), 'utf8');
assert.match(srcTxt, /kind\?: 'expense' \| 'income'/, 'Expense 扩 kind');
assert.match(srcTxt, /addManualEntry/, '手工写入门 addManualEntry 存在');
assert.match(srcTxt, /linkedBankTxId\) continue/, 'financeOnly 聚合排除已关联小票(防双计)');
const aggTxt = fs.readFileSync(new URL('../lib/portal/finance-aggregate.ts', import.meta.url), 'utf8');
assert.match(aggTxt, /domainIncome/, '聚合并入手动收入');
const csTxt = fs.readFileSync(new URL('../lib/portal/providers/connector-sync.ts', import.meta.url), 'utf8');
assert.match(csTxt, /recordNetWorthSnapshot/, '同步成功落净值快照');

console.log('finance-assets: OK');
