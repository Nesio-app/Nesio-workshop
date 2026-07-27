/**
 * 行为契约:云同步冲突解决(数据审计 #3 —— last-write-wins 丢数据)。
 * 锁死:
 *  - Signal 投影携带 modifiedAt(逻辑修改时间),缺失回退 capturedAt。
 *  - modifiedAt 不污染 payload(否则每次编辑因时间戳变化误触重嵌入)。
 *  - 往返投影(lifeNodeToSignal → signalToLifeNode)保真 modifiedAt。
 *  - 云端行 updated_at 盖「编辑时刻」而非「同步时刻 new Date()」——
 *    陈旧副本天生更旧,后同步也不会赢(regression guard)。
 *  - DB 守卫 SQL 存在,且以「NEW.updated_at < OLD.updated_at → RETURN OLD」拒绝陈旧写入。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function compile(path, requireImpl, extraGlobals = {}) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: requireImpl, console,
    Date, Math, JSON, Number, Array, Object, String, Set, Map, RegExp, Buffer,
    window: undefined, ...extraGlobals,
  });
  return mod.exports;
}

const epistemicStub = {
  inferEpistemic: () => 'observation',
  isSignalEpistemic: () => false,
  parseDerivedFromAttr: () => [],
  isGroundFact: () => true,
  resolveEpistemic: (x) => x?.epistemic || 'observation',
  stampEpistemic: (s) => s,
  GROUND_EPISTEMICS: new Set(['observation']),
};

const sig = compile('../lib/life-domain/signal.ts', (p) =>
  p.includes('signal-read-cache') ? { getCachedSignals: () => null }
  : p.includes('life-graph') ? { getLifeGraph: () => [], deleteLifeNode: () => {} }
  : p.includes('signal-epistemic') ? epistemicStub
  : ({}));

const base = {
  id: 'n1', type: 'note', name: 'x', attributes: {}, source: 'manual',
  confidence: 0.6, createdAt: '2026-07-01T00:00:00.000Z', relations: [],
};

// ── modifiedAt 派生 ──
assert.equal(sig.lifeNodeToSignal(base).modifiedAt, '2026-07-01T00:00:00.000Z', '无 updatedAt → 回退 createdAt');

const edited = sig.lifeNodeToSignal({ ...base, attributes: { updatedAt: '2026-07-05T12:00:00.000Z' } });
assert.equal(edited.modifiedAt, '2026-07-05T12:00:00.000Z', 'attributes.updatedAt → modifiedAt(编辑时刻)');
assert.equal(edited.payload.updatedAt, undefined, 'updatedAt 不进 payload(不污染 embedding)');

// ── 往返保真 ──
const back = sig.signalToLifeNode(edited);
assert.equal(back.attributes.updatedAt, '2026-07-05T12:00:00.000Z', 'signalToLifeNode 保真 modifiedAt');

// ── 冲突胜负:编辑时刻定,而非同步顺序 ──
// DB 触发器语义:传入更旧 → 拒绝(保留旧行)。这里用同一判定复现「谁赢」。
function winner(a, b) {
  // b 后同步。b 更旧则被拒,旧行(a)保留;否则 b 生效。
  return b.updated_at < a.updated_at ? a : b;
}
const deviceA = { updated_at: edited.modifiedAt, tag: 'A-新编辑' };
const deviceBStale = { updated_at: '2026-07-01T00:00:00.000Z', tag: 'B-陈旧副本' };
assert.equal(winner(deviceA, deviceBStale).tag, 'A-新编辑', '陈旧副本后同步也不会盖掉新编辑');
assert.equal(winner(deviceBStale, deviceA).tag, 'A-新编辑', '新编辑后同步正常生效');

// ── 云端行 updated_at 盖编辑时刻(regression guard)──
const serverSrc = fs.readFileSync(new URL('../lib/platform/runtime/cloud-signals-server.ts', import.meta.url), 'utf8');
assert.ok(/updated_at:\s*signal\.modifiedAt/.test(serverSrc), 'signalRow.updated_at 必须盖 signal.modifiedAt,不是 new Date()');
assert.ok(!/updated_at:\s*new Date\(\)\.toISOString\(\)/.test(serverSrc), 'updated_at 不得回退为同步时刻 new Date()');

// ── DB 守卫存在且拒绝陈旧写入 ──
const guardSrc = fs.readFileSync(new URL('../database/schema/supabase-signals-conflict-guard-v1.sql', import.meta.url), 'utf8');
assert.ok(/NEW\.updated_at\s*<\s*OLD\.updated_at/.test(guardSrc), '守卫须比较 NEW < OLD updated_at');
assert.ok(/RETURN OLD;/.test(guardSrc), '陈旧写入须 RETURN OLD(丢弃覆盖)');
assert.ok(/BEFORE UPDATE ON public\.signals/.test(guardSrc), '须挂 signals 表 BEFORE UPDATE 触发器');

console.log('cloud-conflict: OK');
