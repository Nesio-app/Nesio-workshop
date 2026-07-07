/**
 * 行为契约:财务 L1 特征层(财务⑬,docs/design/finance-expert-layers.md)。
 * 锁死:分类基线 median/MAD(当前月不进基线、历史 <3 月不硬算、MAD=0 不出 z);
 * 发薪流周期化(双周 → 月化 ×30.44/14);账单统一月化;余额投影最低点/透支日。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const caches = { tx: null, accounts: null };
let storeIdx = 0;
const fakeCreateBlobStore = () => {
  const key = storeIdx++ === 0 ? 'tx' : 'accounts';
  return { load: () => caches[key], save: (v) => { caches[key] = v; }, ready: async () => {} };
};
function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, process: { env: {} }, console, Date, Math, Set, Map, JSON, Number, Array, Object, String });
  return mod.exports;
}
const txCategory = loadTs('../lib/portal/tx-category.ts', () => ({}));
const bank = loadTs('../lib/portal/bank-tx.ts', (p) =>
  p === './storage-health' ? { reportStorageDropped() {} }
  : p === './tx-category' ? txCategory
  : p === './idb-blob-store' ? { createBlobStore: fakeCreateBlobStore } : ({}));
const feat = loadTs('../lib/portal/finance-features.ts', (p) => (p === './bank-tx' ? bank : ({})));

const tx = (id, date, name, amount, category = 'FOOD_AND_DRINK') =>
  ({ id, date, name, amount, currency: 'USD', category, accountId: 'a1' });

// ── categoryBaseline:median/MAD、当前月不进、不足不硬算 ──
const NOW = new Date('2026-07-15T12:00:00Z');
const foodTotals = [90, 100, 110, 100, 105, 95];
const baseTxs = foodTotals.map((v, i) => tx(`f${i}`, `2026-0${i + 1}-10`, 'Grocer', v));
baseTxs.push(tx('cur', '2026-07-10', 'Grocer', 999)); // 当前月大额,不得进基线
const b = feat.categoryBaseline(baseTxs, 'FOOD_AND_DRINK', NOW);
assert.equal(b.median, 100, '基线中位数');
assert.equal(b.mad, 5, '基线 MAD');
assert.equal(b.months, 6, '取近 6 个完整月');
assert.ok(Math.abs(feat.baselineZ(400, b) - 40.47) < 0.1, 'modified z = 0.6745·(v−med)/MAD');
// MAD=0(常数月)→ z 不可判
const flat = [100, 100, 100].map((v, i) => tx(`c${i}`, `2026-0${i + 4}-10`, 'Grocer', v));
assert.equal(feat.baselineZ(500, feat.categoryBaseline(flat, 'FOOD_AND_DRINK', NOW)), null, 'MAD=0 → null');
// 历史不足 3 月 → null
assert.equal(feat.categoryBaseline(baseTxs.slice(0, 2), 'FOOD_AND_DRINK', NOW), null, '<3 月不硬算');

// ── detectIncome:双周发薪 → 月化 ──
const day = 86_400_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);
const payroll = [70, 56, 42, 28, 14].map((d, i) => tx(`p${i}`, iso(d * day), 'ACME PAYROLL', -2000, 'INCOME'));
const inc = feat.detectIncome([...payroll, tx('x', iso(3 * day), 'Coffee', 5)]);
assert.equal(inc.streams.length, 1, '识别一条发薪流');
assert.equal(inc.streams[0].cadenceDays, 14, '双周周期');
assert.ok(Math.abs(inc.monthlyIncome - 4348.57) < 1, '月化 = 2000×30.44/14');
// 无规律进账不算收入流
const rand = [80, 61, 20].map((d, i) => tx(`r${i}`, iso(d * day), 'ACME PAYROLL', -2000, 'INCOME'));
assert.equal(feat.detectIncome(rand), null, '间隔散乱不算发薪流');

// ── monthlyCashflow:结余 = 收入 − 净支出,时间升序 ──
const cf = feat.monthlyCashflow([...payroll, tx('e1', iso(10 * day), 'Grocer', 300)]);
assert.ok(cf.length >= 1 && cf.every((m) => Math.abs(m.saved - (m.income - m.net)) < 0.01), '结余口径');
assert.ok(cf.every((m, i) => i === 0 || m.ym > cf[i - 1].ym), '时间升序');

// ── subscriptionLoad:统一月化 ──
const load = feat.subscriptionLoad([], [
  { name: 'Netflix', avgAmount: 16, cadenceDays: 30 },
  { name: 'Insurance', avgAmount: 120, cadenceDays: 365 },
]);
assert.ok(Math.abs(load.items[0].monthly - 16.23) < 0.05, '月付月化 ≈ avg×30.44/30');
assert.ok(Math.abs(load.items[1].monthly - 10.01) < 0.05, '年付月化 = avg×30.44/365');
assert.ok(Math.abs(load.monthly - 26.24) < 0.1, '合计');
assert.equal(load.count, 2);

// ── balanceProjection:最低点与透支日 ──
// 月度房租 800,上次在 15 天前 → 下次约 15 天后落在 30 天窗口内
const rentTxs = [75, 45, 15].map((d, i) => tx(`rent${i}`, iso(d * day), 'Apartment Rent', 800, 'RENT_AND_UTILITIES'));
const proj1 = feat.balanceProjection(rentTxs, [{ id: 'd1', name: 'Chk', type: 'depository', balance: 1000, currency: 'USD' }], 30);
assert.equal(proj1.start, 1000);
assert.equal(proj1.min, 200, '扣一次房租后最低 200');
assert.equal(proj1.negativeDate, null, '不透支');
const proj2 = feat.balanceProjection(rentTxs, [{ id: 'd1', name: 'Chk', type: 'depository', balance: 500, currency: 'USD' }], 30);
assert.ok(proj2.negativeDate, '余额 500 扣 800 → 有透支日');
assert.equal(proj2.min, -300);
// 发薪流入抵消:同窗口有 2000 双周薪 → 不透支
const proj3 = feat.balanceProjection([...rentTxs, ...payroll], [{ id: 'd1', name: 'Chk', type: 'depository', balance: 500, currency: 'USD' }], 30);
assert.equal(proj3.negativeDate, null, '发薪流入后不透支');
// 无存款余额 → null
assert.equal(feat.balanceProjection(rentTxs, [{ id: 'c1', name: 'Card', type: 'credit', balance: 100, currency: 'USD' }]), null);

// ── 财务⑯:收入构成按细分类分桶 ──
const ymNow = new Date().toISOString().slice(0, 7);
const incomeTxs = [
  { ...tx('w1', `${ymNow}-03`, 'ACME PAYROLL', -4000, 'INCOME'), categoryDetail: 'INCOME_WAGES' },
  { ...tx('d1', `${ymNow}-05`, 'Fidelity', -120, 'INCOME'), categoryDetail: 'INCOME_DIVIDENDS' },
  { ...tx('i1', `${ymNow}-06`, 'Adjusted Interest', -30, 'INCOME') }, // 无细分 → INCOME_OTHER
  tx('e9', `${ymNow}-07`, 'Grocer', 80), // 支出不进
];
const mix = feat.incomeBreakdown(incomeTxs, ymNow);
assert.deepEqual([...mix].map((s) => s.detail), ['INCOME_WAGES', 'INCOME_DIVIDENDS', 'INCOME_OTHER'], '按细分类分桶且金额降序');
assert.equal(mix[0].total, 4000);
assert.equal(mix[2].total, 30, '缺细分归 INCOME_OTHER');
assert.equal(feat.incomeBreakdown(incomeTxs, '2020-01').length, 0, '无该月收入返回空');

console.log('finance-features: OK');
