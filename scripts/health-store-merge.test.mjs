/**
 * health-store merge —— 再导入健康数据不得整表盖掉旧指标。
 * 按 metric.key 合并;series 同月取较新侧;latest 取日期更新的一侧。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const mem = { value: null };
const src = fs.readFileSync(new URL('../lib/portal/health-store.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, {
  module: mod, exports: mod.exports, console, JSON, Array, Object, Map, Set, Number, Math, Date, String, Boolean, RegExp,
  require: (id) => {
    if (id === './idb-blob-store') {
      return {
        createBlobStore: () => ({
          load: () => mem.value,
          save: (v) => { mem.value = v; },
        }),
      };
    }
    if (id === './storage-health') return { reportStorageDropped: () => {} };
    if (id === './apple-health') return {};
    throw new Error(`unexpected require: ${id}`);
  },
});

const { saveHealthMetrics, loadHealthMetrics, mergeHealthMetrics } = mod.exports;

function metric(key, latestDate, series, latest = 1) {
  return {
    key, label: [key, key], latest, latestDate, prev: null, unit: 'u', decimals: 0,
    group: 'activity', series,
  };
}

// 纯函数:旧有 steps 历史 + 新导入带更新的 restingHR / 同月 steps 覆盖
const existing = {
  metrics: [
    metric('steps', '2026-07-01', [{ ym: '2026-06', v: 5000 }, { ym: '2026-07', v: 6000 }], 6000),
    metric('weight', '2026-06-15', [{ ym: '2026-06', v: 70 }], 70),
  ],
  workouts: 2,
  importedAt: '2026-07-01T00:00:00.000Z',
  daily: [{ date: '2026-07-01', steps: 6000 }],
};
const incoming = {
  metrics: [
    metric('steps', '2026-08-01', [{ ym: '2026-07', v: 6500 }, { ym: '2026-08', v: 7000 }], 7000),
    metric('restingHR', '2026-08-01', [{ ym: '2026-08', v: 58 }], 58),
  ],
  workouts: 1,
  importedAt: '2026-08-02T00:00:00.000Z',
  daily: [{ date: '2026-08-01', steps: 7000 }],
};

const merged = mergeHealthMetrics(existing, incoming);
assert.equal(merged.metrics.length, 3, '并集:steps + weight + restingHR');
const steps = merged.metrics.find((m) => m.key === 'steps');
assert.ok(steps);
assert.equal(steps.latest, 7000, '较新 latest 胜');
assert.equal(steps.latestDate, '2026-08-01');
assert.equal(steps.series.length, 3, 'steps series 并集 3 个月');
assert.equal(steps.series.find((p) => p.ym === '2026-06')?.v, 5000, '旧月保留');
assert.equal(steps.series.find((p) => p.ym === '2026-07')?.v, 6500, '同月被较新侧覆盖');
assert.equal(steps.series.find((p) => p.ym === '2026-08')?.v, 7000, '新月进入');
assert.ok(merged.metrics.find((m) => m.key === 'weight'), '旧 weight 不得被冲掉');
assert.ok(merged.metrics.find((m) => m.key === 'restingHR'), '新 restingHR 要进来');
assert.equal(merged.workouts, 2, 'workouts 取较大');
assert.equal(merged.daily.length, 2, 'daily 按日并集');

// save 默认 merge
mem.value = existing;
saveHealthMetrics(incoming);
const saved = loadHealthMetrics();
assert.equal(saved.metrics.length, 3, 'save 默认 merge 不整表盖');
assert.ok(saved.metrics.find((m) => m.key === 'weight'));

// 显式 replace 才整份覆盖
saveHealthMetrics(incoming, 'replace');
assert.equal(loadHealthMetrics().metrics.length, 2, 'replace 整份覆盖');
assert.ok(!loadHealthMetrics().metrics.find((m) => m.key === 'weight'));

// 空库首次写入 = 原样落下
mem.value = null;
saveHealthMetrics(incoming);
assert.equal(loadHealthMetrics().metrics.length, 2);

console.log('health-store-merge: OK');
