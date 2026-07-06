/**
 * 行为契约:健康指南语料检索(批次 51 / ④层)。
 * 验证:按判定 id 取到对应指南要点、去重、未知 id 返回空、每条有出处+链接。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/health-guidelines.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), Array, Set, String, console });
const { retrieveGuidelines } = mod.exports;

const g = retrieveGuidelines(['glucose-tir', 'vo2max-fitness', 'sleep-deep']);
assert.equal(g.length, 3, '④:取到 3 条对应要点');
assert.ok(g.every((s) => s.source && s.url && s.text[0] && s.text[1]), '④:每条有出处+链接+中英文');
assert.ok(g.find((s) => s.topic === 'glucose-tir').text[0].includes('70%'), '④:TIR 要点含 70% 目标');

// 去重:重复 id 只取一次
assert.equal(retrieveGuidelines(['bmi', 'bmi', 'bmi']).length, 1, '④:重复 id 去重');
// 未知 id:忽略,不抛
assert.equal(retrieveGuidelines(['does-not-exist']).length, 0, '④:未知 id 返回空');
assert.doesNotThrow(() => retrieveGuidelines([]), '④:空输入不抛');

console.log('health-guidelines: OK');
