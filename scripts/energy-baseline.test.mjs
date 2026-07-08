/**
 * 行为契约:energy → Baseline 原语收编(2a续②)。
 * 真 energy-state + 真 baseline-store + 真 moment-analytics 同一存储上下文,锁死:
 *   旧 blob 迁移(baseline 灌进原语、blob 只剩水位);
 *   折算轨迹与原 updateEnergyBaseline 逐字等价(先验 {50,100} 起步,断言到 1e-9);
 *   getEnergyState 语义保留(<3 样本 unknown / 今天读数偏离 ±1σ → low/high)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const lsMap = new Map();
let graphNodes = [];
const shared = {
  console, Date, Math, JSON, Object, Array, Number,
  window: {},
  localStorage: {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  },
};
function load(rel, requireImpl) {
  const js = ts.transpileModule(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { ...shared, module: { exports: {} }, exports: {}, require: requireImpl };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return ctx.module.exports;
}

// 存储完整性批:persist/学习态迁 IDB blob —— 测试桩模拟真实语义
// (创建即从假 localStorage 迁旧值,load 同步读内存缓存)。
const blobMap = new Map();
const idbStub = { createBlobStore: ({ key }) => {
  if (!blobMap.has(key)) {
    const raw = lsMap.has(key) ? lsMap.get(key) : null;
    blobMap.set(key, raw != null ? JSON.parse(raw) : null);
  }
  return {
    load: () => blobMap.get(key),
    save: (v) => { blobMap.set(key, v); },
    ready: async () => {},
  };
} };
const idbMocks = (p) => (
  p === '@/lib/portal/idb-blob-store' ? idbStub
    : p === '@/lib/portal/storage-health' ? { reportStorageDropped() {} }
    : null);
const persist = load('../lib/platform/personalization/persist.ts', (p) => idbMocks(p) ?? ({}));
const baseline = load('../lib/platform/personalization/baseline-store.ts', (p) => (p === './persist' ? persist : ({})));
const moment = load('../lib/portal/moment-analytics.ts', () => ({}));
const energy = load('../lib/platform/energy-state.ts', (p) =>
  p === '@/lib/portal/life-graph' ? { getLifeGraph: () => graphNodes }
    : p === '@/lib/portal/moment-analytics' ? moment
    : p === '@/lib/platform/personalization' ? baseline : ({}));

const momentNode = (value, at) => ({ attributes: { energyValue: value }, tags: ['moment'], createdAt: at });

// 1. 旧 blob 迁移:baseline 灌原语、blob 只剩水位
lsMap.set('nesio-energy-baseline-v1', JSON.stringify({
  baseline: { mean: 62, variance: 25, sampleCount: 5 },
  lastFoldedAt: '2026-01-05T00:00:00.000Z',
}));
let st = energy.refreshEnergyBaseline();
assert.equal(st.baseline.mean, 62, '旧 blob 的 mean 迁进原语可读');
assert.equal(st.baseline.sampleCount, 5, 'sampleCount 保留');
assert.equal(baseline.ewmaState('energy').mean, 62, '原语里有同值(单一真源)');
assert.equal(JSON.parse(lsMap.get('nesio-energy-baseline-v1')).baseline, undefined, '旧 blob 迁移后只剩水位');

// 2. 折算轨迹逐字等价:新路径折 4 个读数 == 直接用 updateEnergyBaseline 递推
const readings = [55, 40, 70, 48];
readings.forEach((v, i) => graphNodes.push(momentNode(v, `2026-01-0${6 + i}T08:00:00.000Z`)));
st = energy.refreshEnergyBaseline();
let expect = { mean: 62, variance: 25, sampleCount: 5 };
for (const v of readings) expect = moment.updateEnergyBaseline(expect, v);
assert.ok(Math.abs(st.baseline.mean - expect.mean) < 1e-9, `mean 轨迹等价(${st.baseline.mean} vs ${expect.mean})`);
assert.ok(Math.abs(st.baseline.variance - expect.variance) < 1e-9, 'variance 轨迹等价');
assert.equal(st.baseline.sampleCount, expect.sampleCount, 'sampleCount 等价');
assert.equal(st.lastFoldedAt, '2026-01-09T08:00:00.000Z', '水位推进到最新读数');
const again = energy.refreshEnergyBaseline();
assert.ok(Math.abs(again.baseline.mean - expect.mean) < 1e-9, '重复 refresh 不重复折样(水位生效)');

// 3. getEnergyState 语义:今天明显低于基线 → low;明显高 → high
const now = new Date('2026-01-10T12:00:00.000Z');
graphNodes.push(momentNode(10, '2026-01-10T09:00:00.000Z'));
assert.equal(energy.getEnergyState(now), 'low', '今天读数低于基线 1σ → low');
graphNodes.push(momentNode(99, '2026-01-10T10:00:00.000Z'));
assert.equal(energy.getEnergyState(now), 'high', '更晚的今天读数高于基线 1σ → high');
assert.equal(energy.getEnergyState(new Date('2026-01-11T12:00:00.000Z')), 'unknown', '读数不是"今天"→ unknown');

// 4. 冷启动:无旧 blob、样本 <3 → unknown(先验在位但 sampleCount 起步 0)
lsMap.clear();
blobMap.clear(); // 存储完整性批后学习态在 blob 桩里,冷启动同样要清
graphNodes = [];
const persist2 = load('../lib/platform/personalization/persist.ts', (p) => idbMocks(p) ?? ({}));
const baseline2 = load('../lib/platform/personalization/baseline-store.ts', (p) => (p === './persist' ? persist2 : ({})));
const energy2 = load('../lib/platform/energy-state.ts', (p) =>
  p === '@/lib/portal/life-graph' ? { getLifeGraph: () => graphNodes }
    : p === '@/lib/portal/moment-analytics' ? moment
    : p === '@/lib/platform/personalization' ? baseline2 : ({}));
graphNodes.push(momentNode(45, '2026-01-10T09:00:00.000Z'));
assert.equal(energy2.getEnergyState(now), 'unknown', '冷启动(<3 样本)→ unknown');
assert.equal(baseline2.ewmaState('energy').n, 1, '先验起步、折入 1 样本');
assert.ok(Math.abs(baseline2.ewmaState('energy').mean - (0.15 * 45 + 0.85 * 50)) < 1e-9, '首样本从先验 50 折起(非直接=45)');

console.log('energy-baseline: OK');
