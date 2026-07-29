/**
 * 行为契约:专项抽取的确定性部分。
 * (action-window 时窗规则已随规则管线物理拆除 2026-07-29 —— 窗口现由 AI 判决输出
 *  showFrom/showUntil,本地钳制在 guidance-gates,契约见 test:guidance-judge/gates。)
 * node-schema 生成的 prompt 行含新键(event.subtype/flightNo、object.subtype)——
 * prompt 从 schema 派生,键漏了模型就抽不到。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load(relPath) {
  const src = fs.readFileSync(new URL(relPath, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), Date, Number, Math, Object, String, RegExp, Array, console });
  return mod.exports;
}

// ── node-schema: 新键进 prompt ──────────────────────────────────────────────
const { renderAttributeSchemaLines } = load('../lib/portal/node-schema.ts');
const schemaBlock = renderAttributeSchemaLines();
for (const key of ['subtype', 'flightNo', 'from', 'to', 'pnr']) {
  assert.ok(schemaBlock.includes(key), `event/object schema 应含 ${key}(prompt 从 schema 派生)`);
}

console.log('context-adapters: OK');
