/**
 * 行为契约:Alexa 意图路由(routeAlexa 纯函数)。
 * LaunchRequest→welcome;CaptureMemoryIntent(有槽)→capture;空槽→reject;
 * AskMemoryIntent→ask;Stop/Cancel→end;Help→help;未知意图→help;未知请求→reject。
 * 只测纯路由(无副作用),不碰 fetch/env。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../app/api/alexa/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Set, Map, Number, String, Boolean, Date, Math,
    // 拦 next/server 与 env 依赖(纯路由用不到,但 transpile 后顶层 import 会 require)
    require: () => ({ NextResponse: { json: () => ({}) }, envValue: () => '' }),
  });
  return mod.exports;
}

const M = load();
const route = M.routeAlexa;

// 唤醒
assert.equal(route({ request: { type: 'LaunchRequest' } }).kind, 'welcome', 'Launch→welcome');

// 捕获:有内容
const cap = route({ request: { type: 'IntentRequest', intent: { name: 'CaptureMemoryIntent', slots: { content: { value: 'the key is under the mat' } } } } });
assert.equal(cap.kind, 'capture', 'Capture 有槽→capture');
assert.equal(cap.content, 'the key is under the mat', '内容透传');

// 捕获:空内容 → reject(不静默吞)
assert.equal(route({ request: { type: 'IntentRequest', intent: { name: 'CaptureMemoryIntent', slots: {} } } }).kind, 'reject', 'Capture 空槽→reject');
assert.equal(route({ request: { type: 'IntentRequest', intent: { name: 'CaptureMemoryIntent', slots: { content: { value: '   ' } } } } }).kind, 'reject', 'Capture 空白→reject');

// 询问
const ask = route({ request: { type: 'IntentRequest', intent: { name: 'AskMemoryIntent', slots: { query: { value: 'where is my passport' } } } } });
assert.equal(ask.kind, 'ask', 'Ask 有槽→ask');
assert.equal(ask.query, 'where is my passport', '查询透传');
assert.equal(route({ request: { type: 'IntentRequest', intent: { name: 'AskMemoryIntent', slots: {} } } }).kind, 'reject', 'Ask 空槽→reject');

// 内建
assert.equal(route({ request: { type: 'IntentRequest', intent: { name: 'AMAZON.StopIntent' } } }).kind, 'end', 'Stop→end');
assert.equal(route({ request: { type: 'IntentRequest', intent: { name: 'AMAZON.CancelIntent' } } }).kind, 'end', 'Cancel→end');
assert.equal(route({ request: { type: 'IntentRequest', intent: { name: 'AMAZON.HelpIntent' } } }).kind, 'help', 'Help→help');
assert.equal(route({ request: { type: 'IntentRequest', intent: { name: 'SomethingUnknownIntent' } } }).kind, 'help', '未知意图→help(不崩)');

// 结束 / 未知请求
assert.equal(route({ request: { type: 'SessionEndedRequest' } }).kind, 'end', 'SessionEnded→end');
assert.equal(route({ request: { type: 'WeirdRequest' } }).kind, 'reject', '未知请求→reject');
assert.equal(route(null).kind, 'reject', 'null→reject(不崩)');
assert.equal(route({}).kind, 'reject', '空对象→reject');

console.log('✓ alexa-route 契约通过');
