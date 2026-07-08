/**
 * 行为契约:N-0 Notion 逐行导入清理(pruneNotionNodes)。
 * 锁死:只清 Notion 连接器写入的节点(attributes.source==='Notion' / notionPageId / database),
 * 绝不误删「微信读书」手动粘贴导入(source:'manual',无这些痕迹)与其它手动记忆;
 * 清除会广播 nesio-life-node-deleted(本地事实库据此清 Signal)。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const lsMap = new Map();
const events = [];
const shared = {
  window: {
    dispatchEvent: (e) => { events.push(e); return true; },
    addEventListener: () => {},
  },
  localStorage: {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  },
  CustomEvent: class { constructor(n, o) { this.name = n; this.type = n; this.detail = o?.detail; } },
  console, setTimeout, clearTimeout, Date, JSON, Math, crypto: { randomUUID: () => `id_${Math.random().toString(36).slice(2)}` },
};
shared.window.localStorage = shared.localStorage;
shared.globalThis = shared;

function load(rel, requireImpl = () => ({})) {
  const js = ts.transpileModule(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { ...shared, module: { exports: {} }, exports: {}, require: requireImpl };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return ctx.module.exports;
}

const mocks = (p) => (p === './storage-health' ? { checkStorageWarning: () => {}, reportStorageDropped: () => {} } : ({}));
const lg = load('../lib/portal/life-graph.ts', mocks);

// ── 造一批混合节点 ──
// (a) Notion 连接器:attributes.source==='Notion' + notionPageId + database（日期垃圾卡的典型形状）
lg.addLifeNode({ name: '2026年07月03日', type: 'event', source: 'manual', confidence: 0.8, tags: ['Notion', '日'], attributes: { source: 'Notion', database: '日', notionPageId: 'pg-1' }, relations: [] });
// (b) Notion 连接器:只有 database 痕迹
lg.addLifeNode({ name: '设置', type: 'preference', source: 'manual', confidence: 0.8, tags: ['Notion', '设置'], attributes: { database: '设置' }, relations: [] });
// (c) 微信读书手动粘贴:source:'manual',带 book/tag，但没有 Notion 连接器痕迹 —— 必须保留
lg.addLifeNode({ name: '将火比作个体在无意识中释放', type: 'preference', source: 'manual', confidence: 0.9, tags: ['微信读书', '不原谅也没关系'], attributes: { book: '不原谅也没关系', author: '皮特·沃克' }, relations: [] });
// (d) 普通手动记忆 —— 必须保留
lg.addLifeNode({ name: '买牛奶', type: 'commitment', source: 'manual', confidence: 1, tags: [], attributes: {}, relations: [] });

assert.equal(lg.getLifeGraph().length, 4, '前置:4 条');

// ── 谓词直测 ──
const byName = (nm) => lg.getLifeGraph().find((n) => n.name === nm);
// 谓词需能在清理前判断，用 attributes 快照直接构造判定对象
assert.equal(lg.isNotionImportedNode({ attributes: { source: 'Notion' } }), true, 'source=Notion 命中');
assert.equal(lg.isNotionImportedNode({ attributes: { notionPageId: 'x' } }), true, 'notionPageId 命中');
assert.equal(lg.isNotionImportedNode({ attributes: { database: '日' } }), true, 'database 命中');
assert.equal(lg.isNotionImportedNode({ attributes: { book: '不原谅也没关系' } }), false, '微信读书 book 不命中');
assert.equal(lg.isNotionImportedNode({ attributes: {} }), false, '空属性不命中');

// ── 执行清理 ──
events.length = 0;
const removed = lg.pruneNotionNodes();
assert.equal(removed, 2, '清除 2 条 Notion 连接器节点');

const left = lg.getLifeGraph();
assert.equal(left.length, 2, '剩 2 条');
assert.ok(left.some((n) => n.name === '将火比作个体在无意识中释放'), '微信读书导入必须保留');
assert.ok(left.some((n) => n.name === '买牛奶'), '普通手动记忆必须保留');
assert.ok(!left.some((n) => n.attributes.source === 'Notion' || n.attributes.database), 'Notion 痕迹全清');

// ── 广播删除意图(供事实库清 Signal)──
const del = events.find((e) => e.name === 'nesio-life-node-deleted');
assert.ok(del, '必须广播 nesio-life-node-deleted');
assert.equal(del.detail.nodes.length, 2, '删除事件带上被清的 2 条');

// ── 幂等:再清一次返回 0，不再广播 ──
events.length = 0;
assert.equal(lg.pruneNotionNodes(), 0, '无 Notion 节点时返回 0');
assert.ok(!events.some((e) => e.name === 'nesio-life-node-deleted'), '无删除时不广播');

console.log('notion-prune tests passed');
