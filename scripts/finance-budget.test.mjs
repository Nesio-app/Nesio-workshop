/**
 * 行为契约:预算(财务㉒)。
 * 锁死:基线起草(近 6 完整月 median 取整到 $10、历史不足返回 null 不硬编);
 * 进度口径(总 = 净支出、分类 = 该类支出合计、超支 ratio>1、超支排前);
 * store roundtrip 与坏数据容错。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const caches = { tx: null, accounts: null, holdings: null };
let storeIdx = 0;
const fakeCreateBlobStore = () => {
  const key = ['tx', 'accounts', 'holdings'][storeIdx++] ?? 'holdings'; // bank-tx 内建 store 顺序:tx → accounts → holdings
  return { load: () => caches[key], save: (v) => { caches[key] = v; }, ready: async () => {} };
};
const lsData = new Map();
const fakeWindow = {};
const fakeLocalStorage = {
  getItem: (k) => (lsData.has(k) ? lsData.get(k) : null),
  setItem: (k, v) => { lsData.set(k, String(v)); },
  removeItem: (k) => { lsData.delete(k); },
};
function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: requireImpl, process: { env: {} },
    console, Date, Math, Set, Map, JSON, Number, Array, Object, String,
    window: fakeWindow, localStorage: fakeLocalStorage,
  });
  return mod.exports;
}
const txCategory = loadTs('../lib/portal/tx-category.ts', () => ({}));
const bank = loadTs('../lib/portal/bank-tx.ts', (p) =>
  p === './storage-health' ? { reportStorageDropped() {} }
  : p === './tx-category' ? txCategory
  : p === './idb-blob-store' ? { createBlobStore: fakeCreateBlobStore } : ({}));
const features = loadTs('../lib/portal/finance-features.ts', (p) => (p === './bank-tx' ? bank : ({})));
const budget = loadTs('../lib/portal/finance-budget.ts', (p) =>
  p === './bank-tx' ? bank
  : p === './finance-features' ? features
  : p === './tx-category' ? txCategory
  : p === './storage-health' ? { reportStorageDropped() {} } : ({}));

const NOW = new Date('2026-07-15T12:00:00Z');
const tx = (id, date, name, amount, category) => ({ id, date, name, amount, currency: 'USD', category, accountId: 'a1' });

// ── suggestBudget:近 6 完整月基线起草 ──
const hist = [];
const foodMonthly = [180, 220, 200, 190, 210, 200]; // median 200
for (let m = 1; m <= 6; m++) {
  hist.push(tx(`f${m}`, `2026-0${m}-10`, 'Grocer', foodMonthly[m - 1], 'FOOD_AND_DRINK'));
  hist.push(tx(`t${m}`, `2026-0${m}-12`, 'Gas Station', 95, 'TRANSPORTATION'));
}
const draft = budget.suggestBudget(hist, NOW);
assert.equal(draft.categories.FOOD_AND_DRINK, 200, '基线 median 起草(200 已是 $10 倍数)');
assert.equal(draft.categories.TRANSPORTATION, 100, '95 向上取整到 $10 → 100');
assert.ok(draft.total >= 300, '总额 = 分类合计');
assert.equal(budget.suggestBudget(hist.slice(0, 4), NOW), null, '历史不足 3 完整月 → null 不硬编');

// ── budgetProgress:口径与排序 ──
const curTxs = [
  ...hist,
  tx('c1', '2026-07-05', 'Grocer', 240, 'FOOD_AND_DRINK'),      // 超预算(200)
  tx('c2', '2026-07-06', 'Gas Station', 40, 'TRANSPORTATION'),   // 未超(100)
];
const bp = budget.budgetProgress(curTxs, '2026-07', draft);
const food = bp.perCategory.find((c) => c.category === 'FOOD_AND_DRINK');
assert.equal(food.spent, 240);
assert.ok(food.ratio > 1, '超预算 ratio > 1');
assert.equal(bp.perCategory[0].category, 'FOOD_AND_DRINK', '超支的排最前');
assert.equal(bp.total.budget, draft.total, '总预算');
assert.equal(bp.total.spent, 280, '总口径 = 本月净支出');
assert.equal(bp.total.left, draft.total - 280, '还可以花 = 总预算 − 净支出');
// 无预算 → total null、分类空
const empty = budget.budgetProgress(curTxs, '2026-07', { categories: {} });
assert.equal(empty.total, null);
assert.equal(empty.perCategory.length, 0);

// ── 财务㉖:Everything Else(未设预算分类合计) ──
const withOther = [...curTxs, tx('o1', '2026-07-08', 'Cinema', 55, 'ENTERTAINMENT')];
const bp2 = budget.budgetProgress(withOther, '2026-07', draft);
assert.equal(bp2.otherSpent, 55, '未设预算的分类进 Everything Else');
assert.ok(!bp2.perCategory.some((c) => c.category === 'ENTERTAINMENT'), '不混进已设预算列表');
assert.equal(budget.budgetProgress(curTxs, '2026-07', draft).otherSpent, 0, '全部已设预算 → 0');
assert.equal(empty.otherSpent, 280, '空预算时全部支出都算未设预算');

// ── store roundtrip + 容错 ──
budget.saveBudget({ total: 3000, categories: { FOOD_AND_DRINK: 500 } });
assert.equal(budget.loadBudget().total, 3000, 'roundtrip');
assert.equal(budget.hasBudget(budget.loadBudget()), true);
lsData.set('nesio-fin-budget-v1', '{broken json');
assert.deepEqual({ ...budget.loadBudget().categories }, {}, '坏数据回退空预算');
assert.equal(budget.hasBudget({ categories: {} }), false);

console.log('finance-budget: OK');
