/**
 * 行为契约:批次197 情境提物 + 专项抽取的确定性部分。
 * 1) renewal(证件/保修)长周期窗:提前半年 low → 3个月 medium → 1个月 high → 过期 closed。
 * 2) flight 值机窗仍是 48h/26h/4h(接回机票路径后要保证没被改坏)。
 * 3) node-schema 生成的 prompt 行含新键(event.subtype/flightNo、object.subtype)——
 *    prompt 从 schema 派生,键漏了模型就抽不到。
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

// ── action-window: renewal + flight ────────────────────────────────────────
const { getActionWindow } = load('../lib/platform/guidance-engine/action-window.ts');
const now = new Date('2026-07-14T12:00:00Z');
const inDays = (d) => new Date(now.getTime() + d * 86_400_000);
const inHours = (h) => new Date(now.getTime() + h * 3_600_000);

// renewal 阶梯
assert.equal(getActionWindow({ type: 'renewal', scheduledAt: inDays(200), payload: {} }, now), 'closed', '>6个月 不催');
assert.equal(getActionWindow({ type: 'renewal', scheduledAt: inDays(100), payload: {} }, now), 'low', '3-6个月 提前知会');
assert.equal(getActionWindow({ type: 'renewal', scheduledAt: inDays(60), payload: {} }, now), 'medium', '1-3个月 该动手');
assert.equal(getActionWindow({ type: 'renewal', scheduledAt: inDays(20), payload: {} }, now), 'high', '不足1个月 抓紧');
assert.equal(getActionWindow({ type: 'renewal', scheduledAt: inDays(-1), payload: {} }, now), 'closed', '已过期 不在此打扰');

// flight 值机窗(接回机票后不应被改坏)
assert.equal(getActionWindow({ type: 'flight', scheduledAt: inHours(60), payload: {} }, now), 'closed', '>48h 太早');
assert.equal(getActionWindow({ type: 'flight', scheduledAt: inHours(30), payload: {} }, now), 'low', '26-48h 轻提醒');
assert.equal(getActionWindow({ type: 'flight', scheduledAt: inHours(20), payload: {} }, now), 'high', '值机窗已开');
assert.equal(getActionWindow({ type: 'flight', scheduledAt: inHours(3), payload: {} }, now), 'critical', '该出发了');
assert.equal(getActionWindow({ type: 'flight', scheduledAt: inHours(1), payload: {} }, now), 'closed', '已在路上');

// ── node-schema: 新键进 prompt ──────────────────────────────────────────────
const { renderAttributeSchemaLines } = load('../lib/portal/node-schema.ts');
const schemaBlock = renderAttributeSchemaLines();
for (const key of ['subtype', 'flightNo', 'from', 'to', 'pnr']) {
  assert.ok(schemaBlock.includes(key), `event/object schema 应含 ${key}(prompt 从 schema 派生)`);
}

console.log('context-adapters: OK');
