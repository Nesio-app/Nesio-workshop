/**
 * 行为契约:AI Key 统一解析(批次 52)。
 * 验证:别名收敛(GOOGLE_GENERATIVE_AI_API_KEY 等同 GEMINI_API_KEY)、first-wins、缺失返回空、
 * 且与 ai-provider-router-contract.mjs 的 alternateGroups 一致。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/ai-keys.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), process: { env: {} }, console });
const { resolveAiKeys, resolveAiKey, AI_KEY_ALIASES } = mod.exports;

// 别名:只配 GOOGLE_GENERATIVE_AI_API_KEY(不配 GEMINI_API_KEY)也能解析出 gemini —— 这是修复的核心。
assert.equal(resolveAiKey('gemini', { GOOGLE_GENERATIVE_AI_API_KEY: 'g-key' }), 'g-key', '别名:GOOGLE_GENERATIVE_AI_API_KEY 等同 Gemini key');
assert.equal(resolveAiKey('gemini', { GOOGLE_API_KEY: 'x' }), 'x', '别名:GOOGLE_API_KEY 也认');
assert.equal(resolveAiKey('anthropic', { CLAUDE_API_KEY: 'c' }), 'c', '别名:CLAUDE_API_KEY 等同 Anthropic');

// first-wins:主名优先
assert.equal(resolveAiKey('gemini', { GEMINI_API_KEY: 'primary', GOOGLE_API_KEY: 'alt' }), 'primary', 'first-wins 取主名');

// 缺失返回空;空白被 trim 视为空
assert.equal(resolveAiKey('gemini', {}), '', '缺失返回空');
assert.equal(resolveAiKey('gemini', { GEMINI_API_KEY: '   ' }), '', '空白视为未配');

// resolveAiKeys 全量
const all = resolveAiKeys({ GOOGLE_GENERATIVE_AI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' });
assert.equal(all.gemini, 'g'); assert.equal(all.anthropic, 'a'); assert.equal(all.openai, ''); assert.equal(all.doubao, '');

// 与契约的 alternateGroups 保持一致(防两处漂移)
const contract = fs.readFileSync(new URL('../lib/portal/contracts/ai-provider-router-contract.mjs', import.meta.url), 'utf8');
for (const name of AI_KEY_ALIASES.gemini) assert.ok(contract.includes(`'${name}'`), `契约应含 gemini 别名 ${name}`);
for (const name of AI_KEY_ALIASES.anthropic) assert.ok(contract.includes(`'${name}'`), `契约应含 anthropic 别名 ${name}`);

console.log('ai-keys: OK');
