/**
 * 行为契约:mirror → 规范 Preference 收编(2a续①)。
 * 加载**真** mirror-profile.ts + 真 preference-store.ts(共享假 window/localStorage),锁死:
 *   单一真源(getDomainWeight ≡ getWeight('domain',·));旧 blob 迁移只补缺;
 *   原更新律逐字保留(useful→1 / wrong→0.2 留底 / too_much 更快 / not_now 不动领域只动时段);
 *   reset 连 Preference 一起清(不然是假重置)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const lsMap = new Map();
const shared = {
  console, Date, Math, JSON, Object, Array,
  window: { dispatchEvent: () => {} },
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  localStorage: {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  },
  fetch: async () => ({ ok: false }), // mirror 的云同步走不通即可(best-effort 静默)
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
const bus = load('../lib/platform/personalization/feedback-bus.ts', () => ({}));
const pref = load('../lib/platform/personalization/preference-store.ts', (p) =>
  p === './persist' ? persist : p === './feedback-bus' ? bus : ({}));

// 旧 blob 预置:模拟老用户已有 domainWeights(迁移用例)
lsMap.set('nesio-mirror-profile-v1', JSON.stringify({
  domainWeights: { finance: 0.9 },
  hourEngagement: Array(24).fill(0.5),
  feedbackCount: 7,
  interruptionStyle: 'proactive',
  updatedAt: '2026-01-01T00:00:00Z',
}));

const mirror = load('../lib/portal/mirror-profile.ts', (p) =>
  p === '@/lib/platform/personalization' ? pref : (idbMocks(p) ?? ({})));

// 1. 旧 blob 迁移:首次读把 domainWeights 灌进 Preference(真源)
assert.equal(mirror.getDomainWeight('finance'), 0.9, '旧 blob 权重经迁移可读');
assert.equal(pref.getWeight('domain', 'finance'), 0.9, '迁移后 Preference 里有同值(单一真源)');

// 2. 单一真源 + 原更新律:useful → 1 方向,mirror 视图 ≡ Preference 视图
mirror.learnFromFeedback('health', 'useful');
const wHealth = pref.getWeight('domain', 'health');
assert.ok(wHealth > 0.5, 'useful 拉高');
assert.equal(mirror.getDomainWeight('health'), wHealth, 'getDomainWeight ≡ getWeight(domain)(无二源)');
assert.ok(Math.abs(wHealth - (0.5 + 0.15 * 0.5)) < 1e-9, '更新律逐字保留:0.5 + 0.15×(1−0.5)');

// 3. wrong 留底 0.2、too_much 更快、not_now 不动领域
mirror.learnFromFeedback('health', 'wrong');
const afterWrong = pref.getWeight('domain', 'health');
assert.ok(Math.abs(afterWrong - (wHealth + 0.15 * (0.2 - wHealth))) < 1e-9, 'wrong → toward 0.2(留底)');
const before = pref.getWeight('domain', 'finance');
mirror.learnFromFeedback('finance', 'not_now');
assert.equal(pref.getWeight('domain', 'finance'), before, 'not_now 不罚领域(只动时段)');
mirror.learnFromFeedback('finance', 'too_much');
assert.ok(Math.abs(pref.getWeight('domain', 'finance') - (before + 0.21 * (0 - before))) < 1e-9, 'too_much → 0,α×1.4');

// 4. blob 副本携带最新权重(云往返不丢)—— 存储完整性批后副本在 IDB blob
const blob = blobMap.get('nesio-mirror-profile-v1');
assert.equal(blob.domainWeights.health, afterWrong, '保存的 blob 副本 = Preference 最新值');

// 5. reset 连 Preference 一起清
mirror.resetMirrorProfile();
assert.equal(mirror.getDomainWeight('health'), 0.5, 'reset 后回中性');
assert.equal(pref.getWeight('domain', 'finance'), 0.5, 'Preference 的 domain 维度也被清(真重置)');

console.log('mirror-preference: OK');
