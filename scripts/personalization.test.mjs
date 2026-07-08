/**
 * 行为契约:Personalization 底座(A 计划 Layer 2)。
 * 反馈总线扇出 → 事实日志追加(event-sourcing)+ Preference 折权重(可复用维度才折);
 * Baseline 学常态算偏离(冷启动不敢报);Recency 时效/冷却。
 * 共享假 window/localStorage;feedback-log 的 IDB 后端用内存桩。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

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
function load(rel, requireImpl) {
  const js = ts.transpileModule(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { ...shared, module: { exports: {} }, exports: {}, require: requireImpl };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return ctx.module.exports;
}

const bus = load('../lib/platform/personalization/feedback-bus.ts', () => ({}));

// IDB 后端统一用内存桩(存储完整性批后 persist 也走 blob store),storage-health 空实现
const idbCache = { v: null };
const idbStub = { createBlobStore: () => ({ load: () => idbCache.v, save: (v) => { idbCache.v = v; }, ready: async () => {} }) };
// persist:每个 key 一个独立内存 store(与真实语义一致)
const persistStub = (() => {
  const m = new Map();
  return { createBlobStore: ({ key }) => ({
    load: () => (m.has(key) ? m.get(key) : null),
    save: (v) => { m.set(key, v); },
    ready: async () => {},
  }) };
})();
const persist = load('../lib/platform/personalization/persist.ts', (p) =>
  p === '@/lib/portal/idb-blob-store' ? persistStub
    : p === '@/lib/portal/storage-health' ? { reportStorageDropped() {} } : ({}));
const log = load('../lib/platform/personalization/feedback-log.ts', (p) =>
  p === '@/lib/portal/idb-blob-store' ? idbStub
    : p === '@/lib/portal/storage-health' ? { reportStorageDropped() {} }
    : p === './feedback-bus' ? bus : ({}));

const pref = load('../lib/platform/personalization/preference-store.ts', (p) =>
  p === './persist' ? persist : p === './feedback-bus' ? bus : ({}));
const baseline = load('../lib/platform/personalization/baseline-store.ts', (p) => (p === './persist' ? persist : ({})));
const recency = load('../lib/platform/personalization/recency-store.ts', (p) => (p === './persist' ? persist : ({})));

// 1. 事实日志:每条反馈都追加(collect first)
bus.emitFeedback({ surface: 'today', dimension: 'card', key: 'c1', reaction: 'useful', at: '2026-01-01T00:00:00Z' });
bus.emitFeedback({ surface: 'today', dimension: 'domain', key: 'health', reaction: 'useful', at: '2026-01-01T00:00:01Z' });
assert.equal(log.readFeedbackLog().length, 2, '每条反馈追加进事实日志');
assert.equal(log.readFeedbackLog()[0].key, 'c1', '日志按序保留原始反馈');

// 2. Preference:可复用维度(domain)折权重;per-card 维度不折(免无界)
assert.ok(pref.getWeight('domain', 'health') > 0.5, 'domain=useful → 权重从 0.5 拉高');
assert.equal(pref.getWeight('card', 'c1'), 0.5, 'card 维度不折权重(仍中性 0.5)');
bus.emitFeedback({ surface: 'today', dimension: 'domain', key: 'finance', reaction: 'too_much', at: '2026-01-01T00:00:02Z' });
assert.ok(pref.getWeight('domain', 'finance') < 0.5, 'domain=too_much → 权重拉低');

// 3. Baseline:冷启动不敢报;够样本后算偏离
assert.equal(baseline.zScore('energy', 5), null, '无样本 → 冷启动,zScore=null');
for (const v of [50, 52, 48, 51, 49]) baseline.foldSample('energy', v, 'robust');
const b = baseline.baseline('energy');
assert.equal(b.cold, false, '够样本不再冷启动');
assert.ok(Math.abs(b.center - 50) <= 2, 'center 落在样本中位数附近');
assert.ok(baseline.zScore('energy', 70) > 1, '明显高于常态 → z>1');

// 4. Recency:时效 + 冷却
recency.markSeen('cardX', '2026-01-01T00:00:00.000Z');
const since = recency.sinceSeen('cardX', new Date('2026-01-01T00:00:10.000Z'));
assert.equal(since, 10000, 'sinceSeen = 10s');
assert.equal(recency.sinceSeen('never'), null, '没见过 → null');
const rem = recency.cooldownRemaining('cardX', { baseMs: 60000 }, new Date('2026-01-01T00:00:10.000Z'));
assert.equal(rem, 50000, '冷却 60s、过了 10s → 剩 50s');
assert.equal(recency.cooldownRemaining('cardX', { baseMs: 5000 }, new Date('2026-01-01T00:00:10.000Z')), 0, '冷却已过 → 0');

console.log('personalization: OK');
