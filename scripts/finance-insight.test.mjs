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
  if (p === '../storage-health') return { reportStorageDropped() {} };
  if (p === '../idb-blob-store') return { createBlobStore: fakeBlobStore };
  if (p === '../tx-category') return txCategory;
  return {};
};
const bank = loadTs('../lib/portal/providers/bank-tx.ts', bankRequire);
const features = loadTs('../lib/portal/finance-features.ts', (p) => (p === './bank-tx' ? bank : {}));
const fin = loadTs('../lib/portal/finance-insight.ts', (p) => (p === './bank-tx' ? bank : p === './tx-category' ? txCategory : p === './finance-features' ? features : {}));
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

// ══ 财务⑭(L2 判定层扩展)══
const dayMs = 86_400_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);
const atx = (id, date, name, amount, category, accountId = 'a1') => ({ id, date, name, amount, currency: 'USD', category, accountId });

// a) 基线漂移:7 个月餐饮 ~100,本月 400 → cat-drift 报、cat-surge 不双报
{
  const drift = [];
  const monthly = [80, 120, 90, 110, 95, 105]; // median 100 / MAD 10 的真实波动基线
  for (let m = 1; m <= 6; m++) drift.push(atx(`d${m}`, `2026-0${m}-10`, 'Grocer', monthly[m - 1], 'FOOD_AND_DRINK'));
  drift.push(atx('dcur', '2026-07-10', 'Grocer', 400, 'FOOD_AND_DRINK'));
  const fs2 = financeFindings(drift, [], '2026-07');
  assert.ok(fs2.some((f) => f.id === 'finance-cat-drift-FOOD_AND_DRINK'), '对个人基线漂移报 drift');
  assert.ok(!fs2.some((f) => f.id.startsWith('finance-cat-surge-')), '基线可用时环比 surge 让位不双报');
  // 反例:本月 110(z 很小)→ 不报
  const calm = drift.slice(0, 6).concat(atx('dcur2', '2026-07-10', 'Grocer', 110, 'FOOD_AND_DRINK'));
  assert.ok(!financeFindings(calm, [], '2026-07').some((f) => f.id.startsWith('finance-cat-drift')), '正常波动不报');
}

// b) 费用体检:本月 BANK_FEES → 报合计与笔数;无费用不报
{
  const feeTx = [atx('fee1', '2026-06-08', 'Overdraft Fee', 35, 'BANK_FEES'), atx('n1', '2026-06-09', 'Grocer', 60, 'FOOD_AND_DRINK'), atx('n0', '2026-05-09', 'Grocer', 55, 'FOOD_AND_DRINK')];
  const f = financeFindings(feeTx, [], '2026-06').find((x) => x.id === 'finance-fee-audit');
  assert.ok(f, '有银行费用应报');
  assert.match(f.detail[0], /35/, '带合计金额');
  assert.ok(!financeFindings(feeTx.slice(1), [], '2026-06').some((x) => x.kind === 'fee_audit'), '无费用不报');
}

// c) 新订阅知情:恰好 3 笔、首笔在 90 天内 → 报;第 4 笔后不再报
{
  const sub = [70, 40, 10].map((d, i) => atx(`s${i}`, iso(d * dayMs), 'Some New Sub', 12.99, 'GENERAL_SERVICES'));
  const f = financeFindings(sub).find((x) => x.kind === 'new_recurring');
  assert.ok(f, '新成熟定期应报「新订阅」');
  const sub4 = [100, 70, 40, 10].map((d, i) => atx(`s4${i}`, iso(d * dayMs), 'Some New Sub', 12.99, 'GENERAL_SERVICES'));
  assert.ok(!financeFindings(sub4).some((x) => x.kind === 'new_recurring'), '第 4 期起不再是「新」');
}

// d) 价格爬升:+5%(≥$1)也报(小步慢涨);id 兼容 finance-hike-
{
  const creep = [atx('c1', iso(70 * dayMs), 'StreamCo', 18, 'ENTERTAINMENT'), atx('c2', iso(40 * dayMs), 'StreamCo', 18, 'ENTERTAINMENT'), atx('c3', iso(10 * dayMs), 'StreamCo', 19.2, 'ENTERTAINMENT')];
  const f = financeFindings(creep).find((x) => x.kind === 'subscription_hike');
  // P2:id 改用 merchantKey(entity 优先/归一名兜底)—— 商户改描述符不再生成新 id(Today 去重稳定)
  assert.ok(f && f.id.startsWith('finance-hike-') && f.id.toLowerCase().includes('streamco'), '+6.7% 爬升要报且 id 稳定(merchantKey)');
}

// e) 余额风险:30 天投影转负 → flag;余额充足不报
{
  const rent = [75, 45, 15].map((d, i) => atx(`r${i}`, iso(d * dayMs), 'Apartment Rent', 800, 'RENT_AND_UTILITIES'));
  const poor = [{ id: 'd1', name: 'Chk', type: 'depository', balance: 500, currency: 'USD' }];
  const rich = [{ id: 'd1', name: 'Chk', type: 'depository', balance: 5000, currency: 'USD' }];
  const f = financeFindings(rent, poor).find((x) => x.kind === 'balance_risk');
  assert.ok(f && f.severity === 'flag', '投影透支记 flag(真实风险)');
  assert.ok(!financeFindings(rent, rich).some((x) => x.kind === 'balance_risk'), '余额充足不报');
}

// f) 储蓄率:近 2 完整月结余为负 → attention(需可靠收入流)
{
  const pay = [];
  for (let d = 98; d >= 7; d -= 14) pay.push(atx(`pay${d}`, iso(d * dayMs), 'ACME PAYROLL', -2000, 'INCOME'));
  const prev1 = new Date(); prev1.setDate(1); prev1.setDate(prev1.getDate() - 5);   // 上个月内某日
  const prev2 = new Date(prev1); prev2.setDate(1); prev2.setDate(prev2.getDate() - 5); // 上上月内某日
  const overspend = [
    atx('o1', prev1.toISOString().slice(0, 10), 'Big Store', 7000, 'GENERAL_MERCHANDISE'),
    atx('o2', prev2.toISOString().slice(0, 10), 'Big Store', 7000, 'GENERAL_MERCHANDISE'),
  ];
  const f = financeFindings([...pay, ...overspend]).find((x) => x.kind === 'savings_rate');
  assert.ok(f, '连续两完整月入不敷出应温和提示');
  assert.ok(!/超支|失败|风险/.test(f.title[0]), 'warm-coach 语气');
  // 反例:没有收入流 → 静默
  assert.ok(!financeFindings(overspend).some((x) => x.kind === 'savings_rate'), '无收入数据不硬算');
}

// ── Layer1 漂移收口契约:全仓只有一套财务判定 ──
// 财务页与 Today/问一问 必须同读 financeFindings;bank-tx 里那套 financeAlerts(函数级双实现)已删,
// 不许回潮(回潮 = 两个输出面据同一份流水各说各话)。
const bankSrc = fs.readFileSync(new URL('../lib/portal/providers/bank-tx.ts', import.meta.url), 'utf8');
assert.ok(!bankSrc.includes('export function financeAlerts'), 'bank-tx 不得再有第二套 financeAlerts 判定');
const financeTabSrc = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
assert.ok(financeTabSrc.includes('financeFindings('), '财务页风险预警必须消费统一层 financeFindings');
assert.ok(!financeTabSrc.includes('financeAlerts'), '财务页不得引用已删的 financeAlerts');

console.log('finance-insight: OK');
