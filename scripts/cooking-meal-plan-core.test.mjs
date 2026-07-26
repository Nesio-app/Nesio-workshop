/**
 * 行为契约:做饭计划(周)纯排菜核心(lib/cooking/meal-plan-core.ts)。
 * 不变式 —— 防过期优先、能做优先、一周不排重、排不满标外食、缺料汇总去重。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/cooking/meal-plan-core.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Set, Array, Number, Object });
  return mod.exports;
}
const M = load();

function mk(name, have, missing, canCook, score) {
  return { recipe: { name }, have, missing, staples: [], score, canCook };
}

// 防过期(have 命中 soonNames)优先排到最前一天。
{
  const soon = new Set(['菠菜']);
  const matches = [
    mk('番茄炒蛋', ['番茄'], [], true, 1),
    mk('菠菜牛奶焗饭', ['菠菜'], [], true, 1),   // 用到快过期的菠菜
  ];
  const plan = M.planWeek(matches, ['周一', '周二'], soon);
  assert.equal(plan.days[0].dishName, '菠菜牛奶焗饭', '防过期项排最前');
  assert.equal(plan.days[0].reason, '防过期先用');
}

// 能做优先于需采购;需采购的缺料进 missingAll(去重)。
{
  const matches = [
    mk('宫保鸡丁', ['鸡腿肉'], ['花生', '干辣椒'], false, 0.5),
    mk('番茄炒蛋', ['番茄', '鸡蛋'], [], true, 1),
  ];
  const plan = M.planWeek(matches, ['周一', '周二'], new Set());
  assert.equal(plan.days[0].dishName, '番茄炒蛋', '能做优先');
  assert.equal(plan.days[0].status, '库存够');
  assert.equal(plan.days[1].status, '需采购');
  assert.deepEqual([...plan.missingAll].sort(), ['干辣椒', '花生'], '缺料汇总');
}

// 排不满 → 外食;一周不排重。
{
  const matches = [mk('番茄炒蛋', ['番茄'], [], true, 1)];
  const plan = M.planWeek(matches, ['周一', '周二', '周三'], new Set());
  assert.equal(plan.days[0].dishName, '番茄炒蛋');
  assert.equal(plan.days[1].dishName, null, '排不满标外食');
  assert.equal(plan.days[1].status, '餐厅');
  assert.equal(plan.days[2].dishName, null, '不排重(同一道不再排)');
}

console.log('cooking-meal-plan-core: OK');
