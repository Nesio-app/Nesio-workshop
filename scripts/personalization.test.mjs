/**
 * 行为契约:Personalization 底座(可清数据精简后)。
 * 反馈总线扇出 → Signal 事实(feedback.reaction)投影为日志 + Preference 折权重;
 * Baseline 学常态。Recency 已退役(生产零调用)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const lsMap = new Map();
const shared = {
  console, Date, Math, JSON, Object, Array, Map, Set, String, Number, Boolean, RegExp,
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

// Signal 事实桩:emitFeedback → createSignal 写入;readFeedbackLog 从 getSignals 投影
const signalStore = [];
const createSignalStub = {
  createSignal: (input) => {
    const sig = {
      id: `s${signalStore.length + 1}`,
      type: input.type,
      source: input.source,
      capturedAt: input.payload?.at || new Date().toISOString(),
      payload: input.payload || {},
      epistemic: input.epistemic,
    };
    signalStore.unshift(sig);
    return sig;
  },
};
const signalStub = {
  getSignals: (opts) => signalStore.filter((s) => !opts?.types?.length || opts.types.includes(s.type)),
};

const log = load('../lib/platform/personalization/feedback-log.ts', (p) => {
  if (p.includes('feedback-bus')) return bus;
  if (p.includes('create-signal')) return createSignalStub;
  if (p.includes('life-domain/signal') || p.endsWith('/signal')) return signalStub;
  return {};
});

const pref = load('../lib/platform/personalization/preference-store.ts', (p) =>
  p === './persist' ? persist : p === './feedback-bus' ? bus : ({}));
const baseline = load('../lib/platform/personalization/baseline-store.ts', (p) => (p === './persist' ? persist : ({})));

// 1. 事实日志 = Signal 投影(today/card 富事实走 feedback.today_card,总线不再落瘦 reaction)
bus.emitFeedback({ surface: 'today', dimension: 'card', key: 'c1', reaction: 'useful', at: '2026-01-01T00:00:00Z' });
signalStore.unshift({
  type: 'feedback.today_card',
  capturedAt: '2026-01-01T00:00:00Z',
  payload: { cardId: 'c1', feedback: 'useful', surface: 'today', dimension: 'card', key: 'c1', reaction: 'useful' },
});
bus.emitFeedback({ surface: 'today', dimension: 'domain', key: 'health', reaction: 'useful', at: '2026-01-01T00:00:01Z' });
assert.equal(signalStore.length, 2, 'today_card 富事实 + domain reaction 各一条');
assert.equal(log.readFeedbackLog().length, 2, '投影日志条数=Signal');
assert.equal(log.readFeedbackLog()[0].key, 'c1', '日志按 getSignals 序(新→旧)');

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

// 4. Recency 已退役
const idx = fs.readFileSync(new URL('../lib/platform/personalization/index.ts', import.meta.url), 'utf8');
assert.doesNotMatch(idx, /recency-store/, 'index 不再导出死 Recency');

const fbLog = fs.readFileSync(new URL('../lib/platform/personalization/feedback-log.ts', import.meta.url), 'utf8');
assert.doesNotMatch(fbLog, /createBlobStore/, '不再独立 IDB 反馈日志');
assert.match(fbLog, /getSignals/, '反馈日志从 Signal 投影');

const sigFb = fs.readFileSync(new URL('../lib/life-domain/signal-feedback.ts', import.meta.url), 'utf8');
assert.doesNotMatch(sigFb, /getItem|setItem/, 'Today 反馈无平行浏览器存储读写');
assert.match(sigFb, /createSignal/, 'Today 反馈只写 Signal');

console.log('personalization: OK');
