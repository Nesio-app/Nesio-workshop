/**
 * finance-csv 契约:时间段过滤、表头往返、金额符号约定。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: requireImpl, console, Math, Date, Set, Map, Object, JSON, Number, Array, String, RegExp,
  });
  return mod.exports;
}

const inv = loadTs('../lib/portal/inventory-import.ts', () => ({}));
const txCat = loadTs('../lib/portal/tx-category.ts', () => ({}));
const bank = {
  loadBankTx: () => [],
  saveBankTx() {},
  loadBankAccounts: () => [{ id: 'a1', name: 'Checking', type: 'depository', currency: 'USD', institution: 'Chase', mask: '1234' }],
  mergeBankTxForSync: (prev, add) => ({ merged: [...prev, ...add], fresh: add.length }),
  bankTxWriteAllowed: () => true,
  displayAccountName: (a) => a.name,
  loadAccountNames: () => ({}),
  merchantKey: (t) => t.merchantId || (t.name || '').toLowerCase(),
  loadRuleLabels: () => ({}),
  loadMerchantRules: () => ({}),
  loadFlowRules: () => ({}),
  autoCategory: (t) => t.category || '',
  autoCategoryDetail: (t) => t.categoryDetail || '',
  effectiveCategory: (t) => t.category || '',
  effectiveCategoryDetail: (t) => t.categoryDetail || '',
  autoTxFlow: () => 'expense',
  txFlow: () => 'expense',
  TX_FLOW_LABELS: { expense: ['支出', 'Expense'], income: ['收入', 'Income'], transfer: ['转账/还款', 'Transfer'], refund: ['退款', 'Refund'], rebate: ['返还/报销', 'Credit'] },
};
const ann = {
  loadTxAnnotations: () => ({}),
  txAnnotationOf: () => ({}),
};
const csv = loadTs('../lib/portal/finance-csv.ts', (p) => {
  if (p === './inventory-import') return inv;
  if (p === './tx-category') return txCat;
  if (p === './bank-tx') return bank;
  if (p === './tx-annotations') return ann;
  return {};
});

const txs = [
  { id: '1', date: '2026-09-10', name: 'Coffee', amount: 5, currency: 'USD', category: 'FOOD_AND_DRINK', accountId: 'a1' },
  { id: '2', date: '2026-08-01', name: 'Pay', amount: -3000, currency: 'USD', category: 'INCOME', accountId: 'a1' },
  { id: '3', date: '2026-09-20', name: 'Store', amount: 40, currency: 'USD', category: 'GENERAL_MERCHANDISE', accountId: 'a1' },
];

assert.equal(csv.filterTxByDateRange(txs, '2026-09-01', '2026-09-30').length, 2, '九月两笔');
assert.equal(csv.filterTxByDateRange(txs, '2026-09-10', '2026-09-10').length, 1, '单日');

const out = csv.bankTxToCsv(txs, { from: '2026-09-01', to: '2026-09-30' });
assert.ok(out.includes('merchant_key'), '含商家键');
assert.ok(out.includes('category_manual'), '含手动分类列');
assert.ok(out.includes('account_institution'), '含账户机构');
assert.ok(out.includes('Coffee'), '含咖啡');
assert.ok(out.includes('Chase'), '含机构名');
assert.ok(!out.includes('Pay'), '工资不在九月导出');

const parsed = csv.parseFinanceCsv(out.replace(/^\uFEFF/, ''));
assert.equal(parsed.rows.length, 2, '解析回两行');
assert.equal(parsed.rows[0].amount, 40, '金额绝对值保留符号');

const sample = 'date,name,amount,currency,category,account_name\n2026-09-15,Test,12.5,USD,FOOD_AND_DRINK,Checking\n';
const imp = csv.importFinanceCsv(sample);
assert.equal(imp.imported, 1, '导入 1 笔');
assert.equal(imp.skipped, 0);

console.log('finance-csv: OK');
