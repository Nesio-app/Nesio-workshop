/**
 * 行为契约:Alexa 语音召回纯函数层。
 * 行→片段、空结果诚实话术、LLM 兜底把命中记忆念回、TTS 净化(去 markdown/截断)、
 * 提示词严格限定「只用给的记忆」。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/portal/alexa-answer.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, JSON, Array, Object, Set, Map, Number, String, Boolean, Date, Math, require: () => ({}) });
  return mod.exports;
}
const M = load();

// rowsToSnippets:取字段 + 短日期 + take 上限
const snips = M.rowsToSnippets([
  { title: 'Passport in top drawer', source: 'voice', captured_at: '2026-07-23T10:00:00Z', payload: { note: 'bedroom' } },
  { title: 'Milk', source: 'voice', captured_at: '2026-07-20T10:00:00Z' },
  { title: 'x', source: 'voice' }, { title: 'y', source: 'voice' }, { title: 'z', source: 'voice' }, { title: 'w', source: 'voice' },
], 5);
assert.equal(snips.length, 5, 'take 上限=5');
assert.equal(snips[0].title, 'Passport in top drawer', '标题透传');
assert.equal(snips[0].when, '2026-07-23', '短日期 YYYY-MM-DD');
assert.ok(snips[0].text.includes('bedroom'), 'payload 进 text');

// 空结果:诚实,不编造,含 query
const empty = M.emptyRecallAnswer('my passport');
assert.ok(/couldn.t find/i.test(empty), '说没找到');
assert.ok(empty.includes('my passport'), '带上问题');

// fallback:单条 → 念回标题;多条 → 报数量
const one = M.fallbackRecallAnswer('keys', [{ title: 'Keys in bowl', source: 'voice', when: '2026-07-23', text: 'by the door' }]);
assert.ok(one.includes('Keys in bowl'), '单条念回标题');
assert.ok(one.includes('by the door'), '带上下文');
const many = M.fallbackRecallAnswer('keys', [
  { title: 'Keys in bowl', source: 'voice', when: '', text: '' },
  { title: 'Spare keys', source: 'voice', when: '', text: '' },
]);
assert.ok(/2 related/.test(many), '多条报数量');
assert.ok(many.includes('Keys in bowl'), '多条也念最相关那条');
// fallback 空 → 退回诚实空话术
assert.ok(/couldn.t find/i.test(M.fallbackRecallAnswer('x', [])), '空片段 → 诚实空');

// buildRecallPrompt:含约束 + 问题 + 记忆
const prompt = M.buildRecallPrompt('where is my passport', snips);
assert.ok(/ONLY the memories/i.test(prompt), '限定只用给的记忆');
assert.ok(/one short spoken english sentence/i.test(prompt), '要求一句口语英文');
assert.ok(prompt.includes('where is my passport'), '带问题');
assert.ok(prompt.includes('Passport in top drawer'), '带记忆');

// sanitizeSpokenAnswer:去 markdown/换行/多空格 + 截断
assert.equal(M.sanitizeSpokenAnswer('**Hello**\n\n  world  '), 'Hello world', '去 markdown/空白');
const long = M.sanitizeSpokenAnswer('a'.repeat(600), 500);
assert.ok(long.length <= 500, '截断到上限');
assert.ok(long.endsWith('…'), '截断加省略号');

console.log('✓ alexa-answer 契约通过');
