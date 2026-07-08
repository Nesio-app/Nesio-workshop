/**
 * 行为契约:N-4 阅读域(reading-domain)。
 * 锁死:从 life-graph 抽「书」(Notion 折叠 + 微信读书手动导入)、汇总(在读本数/划线总数)、
 * 折叠划线计数、生成 Today 洞察句(在读《X》最近划了这句,只 attention)、无书时不出洞察。
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
const rules = load('../lib/portal/domain-rules.ts');
const rd = load('../lib/portal/reading-domain.ts', (p) => (p === './domain-rules' ? rules : {}));
const { buildReadingOverview, readingFindings } = rd;

const now = new Date('2026-07-08T00:00:00Z');
// Notion 折叠出来的一本书
const notionBookNode = {
  id: 'n1', type: 'preference', name: '不原谅也没关系', createdAt: '2026-06-05T16:01:00Z',
  tags: ['Notion', '书籍', '在读'],
  attributes: {
    source: 'Notion', notionPageId: 'book1', database: '书籍', 状态: '在读', 进度: '36',
    划线: '1. 将火比作个体在无意识中释放\n2. 因为受伤不仅仅是躯体伤害', 划线_count: '2',
  },
};
// 微信读书手动导入(一条划线一节点)
const wx1 = { id: 'w1', type: 'preference', name: '人是为活着本身而活着', createdAt: '2026-06-01T00:00:00Z', rawInput: '人是为活着本身而活着', tags: ['微信读书', '活着'], attributes: { book: '活着' } };
const wx2 = { id: 'w2', type: 'preference', name: '以笑的方式哭', createdAt: '2026-06-03T00:00:00Z', rawInput: '以笑的方式哭', tags: ['微信读书', '活着'], attributes: { book: '活着' } };
// 无关节点(不该被当书)
const noise = { id: 'x', type: 'commitment', name: '买牛奶', createdAt: '2026-06-01T00:00:00Z', tags: [], attributes: {} };

// ── 概览 ──
const ov = buildReadingOverview([notionBookNode, wx1, wx2, noise]);
assert.equal(ov.books.length, 2, '抽出 2 本书(Notion + 微信读书归并)');
const book = ov.books.find((b) => b.name === '不原谅也没关系');
assert.ok(book, 'Notion 书在');
assert.equal(book.status, '在读', '状态=在读');
assert.equal(book.progress, '36', '进度=36');
assert.equal(book.highlightCount, 2, '折叠划线计数=2');
assert.equal(book.latestHighlight, '将火比作个体在无意识中释放', '最近划线=折叠列表首行(去序号)');
assert.equal(book.origin, 'notion', 'origin=notion');
const huozhe = ov.books.find((b) => b.name === '活着');
assert.equal(huozhe.highlightCount, 2, '微信读书按 book 归并 2 条');
assert.equal(huozhe.origin, 'wechat', 'origin=wechat');
assert.equal(ov.inReading, 1, '在读 1 本');
assert.equal(ov.totalHighlights, 4, '划线总数 4');

// ── Today 洞察 ──
const f = readingFindings({ nodes: [notionBookNode, wx1, wx2, noise], now });
assert.equal(f.length, 1, '出 1 条阅读洞察');
assert.equal(f[0].severity, 'attention', '只 attention(阅读是好数据,不出红)');
assert.ok(f[0].title[0].includes('不原谅也没关系'), '标题点名在读的书');
assert.ok(f[0].detail[0].includes('将火比作'), '正文带上最近划线');

// ── 无书 → 不出洞察 ──
assert.equal(buildReadingOverview([noise]).books.length, 0, '无书');
assert.equal(readingFindings({ nodes: [noise], now }).length, 0, '无书不出洞察');
assert.equal(readingFindings({ nodes: [], now }).length, 0, '空图不出洞察');

console.log('notion-reading: OK');
