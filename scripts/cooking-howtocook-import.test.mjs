/**
 * 行为契约:HowToCook 导入解析器(scripts/import-howtocook.mjs)+ 并入后的语料形状。
 * 不变式 —— 标题去「的做法」、+/-/* 三种列表符都认、难度星数/卡路里抽取、
 * 工具词不进 ingredients(否则匹配管线「缺烤箱」)、份量行 item/amount/unit 三元、
 * 区间取下界、「适量」跳过;recipes.json 双语料并存且 howtocook 行有家庭份量。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseDish, parseQuantityLine, parseTip, stripAnnotation, deriveTools, deriveMethods, CATEGORY_MAP, TOOL_RE } from './import-howtocook.mjs';

// ── 解析器:官方 template 结构的 fixture(混用 + 与 - 列表符,含工具/注解/区间) ──
const FIXTURE = `# 测试炒肉的做法

香辣下饭。

预估烹饪难度：★★★

预估卡路里：620 大卡

## 必备原料和工具

+ 五花肉（推荐带皮）
- 小米辣
* 烤箱
+ 打蛋器或筷子

## 计算

每份：

+ 五花肉 200g
- 盐 1-2g
+ 小米椒 20 个，根据个人口味加减
+ 生抽 适量

## 操作

1. 五花肉切片。
2. 下锅翻炒。
`;

const dish = parseDish(FIXTURE, '荤菜');
assert.ok(dish, 'fixture 可解析');
assert.equal(dish.name, '测试炒肉', '标题去「的做法」');
assert.equal(dish.category, '荤菜');
assert.equal(dish.difficulty, 3, '难度=星数');
assert.equal(dish.calories, 620, '卡路里抽取');
assert.equal(dish.source, 'howtocook', '语料来源标注');
assert.deepEqual(dish.ingredients, ['五花肉', '小米辣'], '注解剥离 + 工具(烤箱/打蛋器)不进 ingredients');
assert.equal(dish.ingredients_raw.length, 4, '原文含工具,供展示');
assert.equal(dish.steps.length, 2, '操作步骤数');
assert.deepEqual(dish.quantities, [
  { amount: 200, unit: 'g', item: '五花肉' },
  { amount: 1, unit: 'g', item: '盐' },
  { amount: 20, unit: '个', item: '小米椒' },
], '份量:区间取下界、尾注剥离、「适量」跳过');

// ── 份量行边界 ──
assert.equal(parseQuantityLine('每份：'), null, '无数字行跳过');
assert.deepEqual(parseQuantityLine('- 姜蒜 50g'), { amount: 50, unit: 'g', item: '姜蒜' });
assert.deepEqual(parseQuantityLine('- 生抽 10ml'), { amount: 10, unit: 'ml', item: '生抽' });
assert.equal(stripAnnotation('虾滑馄饨（老乡鸡中央厨房）'), '虾滑馄饨');
assert.ok(TOOL_RE.test('平底锅') && TOOL_RE.test('烤箱') && !TOOL_RE.test('锅肉'), '工具词判定:锅结尾/烤箱是工具,「锅肉」不是');

// ── 结构不完整 → null(不静默产出残缺行) ──
assert.equal(parseDish('# 空菜的做法\n\n## 操作\n\n1. 无原料。\n', '荤菜'), null, '缺原料节返回 null');

// ── 分类映射覆盖 dishes/ 全部非 template 目录 ──
assert.equal(Object.keys(CATEGORY_MAP).length, 10, '10 个分类目录(template 除外)');

// ── 器具/技法推导:确定性文本扫描 ──
assert.deepEqual(deriveTools('放入电饭锅,按下煮饭键;取出后用平底锅略煎'), ['电饭煲', '平底锅'], '器具规范名(电饭锅→电饭煲)');
assert.deepEqual(deriveTools('大火翻炒出锅'), [], '通用「锅」不算器具');
assert.ok(deriveMethods('先炒香再转小火炖 40 分钟', '炒菜').includes('炒') && deriveMethods('先炒香再转小火炖 40 分钟', '炒菜').includes('炖'), '分类先验 + 文本扫描并集');
assert.deepEqual(deriveMethods('放着不动', '凉拌'), ['凉拌'], '分类先验单独成立');

// ── tips 技法文解析 ──
const tip = parseTip('# 炒/煎\n\n![img](./x.jpg)\n\n## 器具\n\n* 可用普通炒锅\n', '技法');
assert.equal(tip.title, '炒/煎', 'tips 标题');
assert.equal(tip.group, '技法');
assert.ok(tip.content.includes('可用普通炒锅') && !tip.content.includes('!['), '内容保留正文、去图片');
assert.equal(parseTip('# 只有标题\n', '基础'), null, '无正文返回 null');

// ── 并入后的语料形状(public/data/cooking/recipes.json) ──
const corpus = JSON.parse(fs.readFileSync(new URL('../public/data/cooking/recipes.json', import.meta.url), 'utf8'));
assert.ok(Array.isArray(corpus.sources) && corpus.sources.some((s) => s.id === 'howtocook') && corpus.sources.some((s) => s.id === 'cooklikehoc'), '双语料来源登记(含许可)');
assert.equal(corpus.count, corpus.recipes.length, 'count 与实际一致');
const htc = corpus.recipes.filter((r) => r.source === 'howtocook');
const hoc = corpus.recipes.filter((r) => r.source === 'cooklikehoc');
assert.ok(htc.length >= 300, `howtocook 语料在库(${htc.length})`);
assert.ok(hoc.length >= 300, `老乡鸡语料保留(${hoc.length})`);
for (const r of corpus.recipes) {
  assert.ok(r.name && r.category && Array.isArray(r.ingredients) && Array.isArray(r.steps), `行结构完整:${r.name}`);
}
assert.ok(htc.filter((r) => r.quantities.length > 0).length / htc.length > 0.8, 'howtocook 八成以上带家庭份量');
assert.ok(htc.some((r) => r.image && r.image.startsWith('htc-')), '封面图带 htc- 前缀防撞名');
for (const r of corpus.recipes) {
  assert.ok(Array.isArray(r.tools) && Array.isArray(r.methods), `器具/技法维度齐:${r.name}`);
}
assert.ok(corpus.recipes.some((r) => r.tools.includes('电饭煲')), '器具筛选有货:电饭煲');
assert.ok(corpus.recipes.some((r) => r.tools.includes('烤箱')), '器具筛选有货:烤箱');

// ── tips.json 语料形状 ──
const tipsCorpus = JSON.parse(fs.readFileSync(new URL('../public/data/cooking/tips.json', import.meta.url), 'utf8'));
assert.ok(tipsCorpus.sources?.some((s) => s.id === 'howtocook'), 'tips 来源登记(含许可)');
assert.equal(tipsCorpus.count, tipsCorpus.tips.length, 'tips count 与实际一致');
assert.ok(tipsCorpus.tips.length >= 15, `tips 语料在库(${tipsCorpus.tips.length})`);
for (const x of tipsCorpus.tips) {
  assert.ok(x.id && x.title && x.content && ['基础', '技法', '进阶'].includes(x.group), `tips 行结构完整:${x.id}`);
}

console.log('✅ cooking-howtocook-import contract passed');
