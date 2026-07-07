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

// 真反馈总线 + 真 ranker(共享同一 window/localStorage);训练日志用内存 blob 桩(同步缓存语义)
const busMod = run(transpile('../lib/platform/personalization/feedback-bus.ts'), () => ({}));
const mirrorCalls = [];
const fakeBlob = (() => { let cache = null; return { load: () => cache, save: (v) => { cache = v; }, ready: async () => {} }; })();
const rankerMod = run(transpile('../lib/platform/guidance-engine/guidance-ranker.ts'), (p) =>
  p === '@/lib/platform/personalization' ? busMod
    : p === '@/lib/portal/idb-blob-store' ? { createBlobStore: () => fakeBlob }
    : p === '@/lib/portal/storage-health' ? { reportStorageDropped() {} }
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

// ── 2b:回放重训(权重=训练日志的可回放投影)──
// 4. 学习同时把 (特征,标签) 落进训练日志
assert.equal(fakeBlob.load().length, 1, '训练样本落日志(不再折进即弃)');
assert.equal(fakeBlob.load()[0].y, 1, 'useful → 标签 1');
assert.equal(JSON.stringify(fakeBlob.load()[0].f), JSON.stringify([1, 1, 1, 1, 1, 0, 0]), '特征原样保留(可审计)');

// 5. 再学一条负样本,记下权重;抹掉 localStorage 权重态 → load 自愈,权重逐位一致
rankerMod.recordShownFeatures('card2', { risk: 0.2, time: 0.9, prep: 0.1, confidence: 0.8, relevance: 0.5, hourFit: 0, domainFit: 0 }, 'finance');
busMod.emitFeedback({ surface: 'today', dimension: 'card', key: 'card2', reaction: 'too_much', at: '2026-01-01T00:00:02.000Z' });
const before = rankerMod.getRankerStats();
assert.equal(before.n, 2, '两条样本已学');
lsMap.delete('nesio-guidance-ranker-v1'); // 模拟 localStorage 蒸发/换机
const healed = rankerMod.getRankerStats(); // load() 触发自愈回放
assert.equal(healed.n, 2, '自愈:从日志回放重建(n 恢复)');
assert.equal(JSON.stringify(healed.weights), JSON.stringify(before.weights), '自愈权重与蒸发前逐位一致(SGD 确定性)');
assert.equal(healed.bias, before.bias, 'bias 一致');

// 6. 显式重训入口
const res = rankerMod.retrainRankerFromLog();
assert.equal(res.replayed, 2, 'retrainRankerFromLog 回放 2 条');
assert.equal(JSON.stringify(rankerMod.getRankerStats().weights), JSON.stringify(before.weights), '显式重训同样逐位一致');

// ── 2b③:情境分化测量仪(证据门,不是模型)──
{
  const wd = (i) => `2026-06-0${(i % 5) + 1}T10:00:00.000Z`; // 6/1(周一)~6/5(周五)
  const we = (i) => (i % 2 === 0 ? '2026-06-06T10:00:00.000Z' : '2026-06-07T10:00:00.000Z'); // 周六/日
  const f7 = [1, 1, 1, 1, 1, 0, 0];
  const log = [];
  // health:工作日 6 条全采纳,周末 6 条全拒 → 分化成立
  for (let i = 0; i < 6; i++) log.push({ f: f7, type: 'health', y: 1, at: wd(i) });
  for (let i = 0; i < 6; i++) log.push({ f: f7, type: 'health', y: 0, at: we(i) });
  // finance:两桶都 6 条、采纳率一样 → 不分化
  for (let i = 0; i < 6; i++) log.push({ f: f7, type: 'finance', y: i % 2, at: wd(i) });
  for (let i = 0; i < 6; i++) log.push({ f: f7, type: 'finance', y: i % 2, at: we(i) });
  // travel:周末只 2 条 → 证据不够,不敢下结论
  for (let i = 0; i < 6; i++) log.push({ f: f7, type: 'travel', y: 1, at: wd(i) });
  for (let i = 0; i < 2; i++) log.push({ f: f7, type: 'travel', y: 0, at: we(i) });

  const ev = rankerMod.rankerContextEvidence(log);
  const by = (t) => ev.find((x) => x.type === t);
  assert.equal(by('health').diverges, true, '证据够 + 采纳率差大 → 分化成立(灯亮)');
  assert.equal(by('finance').diverges, false, '两桶一致 → 不分化');
  assert.equal(by('travel').ready, false, '周末样本不足 → 不敢下结论');
  assert.equal(by('travel').diverges, false, '证据不够绝不亮灯');
  assert.equal(rankerMod.rankerContextEvidence([]).length, 0, '空日志返回空');
}

console.log('guidance-ranker: OK');
