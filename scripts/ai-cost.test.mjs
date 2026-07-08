/**
 * 行为契约:AI 成本核算(lib/portal/ai-cost.ts)。
 * 验证:model→单价档匹配(opus/sonnet/haiku、flash/pro、未知回退)、
 * token→美元换算(输入/输出/缓存读 0.1x/缓存写 1.25x)、负数夹 0。
 * 成本数字若算错会静默误导 /admin,故锁死。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/ai-cost.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ctx = { module: { exports: {} }, exports: {}, require: () => ({}) };
ctx.module.exports = ctx.exports;
vm.runInNewContext(js, ctx);
const { priceFor, estimateCostUsd } = ctx.module.exports;

// ── priceFor:model 名子串宽松匹配 ──
// 注:vm 跨 realm 的对象与本 realm 原型不同,deepStrictEqual 会误报 → 逐字段比原始数值。
const priceEq = (p, input, output, msg) => { assert.equal(p.input, input, `${msg} input`); assert.equal(p.output, output, `${msg} output`); };
priceEq(priceFor('claude', 'claude-3-5-haiku-latest'), 0.8, 4, 'haiku 档');
priceEq(priceFor('claude', 'claude-haiku-4-5'), 0.8, 4, 'haiku 新代仍归 haiku');
priceEq(priceFor('claude', 'claude-sonnet-4'), 3, 15, 'sonnet 档');
priceEq(priceFor('claude', 'claude-opus-4-8'), 15, 75, 'opus 档(不被 sonnet 误配)');
priceEq(priceFor('claude', 'mystery-model'), 0.8, 4, '未知 Claude → 保守按 haiku');
priceEq(priceFor('gemini', 'gemini-2.5-flash'), 0.075, 0.3, 'flash 档');
priceEq(priceFor('gemini', 'gemini-1.5-pro'), 1.25, 5, 'pro 档');
priceEq(priceFor('gemini', 'gemini-weird'), 0.075, 0.3, '未知 Gemini → 保守按 flash');

// ── estimateCostUsd:token → 美元 ──
const M = 1_000_000;
assert.equal(estimateCostUsd('claude', 'haiku', { inputTokens: M, outputTokens: 0 }), 0.8, '1M 输入 haiku = $0.80');
assert.equal(estimateCostUsd('claude', 'haiku', { inputTokens: 0, outputTokens: M }), 4, '1M 输出 haiku = $4');
assert.equal(estimateCostUsd('claude', 'sonnet', { inputTokens: M, outputTokens: M }), 18, '1M+1M sonnet = 3+15 = $18');
assert.ok(Math.abs(estimateCostUsd('claude', 'haiku', { inputTokens: 0, outputTokens: 0, cacheReadTokens: M }) - 0.08) < 1e-9, '缓存读按 0.1x 输入价');
assert.equal(estimateCostUsd('claude', 'haiku', { inputTokens: 0, outputTokens: 0, cacheWriteTokens: M }), 1.0, '缓存写按 1.25x 输入价');
assert.equal(estimateCostUsd('claude', 'haiku', { inputTokens: -5, outputTokens: -5 }), 0, '负 token 夹到 0');
assert.equal(estimateCostUsd('claude', 'haiku', { inputTokens: 0, outputTokens: 0 }), 0, '零用量 = $0');

// 组合:真实一次调用量级(500 in + 400 out,haiku)应是极小正数
const real = estimateCostUsd('claude', 'claude-3-5-haiku-latest', { inputTokens: 500, outputTokens: 400 });
assert.ok(real > 0 && real < 0.01, '典型单次调用成本为亚分级正数');

console.log('ai-cost: OK');
