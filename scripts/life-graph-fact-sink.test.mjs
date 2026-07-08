/**
 * 节点事实 sink 行为契约 —— 架构审查 #1 残留的回归锁:
 * add/update/delete 三个写入点必须喂 sink(update 旁路曾使 rebuild 丢 done/子任务)。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const lsMap = new Map();
const shared = {
  window: { dispatchEvent: () => {}, addEventListener: () => {} },
  localStorage: {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  },
  CustomEvent: class { constructor(n, o) { this.name = n; this.detail = o?.detail; } },
  fetch: async () => ({ ok: false, json: async () => ({}) }),
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

// 注册间谍 sink
const calls = [];
lg.registerNodeFactSink({
  upsert: (n) => calls.push(['upsert', n.id, n.attributes?.done ?? null]),
  remove: (n) => calls.push(['remove', n.id]),
});

// add → upsert
const node = lg.addLifeNode({ name: '测试任务', type: 'commitment', source: 'manual', confidence: 1, tags: [], attributes: {}, relations: [] });
assert.equal(calls.length, 1, 'addLifeNode 必须喂 sink');
assert.deepEqual(calls[0], ['upsert', node.id, null]);

// update → upsert(带最新属性 —— done 状态必须进事实库,这正是旁路修复的核心)
lg.updateLifeNode(node.id, { attributes: { done: true } });
assert.equal(calls.length, 2, 'updateLifeNode 必须喂 sink');
assert.deepEqual(calls[1], ['upsert', node.id, true], 'sink 收到的是更新后的节点(done=true)');

// delete → remove
lg.deleteLifeNode(node.id);
assert.equal(calls.length, 3, 'deleteLifeNode 必须喂 sink');
assert.deepEqual(calls[2], ['remove', node.id]);

// 未注册 sink 时写入不炸(sink 是增强不是依赖)
const lg2 = load('../lib/portal/life-graph.ts', mocks);
const n2 = lg2.addLifeNode({ name: 'x', type: 'commitment', source: 'manual', confidence: 1, tags: [], attributes: {}, relations: [] });
assert.ok(lg2.updateLifeNode(n2.id, { name: 'y' }), '无 sink 时 update 照常工作');

console.log('life graph fact sink tests passed');
