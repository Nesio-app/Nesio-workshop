/**
 * 行为契约:N-3 折叠映射 foldSourcesToMemories()。
 * 锁死(微信读书):书=1条记忆、划线折进书的 attributes 列表、日历/技术列不出现、
 * 幂等(重复 fold 不新增、按 pageId 稳定)、删一条划线重投影后 count 少一条(自愈)。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';

function load(rel, requireImpl) {
  const js = ts.transpileModule(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { module: { exports: {} }, exports: {}, require: requireImpl || (() => ({})), console };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return ctx.module.exports;
}
// notion-fold 依赖 notion-classify 与 notion-map,按相对路径喂进去。
const classify = load('../lib/portal/notion-classify.ts');
// lib/portal/notion-map.ts 是 shim(re-export ./providers/notion-map),直接加载真实实现。
const map = load('../lib/portal/providers/notion-map.ts');
const fold = load('../lib/portal/notion-fold.ts', (p) =>
  p === './notion-classify' ? classify : p === './notion-map' ? map : {});
const { foldSourcesToMemories } = fold;

// ── schema ──
const sources = [
  { id: 'bk', title: '书籍', rowCount: 1, properties: [
    { name: '书名', type: 'title' },
    { name: '状态', type: 'select' },
    { name: '进度', type: 'number' },
    { name: 'BookId', type: 'number' },
    { name: '划线', type: 'relation', relationTargetId: 'lx' },
  ] },
  { id: 'lx', title: '划线', rowCount: 2, properties: [
    { name: '划线原文', type: 'title' },
    { name: 'abstract', type: 'rich_text' },
    { name: 'blockId', type: 'rich_text' },
    { name: '书籍', type: 'relation', relationTargetId: 'bk' },
  ] },
  { id: 'ri', title: '日', rowCount: 3, titleSamples: ['2026年06月06日', '2026年07月03日'], properties: [
    { name: '日期', type: 'title' },
  ] },
];

const T = (s) => ({ type: 'title', title: [{ plain_text: s }] });
const RT = (s) => ({ type: 'rich_text', rich_text: [{ plain_text: s }] });
const SEL = (s) => ({ type: 'select', select: { name: s } });
const NUM = (n) => ({ type: 'number', number: n });
const REL = (...ids) => ({ type: 'relation', relation: ids.map((id) => ({ id })) });

function rows(withH2) {
  const lx = [
    { id: 'h1', properties: { 划线原文: T('将火比作个体在无意识中释放'), abstract: RT('火是太阳在木头中释放自己'), blockId: RT('376a5a0b-442e'), 书籍: REL('book1') } },
  ];
  if (withH2) lx.push({ id: 'h2', properties: { 划线原文: T('因为受伤不仅仅是躯体伤害'), 书籍: REL('book1') } });
  return {
    bk: [{ id: 'book1', last_edited_time: '2026-06-05T16:01:00Z', properties: {
      书名: T('不原谅也没关系'), 状态: SEL('在读'), 进度: NUM(36), BookId: NUM(3300046986), 划线: REL(),
    } }],
    lx,
    ri: [{ id: 'd1', properties: { 日期: T('2026年06月06日') } }],
  };
}

// ── 折叠 ──
const mem = foldSourcesToMemories(sources, rows(true));
assert.equal(mem.length, 1, '一本书 = 一条记忆(日历表不产记忆)');
const book = mem[0];
assert.equal(book.name, '不原谅也没关系', '名字=书名');
assert.equal(book.attributes.notionPageId, 'book1', '带 notionPageId(幂等键)');
assert.equal(book.attributes.database, '书籍', 'database=书籍');
assert.equal(book.attributes['进度'], '36', '进度语义列留');
assert.ok(!('BookId' in book.attributes), 'BookId 技术ID不出现');
assert.ok(!Object.keys(book.attributes).includes('划线') === false, '有划线折叠键'); // 划线 key 存在
assert.equal(book.attributes['划线_count'], '2', '折进 2 条划线');
assert.ok(book.attributes['划线'].includes('将火比作') && book.attributes['划线'].includes('因为受伤'), '两条划线原文都在折叠列表');
assert.ok(book.attributes['划线'].includes('火是太阳在木头中释放自己'), '划线摘要带上 abstract');
assert.ok(!book.attributes['划线'].includes('376a5a0b'), 'blockId 技术列不进折叠摘要');
assert.equal(book.attributes.notionLastEdited, '2026-06-05T16:01:00Z', '带 last_edited_time(供增量高水位)');
// 无任何记忆来自日历/维度表
assert.ok(!mem.some((m) => m.attributes.database === '日'), '日历表不产记忆');

// ── 幂等:重复 fold 同输入 → 仍 1 条、pageId 稳定 ──
const again = foldSourcesToMemories(sources, rows(true));
assert.equal(again.length, 1, '重复 fold 不新增');
assert.equal(again[0].attributes.notionPageId, 'book1', 'pageId 稳定');

// ── 删除自愈:去掉 h2 → 重投影后 count 少一条 ──
const healed = foldSourcesToMemories(sources, rows(false));
assert.equal(healed[0].attributes['划线_count'], '1', '删一条划线 → 折叠列表少一条(自愈)');
assert.ok(!healed[0].attributes['划线'].includes('因为受伤'), '被删划线不再出现');

console.log('notion-fold: OK');
