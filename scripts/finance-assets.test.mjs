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
// 自查修正:排除加了「流水仍存在」自愈判断(悬空关联不再让钱两边同时消失)
assert.match(srcTxt, /bankIdCache\.has\(e\.linkedBankTxId\)\) continue/, 'financeOnly 聚合排除已关联小票(防双计,带悬空自愈)');
assert.match(srcTxt, /defaultFinanceCurrency/, '手动/小票默认币种与银行主币种同源(不再写死 ¥)');
assert.match(srcTxt, /e\.linkedBankTxId === bankTxId\)\) return false/, '同一笔银行流水只能挂一张小票');
const aggTxt = fs.readFileSync(new URL('../lib/portal/finance-aggregate.ts', import.meta.url), 'utf8');
assert.match(aggTxt, /domainIncome/, '聚合并入手动收入');
const csTxt = fs.readFileSync(new URL('../lib/portal/providers/connector-sync.ts', import.meta.url), 'utf8');
assert.match(csTxt, /recordNetWorthSnapshot/, '同步成功落净值快照');

// ── P2:折旧/持有成本/投资收益/组合体检/订阅分组 ──
assert.equal(assets.assetDepreciation({ anchors: [{ date: '2026-01-01', value: 180 }, { date: '2026-07-01', value: 148 }] }), 32, '折旧=最早−最新(车贬值)');
assert.equal(assets.assetDepreciation({ anchors: [{ date: '2026-01-01', value: 100 }, { date: '2026-07-01', value: 130 }] }), 0, '升值资产折旧为 0');
const costs = assets.assetHoldingCosts('a1', [
  { assetId: 'a1', assetCostKind: 'tax', amount: 300, occurredAt: '2026-04-01' },
  { assetId: 'a1', assetCostKind: 'repair', amount: 120, occurredAt: '2026-06-01' },
  { assetId: 'a1', amount: 50, occurredAt: '2025-06-01' },          // 往年不计
  { assetId: 'a2', assetCostKind: 'tax', amount: 999, occurredAt: '2026-04-01' }, // 别的资产
  { assetId: 'a1', kind: 'income', amount: 10, occurredAt: '2026-04-02' },        // 收入不计
], 2026);
assert.equal(costs.total, 420, '持有成本=税金 300+维修 120(当年口径)');
assert.equal(costs.tax, 300); assert.equal(costs.repair, 120); assert.equal(costs.count, 2);

const feats = loadTs('../lib/portal/finance-features.ts', (p) => p === './bank-tx' ? {
  investmentAccountIds: () => new Set(['fid']),
  summarizeMonth: () => ({ net: 0, income: 0, currency: 'USD' }), availableMonths: () => [],
  detectRecurring: () => [], effectiveCategory: () => '', txFlow: () => 'expense',
  loadFlowRules: () => ({}), expenseMerchants: () => new Set(), median: (a) => a[0] ?? 0,
  ymOf: () => '2026-07', merchantKey: (t) => t.name,
} : {});
const itx = (date, amount, detail, accountId = 'fid') => ({ id: date + detail + amount, date, amount, currency: 'USD', category: 'INCOME', categoryDetail: detail, accountId, name: 'x' });
const ytd = feats.investIncomeYTD([
  itx('2026-03-10', -31, 'INCOME_DIVIDENDS'), itx('2026-06-10', -40, 'INCOME_DIVIDENDS'),
  itx('2026-02-01', -5, 'INCOME_INTEREST_EARNED'), itx('2025-03-10', -99, 'INCOME_DIVIDENDS'),
], 2026);
assert.equal(ytd.dividends, 71, '当年股利聚合(往年不计)');
assert.equal(ytd.interest, 5, '利息单列');
assert.equal(ytd.byMonth[2], 31, '按月分桶(3 月)');
const checkup = feats.portfolioCheckup(
  [{ accountId: 'fid', name: 'FXAIX', ticker: 'FXAIX', type: 'mutual fund', quantity: 1, value: 600, currency: 'USD' },
   { accountId: 'fid', name: 'AAPL', ticker: 'AAPL', type: 'equity', quantity: 1, value: 400, currency: 'USD' }],
  [itx('2026-05-01', 500, ''), itx('2026-05-08', 500, ''), itx('2026-06-01', -200, '')], 2026);
assert.equal(checkup.topPct, 60, '集中度:第一大 60%');
assert.equal(checkup.buys, 2); assert.equal(checkup.sells, 1, '交易回顾(收益类不算卖出)');
const rec = (key, lastDate, count, cadenceDays = 30) => ({ key, name: key, category: '', avgAmount: 10, count, lastDate, nextEstimate: '2026-08-01', cadenceDays, cadenceLabel: ['月付', 'Monthly'], currency: 'USD', latestAmount: 10, baselineAmount: 10, status: 'mature' });
const ch = feats.recurringChanges([rec('steady', '2026-07-20', 6), rec('stalled', '2026-05-01', 6), rec('fresh', '2026-07-15', 2)], new Date('2026-07-28T00:00:00'));
assert.equal(ch.stalled[0].key, 'stalled', '两个周期没扣款 → 疑似停了');
assert.equal(ch.fresh[0].key, 'fresh', '首见 ≤45 天 → 新增');
assert.equal(ch.steady[0].key, 'steady');

// 静态钉:稳定 finding id(商户改描述符不再重复提醒)+ guidelines 补条
const insightTxt = fs.readFileSync(new URL('../lib/portal/finance-insight.ts', import.meta.url), 'utf8');
assert.match(insightTxt, /finance-new-recur-\$\{r\.key\}/, 'new-recur 用稳定 key');
assert.match(insightTxt, /finance-hike-\$\{r\.key\}/, 'hike 用稳定 key');
const glTxt = fs.readFileSync(new URL('../lib/portal/finance-guidelines.ts', import.meta.url), 'utf8');
for (const topic of ['finance-score-credit-utilization', 'finance-cash-runway', 'finance-upcoming-bills', 'finance-net-surge']) {
  assert.ok(glTxt.includes(`'${topic}'`), `guidelines 补条:${topic}`);
}

// ── 渠道余额推算(用户拍板:锚点=盘点复位点 + 其后收支累加) ──
const wallet = { id: 'ch1', anchors: [{ date: '2026-07-10', value: 100 }] };
assert.equal(assets.channelBalance(wallet, [
  { channelId: 'ch1', kind: 'income', amount: 200, occurredAt: '2026-07-15' },
  { channelId: 'ch1', amount: 30, occurredAt: '2026-07-20' },
  { channelId: 'ch1', amount: 99, occurredAt: '2026-07-01' },  // 盘点前:已被盘点吸收
  { channelId: 'other', amount: 50, occurredAt: '2026-07-16' }, // 别的渠道
]), 270, '余额 = 盘点 100 + 收 200 − 支 30(盘点前/他渠道不计)');
assert.equal(assets.channelBalance({ id: 'ch2', anchors: [] }, [
  { channelId: 'ch2', kind: 'income', amount: 88, occurredAt: '2026-07-15' },
]), 88, '无盘点:纯累加');
assert.equal(
  assets.manualNetWorth(
    [{ id: 'ch1', name: 'w', kind: 'cash', classification: 'asset', isChannel: true, anchors: [{ date: '2026-07-10', value: 100 }], createdAt: '' }],
    [{ channelId: 'ch1', kind: 'income', amount: 200, occurredAt: '2026-07-15' }],
  ), 300, '净值里的渠道用推算余额');

console.log('finance-assets: OK');
