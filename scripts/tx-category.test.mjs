/**
 * 行为契约:交易分类词汇单一真源(财务②)。
 * 锁死:自家旧词汇归一进 PFC(用户已存规则不作废);PFC 原样;未知值不吞;
 * UI 显示名中英文;未知枚举 prettify(不烂成大写下划线直出)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/tx-category.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console });
const { normalizeCategory, categoryLabel, COMMON_EXPENSE_CATEGORIES } = mod.exports;

// 归一:旧词汇 → PFC(大小写不敏感);PFC 原样;未知/空
assert.equal(normalizeCategory('Food'), 'FOOD_AND_DRINK', '旧 Food → PFC');
assert.equal(normalizeCategory('shopping'), 'GENERAL_MERCHANDISE', '小写也认');
assert.equal(normalizeCategory('Services'), 'GENERAL_SERVICES');
assert.equal(normalizeCategory('MEDICAL'), 'MEDICAL', 'PFC 原样');
assert.equal(normalizeCategory('我的自定义类'), '我的自定义类', '用户自定义不吞');
assert.equal(normalizeCategory(''), '', '空 → 空');
assert.equal(normalizeCategory('  Travel '), 'TRAVEL', '容忍空白');

// 显示名:中英文;UI 不再出现大写下划线枚举
assert.equal(categoryLabel('GENERAL_SERVICES', 'zh'), '生活服务');
assert.equal(categoryLabel('GENERAL_SERVICES', 'en'), 'Services');
assert.equal(categoryLabel('GOVERNMENT_AND_NON_PROFIT', 'zh'), '政府与公益', '截图里的直出枚举有友好名');
assert.equal(categoryLabel('Food', 'zh'), '餐饮', '旧词汇经归一后同样出友好名');
assert.equal(categoryLabel('FOOD_AND_DRINK', 'en'), 'Food & drink');

// 未知枚举 prettify 兜底(Plaid 新增枚举不烂成直出)
assert.equal(categoryLabel('SOME_NEW_ENUM', 'zh'), 'Some New Enum', '未知枚举 prettify');
assert.equal(categoryLabel('我的自定义类', 'zh'), '我的自定义类', '自定义文本原样');

// 常用支出类:全是合法 PFC 且有友好名
for (const c of COMMON_EXPENSE_CATEGORIES) {
  assert.equal(normalizeCategory(c), c, `${c} 是规范 PFC`);
  assert.notEqual(categoryLabel(c, 'zh'), c, `${c} 有中文友好名`);
}

console.log('tx-category: OK');
