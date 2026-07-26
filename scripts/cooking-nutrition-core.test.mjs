/**
 * 行为契约:营养纯核心(lib/cooking/nutrition-core.ts)。
 * 不变式 —— —/Tr/空→0、parseFloat、去括号取 base、用量加法(克/100 × 每100g)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/cooking/nutrition-core.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Number, String, Math, RegExp, parseFloat });
  return mod.exports;
}
const M = load();

// ── parseNutriValue:—/Tr/空/非数 → 0 ──
assert.equal(M.parseNutriValue('—'), 0, '— → 0');
assert.equal(M.parseNutriValue('Tr'), 0, 'Tr → 0');
assert.equal(M.parseNutriValue(''), 0, '空 → 0');
assert.equal(M.parseNutriValue(null), 0, 'null → 0');
assert.equal(M.parseNutriValue('乱'), 0, '非数 → 0');
assert.equal(M.parseNutriValue('332'), 332, '数字字符串');
assert.equal(M.parseNutriValue('8.0'), 8, '小数');

// ── stripFoodName:去括号/别名/空格 ──
assert.equal(M.stripFoodName('鸡蛋（代表值）'), '鸡蛋');
assert.equal(M.stripFoodName('番茄 [西红柿]'), '番茄');
assert.equal(M.stripFoodName('菠菜（鲜）[赤根菜]'), '菠菜');
assert.equal(M.stripFoodName('猪肉（代表值，fat 30g）'), '猪肉');

// ── sumNutrition:克/100 × 每100g,四舍一位 ──
const egg = { energyKCal: 139, protein: 13.1, fat: 8.6, cho: 2.4 };   // 每100g
const spinach = { energyKCal: 24, protein: 2.6, fat: 0.3, cho: 4.5 };
const t = M.sumNutrition([{ grams: 50, per100g: egg }, { grams: 200, per100g: spinach }]);
// 50g蛋 = 半份 egg;200g菠菜 = 2份 spinach
assert.equal(t.energyKCal, Math.round((139 * 0.5 + 24 * 2) * 10) / 10, '能量加总');
assert.equal(t.protein, Math.round((13.1 * 0.5 + 2.6 * 2) * 10) / 10, '蛋白加总');
assert.equal(M.sumNutrition([]).energyKCal, 0, '空 → 0');
// 缺项当 0
assert.equal(M.sumNutrition([{ grams: 100, per100g: { energyKCal: 50 } }]).protein, 0, '缺蛋白字段当 0');

console.log('cooking-nutrition-core: OK');
