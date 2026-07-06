/**
 * 行为契约:健康风险分层(批次 50 / ③层)。
 * 验证:VO₂max 体适能按年龄性别分级、BMI(WHO)、GMI→eA1c(ADA);数据不全不硬算;高风险排前。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/health-risk.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), Math, Number, Array, String, console });
const { computeRiskScores } = mod.exports;

const metric = (key, latest) => ({ key, label: [key, key], latest, latestDate: '2026-07-01', prev: null, unit: '', decimals: 1, group: 'body', series: [] });
const find = (arr, id) => arr.find((s) => s.id === id);

// 39 岁女性,VO₂max 36.4 → 30-39女 门槛[20,28,34,45],落在 excellent(34–45)→ low
const s1 = computeRiskScores({
  metrics: [metric('vo2max', 36.4), metric('bmi', 21.5)],
  glucose: { unit: 'mmol/L', count: 2000, avg: 6.1, min: 4, max: 9, cv: 18, gmi: 5.9, tirPct: 98, belowPct: 0.4, abovePct: 1.6, targetLow: 3.9, targetHigh: 10, daily: [], hourly: [] },
  profile: { age: 39, sex: 'female' },
});
assert.ok(find(s1, 'vo2max-fitness'), '③:VO₂max 评分生成');
assert.equal(find(s1, 'vo2max-fitness').category, 'low', 'VO₂max 36.4 属优秀(low risk)');
assert.equal(find(s1, 'bmi').category, 'info', 'BMI 21.5 正常');
assert.equal(find(s1, 'gmi-band').category, 'moderate', 'GMI 5.9% 糖尿病前期区间');
assert.ok(/5\.9%/.test(find(s1, 'gmi-band').value), 'GMI 值进展示');

// BMI 由体重+身高推算(无 bmi 指标),肥胖 → high
const s2 = computeRiskScores({ metrics: [metric('weight', 95), metric('height', 165)], profile: {} });
const bmi = find(s2, 'bmi');
assert.ok(bmi && bmi.category === 'high', `BMI 95kg/1.65m≈34.9 肥胖,实得 ${bmi?.value}`);

// 数据不全:无 vo2max/年龄 → 不出 VO₂max;无 glucose → 不出 GMI
const s3 = computeRiskScores({ metrics: [metric('vo2max', 40)], profile: {} }); // 缺年龄性别
assert.equal(find(s3, 'vo2max-fitness'), undefined, '③:缺年龄/性别不硬算 VO₂max');

// 高风险排前
const s4 = computeRiskScores({
  metrics: [metric('vo2max', 15), metric('bmi', 21)], // VO₂max 15 → 30-39女 偏低 high
  profile: { age: 35, sex: 'female' },
});
assert.equal(s4[0].category, 'high', '高风险排最前');

// 空输入不抛
assert.doesNotThrow(() => computeRiskScores({ metrics: [] }));
assert.equal(computeRiskScores({ metrics: [] }).length, 0, '无数据无评分');

console.log('health-risk: OK');
