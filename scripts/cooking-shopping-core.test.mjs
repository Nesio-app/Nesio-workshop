/**
 * 行为契约:购物清单纯核心(lib/cooking/shopping-core.ts)。
 * 不变式 —— 并入去重、保留已勾选态、结账拆分(买到 vs 留下)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/cooking/shopping-core.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Set, Array });
  return mod.exports;
}
const M = load();
const item = (name, checked = false) => ({ name, qty: null, checked });

// ── 并入去重 ──
let merged = M.mergeShoppingItems([item('番茄'), item('鸡蛋', true)], ['番茄', '土豆', '', '土豆']);
assert.equal(merged.map((i) => i.name).join(','), '番茄,鸡蛋,土豆', '已有的不重复加、空的跳过、新的追加');
assert.equal(merged.find((i) => i.name === '鸡蛋').checked, true, '已勾选态保留');
assert.equal(merged.find((i) => i.name === '土豆').checked, false, '新条目未勾选');

// 空清单并入
merged = M.mergeShoppingItems([], ['猪肉', '猪肉', '青菜']);
assert.equal(merged.map((i) => i.name).join(','), '猪肉,青菜', '空清单:incoming 内部也去重');

// ── 结账拆分 ──
const { bought, remaining } = M.partitionCheckout([item('番茄', true), item('土豆', false), item('鸡蛋', true)]);
assert.equal(bought.map((i) => i.name).join(','), '番茄,鸡蛋', '买到=已勾选');
assert.equal(remaining.map((i) => i.name).join(','), '土豆', '留下=未勾选');

console.log('cooking-shopping-core: OK');
