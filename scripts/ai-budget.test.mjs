/**
 * 行为契约:全局日成本熔断(批次196 · 手册#3)。
 * 验证:未设预算 → 恒 inert(不熔断);设了预算 → 按路由粗估累计,超额后 isOverDailyBudget 翻真;
 * 未知路由走默认单价;spentTodayUsd 反映累计。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/ai-budget.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

// 可控的环境变量:测试改这个字典即可改熔断阈值。
const ENV = { NESIO_DAILY_AI_BUDGET_USD: '' };
function load() {
  const mod = { exports: {} };
  const require = (id) => {
    if (String(id).includes('/env')) return { envValue: (k) => ENV[k] ?? '' };
    return {};
  };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require, Date, Number, Math, Object, console });
  return mod.exports;
}

// 1) 未设预算 → inert:狂调也不熔断。
{
  ENV.NESIO_DAILY_AI_BUDGET_USD = '';
  const m = load();
  for (let i = 0; i < 1000; i++) m.recordAiCall('chat');
  assert.equal(m.dailyBudgetUsd(), 0, '未设预算 → 上限 0');
  assert.equal(m.isOverDailyBudget(), false, '未设预算 → 永不熔断(inert)');
}

// 2) 设了预算 → 累计到阈值后翻真。
{
  ENV.NESIO_DAILY_AI_BUDGET_USD = '0.01';   // chat=0.004/次 → 第 3 次(0.012)越界
  const m = load();
  assert.equal(m.isOverDailyBudget(), false, '起始未花 → 未超');
  m.recordAiCall('chat');                   // 0.004
  assert.equal(m.isOverDailyBudget(), false, '0.004 < 0.01');
  m.recordAiCall('chat');                   // 0.008
  assert.equal(m.isOverDailyBudget(), false, '0.008 < 0.01');
  m.recordAiCall('chat');                   // 0.012
  assert.equal(m.isOverDailyBudget(), true, '0.012 >= 0.01 → 熔断');
  assert.ok(m.spentTodayUsd() >= 0.01, 'spentTodayUsd 反映累计');
}

// 3) 未知路由走默认单价(0.005),仍计入熔断。
{
  ENV.NESIO_DAILY_AI_BUDGET_USD = '0.01';
  const m = load();
  m.recordAiCall('totally_unknown_route');  // 0.005
  m.recordAiCall('totally_unknown_route');  // 0.010
  assert.equal(m.isOverDailyBudget(), true, '未知路由默认单价累计也会熔断');
}

console.log('ai-budget: OK');
