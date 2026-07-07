/**
 * 行为契约:商户分类建议(bank-tx suggestCategory,2b② 近似 token 匹配)。
 * 锁死:精确 token 投票(原行为不变);变体经保守模糊命中(半票、置信更低);
 * 短 token 不模糊(危险);无学习退回关键词规则;默认兜底。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel, requireImpl) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, Math, Number, Array, Date, Set, Map, Object, JSON, console });
  return mod.exports;
}
const fakeStore = () => ({ load: () => null, save: () => {}, ready: async () => {} });
const txCategory = loadTs('../lib/portal/tx-category.ts', () => ({}));
const bank = loadTs('../lib/portal/bank-tx.ts', (p) =>
  p === './storage-health' ? { reportStorageDropped() {} }
    : p === './tx-category' ? txCategory
    : p === './idb-blob-store' ? { createBlobStore: fakeStore } : ({}));

const { suggestCategory } = bank;

// 1. 精确 token 投票(原行为):Wegmans/Trader Joe's → Food,"Joe's Market" 命中 joe
{
  const rules = { 'Wegmans': 'Food', "Trader Joe's": 'Food' };
  const r = suggestCategory("Joe's Market", rules);
  assert.equal(r.category, 'FOOD_AND_DRINK', '精确 token 命中(joe),旧词汇 Food 归一成 PFC');
}

// 2. 变体模糊命中:McDonalds 纠正过 → MCDONALD'S #123(mcdonald~mcdonalds)
{
  const rules = { 'McDonalds': 'Food' };
  const r = suggestCategory("MCDONALD'S #123", rules);
  assert.equal(r.category, 'FOOD_AND_DRINK', '变体经模糊命中');
  const exact = suggestCategory('McDonalds', rules);
  assert.ok(r.confidence < exact.confidence, '模糊半票 → 置信低于精确命中');
}

// 3. 编辑距离 1:walmart ~ wallmart(插入一位)
{
  const rules = { 'Walmart': 'Shopping' };
  assert.equal(suggestCategory('WALLMART STORE', rules).category, 'GENERAL_MERCHANDISE', '编辑距离 1 命中(归一成 PFC)');
}

// 4. 短 token 不模糊:uber(4 字符以下的变体如 ubr 不匹配;不相干短词更不匹配)
{
  const rules = { 'Uber': 'Travel' };
  const r = suggestCategory('UBR TRIP', rules);
  assert.notEqual(r.category === 'TRAVEL' && r.confidence > 0.5, true, '3 字符 token 不做模糊(危险)');
}

// 5. 完全无学习 → 关键词规则/默认兜底(原行为)
{
  const none = suggestCategory('Totally Unknown Merchant XYZ', {});
  assert.equal(none.confidence <= 0.72, true, '退回规则/兜底,置信不冒充学习结果');
}

console.log('merchant-suggest: OK');
