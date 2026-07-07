/**
 * 行为契约:learner 底座 —— 反馈总线(注册/扇出/隔离/注销)+ 持久化模板(fresh/save/load/revive)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/learning/learner.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

const lsMap = new Map();
const ctx = {
  module: { exports: {} }, exports: {}, console,
  window: {},
  localStorage: {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  },
};
ctx.module.exports = ctx.exports;
vm.runInNewContext(js, ctx);
const mod = ctx.module.exports;

// ── 反馈总线 ──
const got = [];
const un1 = mod.registerLearner((e) => got.push('a:' + e.verdict));
mod.registerLearner(() => { throw new Error('boom'); }); // 隔离:抛错不拖垮其余
mod.registerLearner((e) => got.push('c:' + e.verdict));

mod.emitFeedback({ verdict: 'useful', at: 'x' });
assert.equal(JSON.stringify(got), JSON.stringify(['a:useful', 'c:useful']), '扇出到所有 handler,单个抛错不影响其余');

un1();
got.length = 0;
mod.emitFeedback({ verdict: 'wrong', at: 'x' });
assert.equal(JSON.stringify(got), JSON.stringify(['c:wrong']), '注销后不再收到');

mod._resetLearners();
got.length = 0;
mod.emitFeedback({ verdict: 'useful', at: 'x' });
assert.equal(got.length, 0, '_resetLearners 清空注册');

// ── 持久化模板 ──
const store = mod.createLearnerStore({ key: 'k', fresh: () => ({ v: 0 }), revive: (r) => (r && typeof r.v === 'number' ? r : null) });
assert.equal(store.load().v, 0, '空 → fresh');
store.save({ v: 5 });
assert.equal(store.load().v, 5, 'save → load 往返');
lsMap.set('k', '{"bad":true}');
assert.equal(store.load().v, 0, 'revive 拒绝坏数据 → 退回 fresh');
lsMap.set('k', 'not json');
assert.equal(store.load().v, 0, '解析失败 → fresh');

console.log('learner: OK');
