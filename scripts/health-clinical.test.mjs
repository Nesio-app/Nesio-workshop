/**
 * 行为契约:健康「知识包」指南判定(批次 49)。
 * 验证:TIR/TBR/CV 目标判定、黎明现象、深睡偏低、静息心率/HRV 偏离基线;红旗排前;规则出错不影响其余。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel, requireImpl) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, Math, Number, Array, console });
  return mod.exports;
}
// 引擎已抽到 domain-rules(Layer1 通用运行时)—— 装真引擎,契约顺带钉住"替换后行为不变"。
const domainRules = loadTs('../lib/portal/domain-rules.ts', () => ({}));
const { evaluateHealthFindings } = loadTs('../lib/portal/health-clinical.ts', (p) =>
  p === './domain-rules' ? domainRules : ({}));

const find = (arr, id) => arr.find((f) => f.id === id);

// 1) 血糖:达标好、低血糖偏多(红旗)、波动大;黎明现象(清晨比夜间谷值高 ~2mmol/L)。
const hourly = [];
for (let h = 0; h < 24; h++) hourly.push({ hour: h, avg: h >= 4 && h < 8 ? 7.5 : 5.5 }); // 清晨 7.5,夜间 5.5 → 升 2.0
const g1 = evaluateHealthFindings({
  glucose: { unit: 'mmol/L', count: 2000, avg: 6.1, min: 3, max: 12, cv: 40, gmi: 5.9, tirPct: 60, belowPct: 6, abovePct: 34, targetLow: 3.9, targetHigh: 10, daily: [], hourly },
  metrics: [],
});
assert.equal(find(g1, 'glucose-tir').severity, 'attention', 'TIR 60% 偏低');
assert.equal(find(g1, 'glucose-tbr').severity, 'flag', 'TBR 6% >4% 红旗');
assert.equal(find(g1, 'glucose-cv').severity, 'attention', 'CV 40% 波动大');
assert.ok(find(g1, 'glucose-dawn'), '检出黎明现象');
assert.equal(g1[0].severity, 'flag', '红旗排最前');

// 达标场景:TIR 好、CV 稳、无低血糖
const g2 = evaluateHealthFindings({
  glucose: { unit: 'mmol/L', count: 2000, avg: 6.1, min: 4, max: 9, cv: 18, gmi: 5.9, tirPct: 98, belowPct: 0.4, abovePct: 1.6, targetLow: 3.9, targetHigh: 10, daily: [], hourly: hourly.map((h) => ({ hour: h.hour, avg: 5.6 })) },
  metrics: [],
});
assert.equal(find(g2, 'glucose-tir').severity, 'info', 'TIR 98% 达标');
assert.equal(find(g2, 'glucose-cv').severity, 'info', 'CV 18% 稳定');
assert.equal(find(g2, 'glucose-tbr'), undefined, 'TBR 0.4% 无提示');
assert.equal(find(g2, 'glucose-dawn'), undefined, '无黎明现象(清晨不升)');

// 2) 深睡偏低
const s = evaluateHealthFindings({ sleepStages: { night: '2026-07-04', core: 4, deep: 0.3, rem: 1.5, awake: 0.1, total: 5.8 }, metrics: [] });
assert.equal(find(s, 'sleep-deep').severity, 'attention', '深睡 0.3/5.8≈5% 偏低');

// 3) 静息心率高于基线 / HRV 低于基线(基线=历史月度中位数,除最近点)
const series = (vals) => vals.map((v, i) => ({ ym: `2026-${String(i + 1).padStart(2, '0')}`, v }));
const b = evaluateHealthFindings({
  metrics: [
    { key: 'restingHR', label: ['静息心率', 'RHR'], latest: 80, latestDate: '2026-07-01', prev: null, unit: 'bpm', decimals: 0, group: 'heart', series: series([60, 61, 62, 60, 80]) }, // 基线~61,最新80
    { key: 'hrv', label: ['HRV', 'HRV'], latest: 25, latestDate: '2026-07-01', prev: null, unit: 'ms', decimals: 0, group: 'heart', series: series([50, 52, 48, 51, 25]) }, // 基线~51,最新25
  ],
});
assert.equal(find(b, 'rhr-vs-baseline').severity, 'attention', '静息心率高于基线');
assert.equal(find(b, 'hrv-vs-baseline').severity, 'attention', 'HRV 低于基线');

// 4) 空输入不抛、返回空
assert.doesNotThrow(() => evaluateHealthFindings({ metrics: [] }));
assert.equal(evaluateHealthFindings({ metrics: [] }).length, 0, '无数据无提示');

console.log('health-clinical: OK');
