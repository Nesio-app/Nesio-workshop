/**
 * 行为契约:财务展示批(财务④)。
 * 锁死:环比百分比有基数下限(上月 <$50 不出数,免 +946% 小基数噪音);
 * 上月为零的类别标 isNew(UI 出「新增」而非百分比);
 * 金额小数位统一(整数无小数、带分恒两位);
 * warm-coach:支出涨幅不用 --status-risk 红(红仅真实风险)。
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, console, Math, Date, Set, Map, Object, JSON, Number, Array });
  return mod.exports;
}
const txCategory = loadTs('../lib/portal/tx-category.ts', () => ({}));
const bank = loadTs('../lib/portal/bank-tx.ts', (p) =>
  p === './storage-health' ? { reportStorageDropped() {} }
  : p === './tx-category' ? txCategory
  : p === './idb-blob-store' ? { createBlobStore: fakeCreateBlobStore } : ({}));

const tx = (id, date, amount, category) => ({ id, date, name: id, amount, currency: 'USD', category, accountId: 'a1' });

// ── categoryBreakdown:环比基数下限 ──
const txs = [
  // 餐饮:上月 300 → 本月 450(基数够,出 +50%)
  tx('f1', '2026-05-10', 300, 'FOOD_AND_DRINK'), tx('f2', '2026-06-10', 450, 'FOOD_AND_DRINK'),
  // 娱乐:上月 30 → 本月 314(小基数,+946% 是噪音 → 不出百分比,也不算「新增」)
  tx('e1', '2026-05-11', 30, 'ENTERTAINMENT'), tx('e2', '2026-06-11', 314, 'ENTERTAINMENT'),
  // 交通:上月无 → 本月 80(新增)
  tx('t1', '2026-06-12', 80, 'TRANSPORTATION'),
];
const cats = bank.categoryBreakdown(txs, '2026-06');
const byCat = (c) => cats.find((x) => x.category === c);

assert.equal(byCat('FOOD_AND_DRINK').deltaPct, 50, '基数够 → 正常出环比');
assert.equal(byCat('FOOD_AND_DRINK').isNew, false);
assert.equal(byCat('ENTERTAINMENT').deltaPct, null, '上月 <$50 → 小基数噪音不出百分比');
assert.equal(byCat('ENTERTAINMENT').isNew, false, '上月有痕迹就不算「新增」');
assert.equal(byCat('TRANSPORTATION').deltaPct, null, '上月无数据 → 无环比');
assert.equal(byCat('TRANSPORTATION').isNew, true, '上月为零 → 标新增');

// ── formatMoney:小数位统一 ──
assert.equal(bank.formatMoney(500), '$500', '整数不带小数');
assert.equal(bank.formatMoney(100.8), '$100.80', '带分恒两位(不再 $100.8)');
assert.equal(bank.formatMoney(1234.5), '$1,234.50', '千分位 + 两位小数');
assert.equal(bank.formatMoney(0.05), '$0.05');
assert.equal(bank.formatMoney(88, 'CNY'), '¥88');

// ── warm-coach:支出涨幅不用风险红;新增标中性 ──
const css = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const upRule = css.split('\n').find((l) => l.includes('.nesio-fin-delta.up'));
assert.ok(upRule && !upRule.includes('--status-risk'), '涨幅不用 --status-risk(红仅真实风险)');
assert.ok(upRule.includes('--status-gentle'), '涨幅用琥珀 --status-gentle');
assert.ok(css.includes('.nesio-fin-delta.is-new'), '「新增」标有中性样式');

// ── 净支出 KPI 同样有基数下限(源码级,防回潮) ──
const tab = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
assert.ok(/prevSummary\.net >= 50/.test(tab), '净支出环比有 $50 基数下限');

// ── 财务⑤:statement credit 语义(返还/报销 ≠ 商户退款) ──
const ftx = (name, amount, category = 'TRAVEL') => ({ id: name, date: '2026-06-20', name, amount, currency: 'USD', category, accountId: 'a1' });

assert.equal(bank.txFlow(ftx('AMEX GLOBAL ENTRY CREDIT', -120), {}), 'rebate', '卡权益 credit → 返还');
assert.equal(bank.txFlow(ftx('CASHBACK REBATE', -25), {}), 'rebate', 'rebate/cashback → 返还');
assert.equal(bank.txFlow(ftx('Amazon.com', -35, 'GENERAL_MERCHANDISE'), {}), 'refund', '普通商户负数仍是退款(不误伤)');
assert.equal(bank.txFlow(ftx('NAVY FEDERAL CREDIT UNION', -500, 'GENERAL_SERVICES'), {}), 'refund', 'CREDIT UNION 是机构名,不当返还');
assert.equal(bank.txFlow(ftx('GLOBAL ENTRY CREDIT', 120), {}), 'expense', '正数照旧是支出');
assert.equal(bank.txFlow(ftx('SOME CREDIT', -50, ''), {}), 'transfer', '无分类负数照旧 transfer(不计收支)');
assert.equal(bank.txFlow(ftx('AMEX GLOBAL ENTRY CREDIT', -120), { 'AMEX GLOBAL ENTRY CREDIT': 'income' }), 'income', '用户手动规则仍最高优先');

// 金额口径:返还与退款同样冲抵支出(净额不因语义细分而变)
const mixed = [ftx('Coffee', 200, 'FOOD_AND_DRINK'), ftx('AMEX GLOBAL ENTRY CREDIT', -120)];
const sum = bank.summarizeMonth(mixed, '2026-06');
assert.equal(sum.refunds, 120, '返还进退款/返还桶');
assert.equal(sum.net, 80, '净支出 = 支出 - 返还');

// UI:分流选项与标签齐备
assert.ok(bank.TX_FLOW_LABELS.rebate, 'TX_FLOW_LABELS 有 rebate');
const tab2 = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
assert.ok(tab2.includes("'rebate'"), '分流纠正选项含「返还/报销」');

console.log('fin-display: OK');
