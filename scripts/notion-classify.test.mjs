/**
 * 行为契约:N-2 结构识别引擎 classifyDatabase()。
 * 锁死三种真实库都走同一纯函数管道:
 *  ① 微信读书模板:书籍=hub、笔记/划线=父子折进书、日/月/年/周=calendar-dim 丢、章节=dimension 丢、设置=丢;
 *     技术ID列(blockId/bookId/…)与 formula/rollup/relation 丢,划线原文(title)与语义列留。
 *  ② 健身流水表:单表带日期多行、无关联 → log;部位(select)/重量(number)/日期留。
 *  ③ 纯任务看板:status + due date → kanban。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';

function load(rel) {
  const js = ts.transpileModule(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { module: { exports: {} }, exports: {}, require: () => ({}), console };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return ctx.module.exports;
}
const { classifyDatabase } = load('../lib/portal/notion-classify.ts');

const rel = (target) => ({ name: target, type: 'relation', relationTargetId: target });
const byId = (res, id) => res.find((r) => r.id === id);

// ── ① 微信读书模板 ──
const reading = classifyDatabase([
  { id: '书籍', title: '书籍', rowCount: 12, properties: [
    { name: '书名', type: 'title' },
    { name: '阅读状态', type: 'status' },
    { name: '分类', type: 'multi_select' },
    { name: '作者', type: 'people' },
    { name: '链接', type: 'url' },
    { name: '阅读进度', type: 'number' },
    { name: '简介', type: 'rich_text' },
    { name: '评分', type: 'number' },
    { name: 'BookId', type: 'number' },
    { name: 'ISBN', type: 'rich_text' },
    { name: '最近划线', type: 'rollup' },
    rel('笔记'), rel('划线'), rel('日'), rel('月'), rel('年'), rel('周'), rel('章节'),
  ] },
  { id: '笔记', title: '笔记', rowCount: 200, properties: [
    { name: '原文', type: 'title' },
    { name: 'Date', type: 'date' },
    { name: 'abstract', type: 'rich_text' },
    { name: 'blockId', type: 'rich_text' },
    { name: 'bookId', type: 'number' },
    { name: 'bookVersion', type: 'number' },
    { name: 'chapterUid', type: 'number' },
    { name: 'reviewId', type: 'rich_text' },
    { name: 'style', type: 'rich_text' },
    rel('书籍'), rel('章节'), rel('日'),
  ] },
  { id: '划线', title: '划线', rowCount: 300, properties: [
    { name: '划线原文', type: 'title' },
    { name: 'abstract', type: 'rich_text' },
    { name: 'blockId', type: 'rich_text' },
    rel('书籍'),
  ] },
  { id: '日', title: '日', rowCount: 400, titleSamples: ['2026年06月06日', '2026年07月03日', '2026年06月28日'], properties: [
    { name: '日期', type: 'title' }, rel('书籍'),
  ] },
  { id: '月', title: '月', rowCount: 24, titleSamples: ['2026年6月', '2026年7月'], properties: [{ name: '月', type: 'title' }] },
  { id: '年', title: '年', rowCount: 3, titleSamples: ['2026', '2025'], properties: [{ name: '年', type: 'title' }] },
  { id: '周', title: '周', rowCount: 60, titleSamples: ['2026年第23周', '2026年第24周'], properties: [{ name: '周', type: 'title' }] },
  { id: '章节', title: '章节', rowCount: 80, properties: [{ name: '章节名', type: 'title' }, rel('书籍')] },
  { id: '设置', title: '设置', rowCount: 1, properties: [{ name: '项', type: 'title' }] },
]);

assert.equal(byId(reading, '书籍').role, 'hub-entity', '书籍=枢纽实体');
assert.equal(byId(reading, '笔记').role, 'parent-child', '笔记=父子');
assert.equal(byId(reading, '笔记').foldInto, '书籍', '笔记折进书籍');
assert.equal(byId(reading, '划线').role, 'parent-child', '划线=父子');
assert.equal(byId(reading, '划线').foldInto, '书籍', '划线折进书籍');
for (const d of ['日', '月', '年', '周']) {
  assert.equal(byId(reading, d).role, 'calendar-dim', `${d}=日历维度`);
  assert.equal(byId(reading, d).drop, true, `${d} 丢`);
}
assert.equal(byId(reading, '章节').role, 'dimension', '章节=通用维度');
assert.equal(byId(reading, '章节').drop, true, '章节丢');
assert.equal(byId(reading, '设置').role, 'dimension', '设置=维度(管道)');
assert.equal(byId(reading, '设置').drop, true, '设置丢');
assert.equal(byId(reading, '书籍').drop, false, '书籍不丢');

// 列去留:书籍
const bookCols = Object.fromEntries(byId(reading, '书籍').columns.map((c) => [c.name, c.keep]));
assert.equal(bookCols['书名'], true, '书名(title)留');
assert.equal(bookCols['阅读进度'], true, '进度(number)留');
assert.equal(bookCols['作者'], true, '作者(people)留');
assert.equal(bookCols['BookId'], false, 'BookId(技术ID)丢');
assert.equal(bookCols['最近划线'], false, 'rollup 丢');
// 关系列一律丢
assert.ok(byId(reading, '书籍').columns.filter((c) => c.type === 'relation').every((c) => !c.keep), 'relation 全丢');
// 笔记:原文留,技术ID全丢
const noteCols = Object.fromEntries(byId(reading, '笔记').columns.map((c) => [c.name, c.keep]));
assert.equal(noteCols['原文'], true, '笔记原文(title)留');
assert.equal(noteCols['abstract'], true, 'abstract 留');
for (const t of ['blockId', 'bookId', 'bookVersion', 'chapterUid', 'reviewId']) {
  assert.equal(noteCols[t], false, `${t} 技术ID丢`);
}

// ── ② 健身流水表(单表,无关联)──
const fitness = classifyDatabase([
  { id: '训练', title: '训练记录', rowCount: 200, properties: [
    { name: '动作', type: 'title' },
    { name: '部位', type: 'select' },
    { name: '重量', type: 'number' },
    { name: '组数', type: 'number' },
    { name: '日期', type: 'date' },
  ] },
]);
assert.equal(byId(fitness, '训练').role, 'log', '健身单表=流水 log');
const fitCols = Object.fromEntries(byId(fitness, '训练').columns.map((c) => [c.name, c.keep]));
assert.ok(fitCols['部位'] && fitCols['重量'] && fitCols['日期'], '健身语义列留');

// ── ③ 纯任务看板 ──
const tasks = classifyDatabase([
  { id: '任务', title: '任务', rowCount: 50, properties: [
    { name: '任务名', type: 'title' },
    { name: '状态', type: 'status' },
    { name: '截止', type: 'date' },
    { name: '优先级', type: 'select' },
  ] },
]);
assert.equal(byId(tasks, '任务').role, 'kanban', 'status+date=看板');

console.log('notion-classify: OK');
