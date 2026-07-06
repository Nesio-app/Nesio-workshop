/**
 * 行为契约:健康跨板块关系挖掘(批次 46 / E)。
 * 验证:强相关被检出、滞后配对正确、样本不足不下结论、无关序列不误报。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/health-correlations.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
// health-correlations 只 import type(编译期擦除),运行期无依赖。
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), Date, Math, Number, Map, Array, console });
const { mineRelationships } = mod.exports;

// 构造 40 天:睡眠越多 → 次日血糖越低(强负相关,lag=1);运动与血糖同日随机(无关)。
const day = (i) => `2026-05-${String(i + 1).padStart(2, '0')}`.replace('2026-05-3', '2026-05-3'); // 仅需唯一有序字符串
const daily = [];
const rnd = [0.13, 0.71, 0.24, 0.88, 0.42, 0.05, 0.63, 0.37, 0.95, 0.51]; // 固定伪随机(不用 Math.random)
for (let i = 0; i < 40; i++) {
  const sleep = 5 + (i % 5) * 0.7;                 // 5.0–7.8 循环
  daily.push({
    date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    sleepH: sleep,
    activeEnergy: 300 + rnd[i % rnd.length] * 400, // 与血糖无系统关系
    // 次日血糖 = 基线 - 睡眠×系数 + 小噪声 → 与「前一天睡眠」强负相关
  });
}
// 回填:今天血糖依赖昨天睡眠
for (let i = 1; i < daily.length; i++) {
  daily[i].glucoseAvg = 140 - daily[i - 1].sleepH * 6 + (rnd[i % rnd.length] - 0.5) * 4;
}

const rels = mineRelationships(daily);
const sg = rels.find((r) => r.key === 'sleep→glucose');
assert.ok(sg, 'E:检出「前一晚睡眠→次日血糖」关系');
assert.ok(sg.r < -0.5 && sg.strength === 'strong', `E:强负相关(r<-0.5),实得 r=${sg?.r}`);
assert.equal(sg.lag, 1, 'E:滞后 1 天');
assert.ok(sg.n >= 14, `E:样本量足够,实得 n=${sg?.n}`);
assert.ok(/次日血糖越低/.test(sg.insight[0]), 'E:中文洞察方向正确');

// 样本不足:只给 5 天 → 不下任何结论
const few = daily.slice(0, 5).map((f) => ({ ...f }));
assert.equal(mineRelationships(few).length, 0, 'E:样本<14 不下结论');

console.log('health-correlations: OK');
