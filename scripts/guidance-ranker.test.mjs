/**
 * 行为契约:guidance-ranker(learner 底座 pilot,端到端)。
 * 加载**真** learner.ts + guidance-ranker.ts(共享假 window/localStorage),验证:
 *   冷启动权重=先验;出卡暂存特征后、**经反馈总线** emitFeedback → ranker 学一次(证明注册+扇出通);
 *   useful 把权重推高(SGD 生效);反馈回喂 mirror;无暂存特征的卡不学。
 * mirror-profile 用桩(只验证回喂参数,不测 mirror 本身)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function transpile(rel) {
  return ts.transpileModule(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const lsMap = new Map();
const shared = {
  console, Date, Math, JSON, Object, Array,
  window: {},
  localStorage: {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  },
};

function run(js, requireImpl) {
  const ctx = { ...shared, module: { exports: {} }, exports: {}, require: requireImpl };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return ctx.module.exports;
}

// 真反馈总线 + 真 ranker(共享同一 window/localStorage)
const busMod = run(transpile('../lib/platform/personalization/feedback-bus.ts'), () => ({}));
const mirrorCalls = [];
const rankerMod = run(transpile('../lib/platform/guidance-engine/guidance-ranker.ts'), (p) =>
  p === '@/lib/platform/personalization' ? busMod
    : { learnFromFeedback: (type, fb) => mirrorCalls.push(`${type}:${fb}`) },
);

// 1. 冷启动 = 先验公式,未学习
const s0 = rankerMod.getRankerStats();
assert.equal(s0.weights.risk, 0.3, '冷启动 risk 权重 = 先验 0.30');
assert.equal(s0.weights.hourFit, 0, '新特征 hourFit 起步 0');
assert.equal(s0.n, 0, '未学习 n=0');

// 2. 出卡暂存特征 → 经反馈总线 → ranker 学一次(pilot 核心:注册 + 扇出打通)
const feats = { risk: 1, time: 1, prep: 1, confidence: 1, relevance: 1, hourFit: 0, domainFit: 0 };
rankerMod.recordShownFeatures('card1', feats, 'health');
busMod.emitFeedback({ surface: 'today', dimension: 'card', key: 'card1', reaction: 'useful', at: '2026-01-01T00:00:00.000Z' });

const s1 = rankerMod.getRankerStats();
assert.equal(s1.n, 1, '经反馈总线 → ranker 学了一次(注册+扇出通)');
assert.ok(s1.weights.risk > 0.3, 'useful 反馈把 risk 权重推高(SGD 生效)');
assert.equal(JSON.stringify(mirrorCalls), JSON.stringify(['health:useful']), '反馈同步回喂 mirror(卡类型当 domain)');

// 3. 无暂存特征的卡不学
busMod.emitFeedback({ surface: 'today', dimension: 'card', key: 'ghost', reaction: 'useful', at: '2026-01-01T00:00:01.000Z' });
assert.equal(rankerMod.getRankerStats().n, 1, '无 pending 的卡不学(n 不变)');

console.log('guidance-ranker: OK');
