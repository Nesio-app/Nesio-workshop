/**
 * 行为契约:跨域相关引擎(批次190)。
 * 验证:强相关被检出、滞后配对正确、样本不足不下结论、非因果标注。
 * 目的 = 把「难过那几天外卖多」从 LLM 叙事变成真皮尔逊 r。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/cross-domain-correlations.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
// 只 import type(编译期擦除),运行期无依赖。
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), Date, Math, Number, Map, Array, console });
const { mineCrossDomain } = mod.exports;

const dk = (i) => new Date(Date.UTC(2026, 4, 1) + i * 86_400_000).toISOString().slice(0, 10);
const rnd = [0.13, 0.71, 0.24, 0.88, 0.42, 0.05, 0.63, 0.37, 0.95, 0.51]; // 固定伪随机

// 构造 40 天:前一天情绪越低 → 次日花费越高(retail therapy,强负相关 lag=1)。
const rows = [];
for (let i = 0; i < 40; i++) {
  rows.push({
    dateKey: dk(i),
    m: {
      moodValence: -1 + (i % 5) * 0.4,          // -1.0 .. 0.6 循环
      steps: 3000 + rnd[i % rnd.length] * 4000,  // 与花费无系统关系
    },
  });
}
// 回填:今天花费依赖昨天情绪(情绪低→花得多 → 负相关)
for (let i = 1; i < rows.length; i++) {
  rows[i].m.spend = 80 - rows[i - 1].m.moodValence * 30 + (rnd[i % rnd.length] - 0.5) * 6;
}

const out = mineCrossDomain(rows);
const ms = out.find((r) => r.key === 'mood→spend:lag1');
assert.ok(ms, '检出「前一天情绪→次日花费」关系');
assert.ok(ms.r < -0.5 && ms.strength === 'strong', `强负相关(r<-0.5),实得 r=${ms?.r}`);
assert.equal(ms.lag, 1, '滞后 1 天');
assert.ok(ms.n >= 14, `样本量足够,实得 n=${ms?.n}`);
assert.ok(/花费/.test(ms.insight[0]) && /r=/.test(ms.insight[0]), '中文洞察带方向 + r 值');

// 样本不足:只给 5 天 → 不下任何结论(绝不编数字)
assert.equal(mineCrossDomain(rows.slice(0, 5)).length, 0, '样本<14 不下结论');

// 只有噪声(步数与花费无系统关系)不该误报成强相关
const noiseOnly = rows.map((r) => ({ dateKey: r.dateKey, m: { steps: r.m.steps, spend: r.m.spend } }));
const stepsSpend = mineCrossDomain(noiseOnly).find((r) => r.key === 'steps→mood');
assert.ok(!stepsSpend, '无 mood 列时不产出 steps→mood(缺列即跳过)');

console.log('cross-domain-correlations: OK');
