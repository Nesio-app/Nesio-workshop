/**
 * 美食 AI 生成菜谱接线契约。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

assert.ok(fs.existsSync(path.join(root, 'app/api/portal/cooking-recipe/route.ts')));
const route = read('app/api/portal/cooking-recipe/route.ts');
assert.match(route, /guardAiRoute/);
assert.match(route, /requirePaidCloudAi:\s*true/);
assert.match(route, /clampGeneratedRecipe/);
assert.match(route, /completeText/);

const gen = read('lib/cooking/recipe-generate.ts');
assert.match(gen, /buildRecipeGeneratePrompt/);
assert.match(gen, /clampGeneratedRecipe/);
// 技法 grounding:本地 tips 语料确定性选摘进 prompt(选不中不带,不为凑数花 token)。
assert.match(gen, /pickRecipeTips/);
assert.match(gen, /techniqueNotes/);
assert.match(route, /pickRecipeTips/);
assert.match(route, /tips\.json/);

const store = read('lib/cooking/generated-recipes.ts');
assert.match(store, /nesio-generated-recipes-v1/);
assert.match(store, /saveGeneratedRecipe/);

const ui = read('components/portal/cooking/CookingSheet.tsx');
assert.match(ui, /kind: 'generate'/);
assert.match(ui, /\/api\/portal\/cooking-recipe/);
assert.match(ui, /guardPaidCloudAi\('cooking_recipe_ai'\)/);
assert.match(ui, /GenerateBody/);
assert.doesNotMatch(
  ui,
  /onClick=\{\(\) => window\.dispatchEvent\(new CustomEvent\('nesio-pro-gate', \{ detail: \{ feature: 'cooking_recipe_ai' \} \}\)\)\}/,
  '生成按钮不得只派发 pro-gate',
);

assert.match(read('docs/api-routes.md'), /cooking-recipe/);

console.log('cooking-recipe-ai-contract: OK');
