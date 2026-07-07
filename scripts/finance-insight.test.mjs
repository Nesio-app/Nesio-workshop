/**
 * 行为契约:财务洞察引擎 + guidance 桥。
 * 验证:异常支出(净/单类激增)、订阅涨价、现金流跑道 三个检测按合成数据正确触发;
 * 空数据返回空;bridge 把 finding 归一成 finance_insight 事件(红旗优先、封顶 3、payload 形状)。
 * finance-insight 依赖 bank-tx,用迷你模块加载器在 vm 里接起来(window 未定义 → 规则加载器返回默认)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, process: { env: {} }, console, Date, Math, Set, Map });
  return mod.exports;
}

// bank-tx 现从 idb-blob-store 取 createBlobStore(流水/账户已迁 IDB)。
// 本契约只测纯聚合函数(financeFindings 直接吃传入的 txs),不走存储 → 给个内存桩即可。
function fakeBlobStore() {
  let cache = null;
  return { load: () => cache, save: (v) => { cache = v; }, ready: async () => {} };
}
const txCategory = loadTs('../lib/portal/tx-category.ts', () => ({}));
const bankRequire = (p) => {
  if (p === './storage-health') return { reportStorageDropped() {} };
  if (p === './idb-blob-store') return { createBlobStore: fakeBlobStore };
  if (p === './tx-category') return txCategory;
  return {};
};
const bank = loadTs('../lib/portal/bank-tx.ts', bankRequire);
const fin = loadTs('../lib/portal/finance-insight.ts', (p) => (p === './bank-tx' ? bank : p === './tx-category' ? txCategory : {}));
const { financeFindings } = fin;

const tx = (id, date, name, amount, category, currency = 'USD') => ({ id, date, name, amount, currency, category });

// 合成数据:
// - StoreA 购物 05 月 300 → 06 月 600(净激增 + 单类 Shopping 激增)
// - Netflix 定期 15.99/15.99/17.99(订阅涨价)
const txs = [
  tx('1', '2026-04-05', 'Netflix', 15.99, 'Services'),
  tx('2', '2026-05-05', 'Netflix', 15.99, 'Services'),
  tx('3', '2026-06-05', 'Netflix', 17.99, 'Services'),
  tx('4', '2026-05-10', 'StoreA', 300, 'Shopping'),
  tx('5', '2026-06-10', 'StoreA', 600, 'Shopping'),
];
const accounts = [{ id: 'a1', name: 'Checking', type: 'depository', balance: 200, currency: 'USD' }];

const findings = financeFindings(txs, accounts, '2026-06');
const byKind = (k) => findings.filter((f) => f.kind === k);

// 异常支出:净激增 + 单类激增 都在
assert.ok(byKind('anomaly').length >= 1, '应检出异常支出');
assert.ok(findings.some((f) => f.id === 'finance-net-surge'), '净支出环比激增');
assert.ok(findings.some((f) => f.id.startsWith('finance-cat-surge-')), '单类支出激增');

// 订阅涨价:Netflix 17.99 vs 15.99
const hike = byKind('subscription_hike')[0];
assert.ok(hike, '应检出订阅涨价');
assert.match(hike.title[0], /Netflix/, '涨价 finding 指名商户');
assert.match(hike.detail[0], /17\.99/, '带最近金额');
assert.match(hike.detail[1], /\+\d+%/, '英文明细带涨幅百分比');

// 现金流跑道:余额 200 / 均支出 → <1.5 月 → flag
const runway = byKind('cash_runway')[0];
assert.ok(runway, '应检出现金流跑道');
assert.equal(runway.severity, 'flag', '跑道 <1.5 月记 flag');

// 排序:flag 在前
assert.equal(findings[0].severity, 'flag', 'flag 排最前');

// 空数据返回空
assert.equal(financeFindings([], []).length, 0, '无交易返回空');
// 现金流:无存款账户 → 不出跑道
assert.equal(financeFindings(txs, []).filter((f) => f.kind === 'cash_runway').length, 0, '无账户余额不算跑道');

// ── bridge:financeFindingsToGuidanceEvents ──
const adaptersSrc = fs.readFileSync(new URL('../lib/platform/guidance-engine/source-adapters.ts', import.meta.url), 'utf8');
const adaptersJs = ts.transpileModule(adaptersSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const aMod = { exports: {} };
vm.runInNewContext(adaptersJs, { module: aMod, exports: aMod.exports, require: () => ({}), console });
const { financeFindingsToGuidanceEvents } = aMod.exports;

const evts = financeFindingsToGuidanceEvents(findings);
assert.ok(evts.length >= 1 && evts.length <= 3, 'bridge 封顶 3 条');
assert.ok(evts.every((e) => e.type === 'domain_insight'), '类型:通用 domain_insight');
assert.ok(evts.every((e) => e.payload.domain === 'finance'), 'payload 标注 finance 域');
assert.equal(evts[0].payload.severity, 'flag', 'bridge 红旗优先');
assert.ok(evts[0].payload.titleZh && evts[0].payload.bodyZh && evts[0].payload.reason, 'payload 带双语 + reason');
assert.match(String(evts[0].payload.reason), /财务/, 'reason 标注财务来源');

// ── Layer1 漂移收口契约:全仓只有一套财务判定 ──
// 财务页与 Today/问一问 必须同读 financeFindings;bank-tx 里那套 financeAlerts(函数级双实现)已删,
// 不许回潮(回潮 = 两个输出面据同一份流水各说各话)。
const bankSrc = fs.readFileSync(new URL('../lib/portal/bank-tx.ts', import.meta.url), 'utf8');
assert.ok(!bankSrc.includes('export function financeAlerts'), 'bank-tx 不得再有第二套 financeAlerts 判定');
const financeTabSrc = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
assert.ok(financeTabSrc.includes('financeFindings('), '财务页风险预警必须消费统一层 financeFindings');
assert.ok(!financeTabSrc.includes('financeAlerts'), '财务页不得引用已删的 financeAlerts');

console.log('finance-insight: OK');
