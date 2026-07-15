/**
 * 行为契约:学习态跨端银行(批次199 P2 · 把「被纠偏的 ranker + 学到的偏好」存进账号级云)。
 *
 * 核心(行为验证,非只 grep):importRankerTrainLog 是**无损 union**——
 *  - 合并别端样本 → 计数增加(两端学习都不丢);
 *  - 重复 import 同一份 → 幂等,计数不变(不回退);
 *  - import 子集 → 绝不减少已学样本(反回归)。
 * 这条正确性是 P2 的命门:若用「权重 last-write-wins」,陈旧设备会把别端更多的学习覆盖掉。
 *
 * 再加源码契约:sync 模块走 assets(purpose=learning)+ profile_settings.learningRef 两跳、
 * 偏好非覆盖 seed、不查付费门(P3);profile-settings 路由 allowlist 放行 learningRef。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ── 行为:载入真实 guidance-ranker,stub 掉重依赖,实测 union ──
function loadRanker() {
  const src = read('../lib/platform/guidance-engine/guidance-ranker.ts');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  let blob = [];
  const require = (id) => {
    const s = String(id);
    if (s.includes('idb-blob-store')) {
      return { createBlobStore: () => ({ load: () => blob, save: (v) => { blob = v; } }) };
    }
    if (s.includes('mirror-profile')) return { learnFromFeedback: () => {} };
    if (s.includes('personalization')) return { onFeedback: () => () => {} };
    if (s.includes('storage-health')) return { reportStorageDropped: () => {} };
    return {};
  };
  const lsMap = new Map();
  const localStorage = {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
  };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require,
    window: {}, localStorage, console, Date, JSON, Math, Object, Array, Map, String, Number, isFinite,
  });
  return mod.exports;
}

const ranker = loadRanker();
const ex = (i, y) => ({ f: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], type: 't', y, at: `2026-07-15T00:00:${String(i).padStart(2, '0')}.000Z` });
const A = [ex(1, 1), ex(2, 0)];
const B = [ex(3, 1), ex(4, 0)];

assert.equal(ranker.rankerTrainCount(), 0, '起始空');
let r = ranker.importRankerTrainLog(A);
assert.equal(r.merged, 2, 'import A:合入 2 条');
assert.equal(ranker.rankerTrainCount(), 2, '计数=2');

r = ranker.importRankerTrainLog(B);
assert.equal(r.merged, 2, 'import B:再合 2 条(别端学习不丢)');
assert.equal(ranker.rankerTrainCount(), 4, '计数=4(union)');

r = ranker.importRankerTrainLog(A);
assert.equal(r.merged, 0, '重复 import A:幂等,0 新增');
assert.equal(ranker.rankerTrainCount(), 4, '计数仍 4(不回退)');

r = ranker.importRankerTrainLog([ex(1, 1)]);
assert.equal(r.merged, 0, 'import 子集:反回归,不减少');
assert.equal(ranker.rankerTrainCount(), 4, '已学样本绝不被更少的一侧覆盖');

// ── 源码契约:sync 两跳 + P3 免费 + 非覆盖偏好 ──
const sync = read('../lib/portal/cloud-learning-sync.ts');
assert.match(sync, /purpose'?,\s*'learning'|append\('purpose', 'learning'\)/, '载荷进 assets purpose=learning');
assert.match(sync, /learningRef/, '指针进 profile_settings.learningRef');
assert.match(sync, /importRankerTrainLog/, '拉取走 union 合并(非覆盖)');
assert.match(sync, /restorePreferenceState/, '偏好回灌');
assert.ok(!/hasCloudEntitlement|Entitlement/.test(sync), 'P3:不查付费权益门');

const pref = read('../lib/platform/personalization/preference-store.ts');
const restoreRegion = pref.slice(pref.indexOf('export function restorePreferenceState'), pref.indexOf('export function resetPreferenceDimension'));
assert.match(restoreRegion, /overwrite:\s*false/, '偏好回灌非覆盖(不盖本地已学)');

const route = read('../app/api/cloud/profile-settings/route.ts');
const allowlist = route.slice(route.indexOf('const stringSettingsKeys'), route.indexOf('] as const', route.indexOf('const stringSettingsKeys')));
assert.match(allowlist, /'learningRef'/, 'profile-settings allowlist 放行 learningRef');

console.log('cloud-learning-sync: OK');
