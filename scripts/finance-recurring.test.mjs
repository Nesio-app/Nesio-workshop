/**
 * 行为契约:免费最大化·Plaid C —— 订阅涨价检测(免费替代付费 Recurring 的涨价信号)。
 * 锁死:成熟流最近一笔 > 基线 max($0.5,5%) 报涨价、返回涨幅%;水电类不报(天然浮动)、
 * 早识别流不报(基线不稳)、降价/持平不报、按涨幅降序;FinanceTab 涨价徽标接线(源码级)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, process: { env: {} }, console, Date, Math, Set, Map, JSON, Number, Array, Object, String });
  return mod.exports;
}
// finance-features 依赖 bank-tx(providers);只测纯函数 recurringPriceHikes,桩掉 bank-tx。
const feat = loadTs('../lib/portal/finance-features.ts', (p) =>
  p.includes('bank-tx') || p.includes('providers') ? {
    detectRecurring: () => [], subscriptionLoad: () => ({}), merchantKey: (t) => t.name,
    txFlow: () => 'expense', loadFlowRules: () => ({}), effectiveCategory: (t) => t.category,
    summarizeMonth: () => ({}), availableMonths: () => [],
  } : ({}));

const stream = (o) => ({ status: 'mature', category: 'GENERAL_SERVICES', currency: 'USD', name: o.name || 'X', key: o.key || o.name || 'X', baselineAmount: o.from, latestAmount: o.to, ...o });

// ── 涨价:Netflix 15→17(+13%),报 ──
{
  const hikes = feat.recurringPriceHikes([stream({ name: 'Netflix', from: 15, to: 17 })]);
  assert.equal(hikes.length, 1);
  assert.equal(hikes[0].from, 15); assert.equal(hikes[0].to, 17);
  assert.equal(hikes[0].deltaPct, 13, '涨幅 round(2/15*100)=13');
}
// ── 噪音门:涨幅 < 5% 或 < $0.5 不报 ──
assert.equal(feat.recurringPriceHikes([stream({ name: 'A', from: 100, to: 103 })]).length, 0, '3% < 5% 不报');
assert.equal(feat.recurringPriceHikes([stream({ name: 'B', from: 5, to: 5.3 })]).length, 0, '$0.3 < $0.5 不报');
assert.equal(feat.recurringPriceHikes([stream({ name: 'C', from: 5, to: 6 })]).length, 1, '$1 且 20% 报');
// ── 降价/持平不报 ──
assert.equal(feat.recurringPriceHikes([stream({ name: 'D', from: 20, to: 18 })]).length, 0, '降价不报');
assert.equal(feat.recurringPriceHikes([stream({ name: 'E', from: 20, to: 20 })]).length, 0, '持平不报');
// ── 水电类不报(天然浮动) ──
assert.equal(feat.recurringPriceHikes([stream({ name: '电费', from: 80, to: 120, category: 'RENT_AND_UTILITIES' })]).length, 0, '水电不算涨价');
// ── 早识别流不报(基线不稳) ──
assert.equal(feat.recurringPriceHikes([stream({ name: 'F', from: 10, to: 15, status: 'predicted' })]).length, 0, 'predicted 不报');
// ── 按涨幅(绝对额)降序 ──
{
  const hikes = feat.recurringPriceHikes([stream({ name: 'small', from: 10, to: 12 }), stream({ name: 'big', from: 50, to: 70 })]);
  assert.equal(hikes[0].name, 'big', '大额涨价排前');
}

// ── FinanceTab 接线(源码级) ──
const tab = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
assert.ok(tab.includes('recurringPriceHikes') && tab.includes('hikeByKey'), 'FinanceTab 计算涨价映射');
assert.ok(tab.includes('↑涨价') || tab.includes('↑ up'), '订阅行涨价徽标');

console.log('finance-recurring: OK');
