/**
 * 行为契约:admin metrics 精确计数解析(修「1000 采样上限当真实计数」)。
 * PostgREST Content-Range "0-0/12345" → 12345;"*" 或缺失 → null(回落采样)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../app/api/admin/metrics/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Set, Map, Number, String, Boolean, Date, Math,
    require: () => ({}),
  });
  return mod.exports;
}

const M = load();

assert.equal(M.parseCountHeader('0-0/12345'), 12345, '解析真实总数');
assert.equal(M.parseCountHeader('0-999/3400'), 3400, '截断响应也能拿到真实总数(3400>1000)');
assert.equal(M.parseCountHeader('*/*'), null, '未知总数 → null');
assert.equal(M.parseCountHeader(null), null, '缺 header → null');
assert.equal(M.parseCountHeader('0-0/0'), 0, '零条 → 0(非 null)');

console.log('✓ admin-count-header 契约通过');
