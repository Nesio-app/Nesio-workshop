/**
 * 行为契约:正向菜谱匹配纯核心(lib/cooking/recipe-match.ts)。
 * 不变式 —— 有/缺/常备三分、常备不计缺、命中率、canCook、去重、排序(能做>命中率>缺得少)、onlyWithPantry 过滤。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/cooking/recipe-match.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Set, Array, Number, Object });
  return mod.exports;
}
const M = load();

// 桩归一化器:盐/油/水 = 常备;其余原样、matched。
const STAPLE = new Set(['盐', '油', '水']);
const norm = (raw) => ({ name: raw, isStaple: STAPLE.has(raw), matched: true });

// ── 单菜:有/缺/常备三分 ──
let m = M.matchRecipe({ ingredients: ['猪肉', '土豆', '盐', '油'] }, new Set(['猪肉']), norm);
assert.equal(m.have.join(','), '猪肉', 'have=库存有的非常备');
assert.equal(m.missing.join(','), '土豆', 'missing=缺的非常备');
assert.equal(m.staples.sort().join(','), '油,盐', '常备单列');
assert.equal(m.score, 0.5, 'score=have/(have+missing)=1/2');
assert.equal(m.canCook, false, '有缺 → 不能做');

// 全有(除常备)→ 能做
m = M.matchRecipe({ ingredients: ['猪肉', '盐'] }, new Set(['猪肉']), norm);
assert.equal(m.canCook, true, '非常备料齐 → 能做');
assert.equal(m.score, 1);

// 全常备 → score 1、能做
m = M.matchRecipe({ ingredients: ['盐', '油', '水'] }, new Set(), norm);
assert.equal(m.canCook, true); assert.equal(m.score, 1); assert.equal(m.have.length, 0);

// 去重:重复配料只算一次
m = M.matchRecipe({ ingredients: ['猪肉', '猪肉', '土豆'] }, new Set(['猪肉']), norm);
assert.equal(m.have.length, 1, '重复 have 去重');
assert.equal(m.missing.length, 1);

// ── 全库排序 + onlyWithPantry ──
const recipes = [
  { id: 'A', ingredients: ['猪肉', '土豆'] },       // have1 miss1 score .5
  { id: 'B', ingredients: ['猪肉', '盐'] },          // canCook
  { id: 'C', ingredients: ['牛肉', '虾'] },          // have0(过滤掉 if onlyWithPantry)
  { id: 'D', ingredients: ['猪肉', '土豆', '番茄'] }, // have1 miss2 score .33
];
const pantry = new Set(['猪肉']);
const ranked = M.matchRecipes(recipes, pantry, norm, { onlyWithPantry: true });
assert.equal(ranked.map((r) => r.recipe.id).join(','), 'B,A,D', '能做(B)>命中率(A .5 > D .33);C 无库存料被过滤');
assert.ok(!ranked.some((r) => r.recipe.id === 'C'), 'onlyWithPantry 过滤全缺的 C');

// 不过滤时 C 也在(排最后)
const all = M.matchRecipes(recipes, pantry, norm);
assert.equal(all.length, 4, '不过滤:全部保留');
assert.equal(all[all.length - 1].recipe.id, 'C', 'C(全缺)排最后');

console.log('cooking-recipe-match: OK');
