/**
 * 行为契约:开放世界 Layer ③ LLM 巡查(纯逻辑,批次207)。
 * - selectSweepCandidates:只选低置信(≤0.5)+ 命中 hint 预筛 + 未曾巡查的节点,按新近取前 N。
 * - parseSweepResponse:严格 —— 丢幻觉 nodeId / 非法 kind / 无日期 / 空标题;硬顶 ≤3;容忍围栏文本。
 * - sweepFindingsToGuidanceEvents:窗口(renewal 180d / expiry 2d)+ source='llm_sweep' + 节点已删则弃。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/platform/guidance-engine/llm-sweep.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), Date, JSON, String, Object, Number, Array, Set, Boolean });
const m = mod.exports;

// ── selectSweepCandidates ──────────────────────────────────────────────────
const nodes = [
  { id: 'a', name: '护照', rawInput: '护照2027年到期', confidence: 0.4, createdAt: '2026-07-10' }, // 低置信 + hint ✓
  { id: 'b', name: '随手记', rawInput: '今天天气不错', confidence: 0.3, createdAt: '2026-07-11' },   // 低置信但无 hint ✗
  { id: 'c', name: '牛奶', rawInput: '保质期到下周', confidence: 0.9, createdAt: '2026-07-12' },       // 有 hint 但高置信 ✗
  { id: 'd', name: '保修卡', rawInput: '洗衣机 warranty', confidence: 0.5, createdAt: '2026-07-13' }, // 边界 0.5 + hint ✓
];
let cands = m.selectSweepCandidates(nodes);
const ids = cands.map((c) => c.id).sort();
assert.deepEqual(ids, ['a', 'd'], '只选低置信(≤0.5)+ 命中 hint 的节点');
assert.equal(cands[0].id, 'd', '按 createdAt 新近排序(d 比 a 新)');

// 已巡查过的排除
cands = m.selectSweepCandidates(nodes, { sweptIds: new Set(['d']) });
assert.deepEqual(cands.map((c) => c.id), ['a'], '已 swept 的节点不再选(每节点这辈子只送一次)');

// cap
const many = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, rawInput: '有效期到期', confidence: 0.2, createdAt: `2026-07-${(i % 28) + 1}` }));
assert.ok(m.selectSweepCandidates(many, { limit: 12 }).length === 12, 'limit 截断候选数');

// ── parseSweepResponse ─────────────────────────────────────────────────────
const cid = new Set(['a', 'd']);
const good = JSON.stringify([
  { nodeId: 'a', kind: 'renewal', title: '护照2027年3月到期', dueDate: '2027-03-01' },
  { nodeId: 'x', kind: 'renewal', title: '幻觉节点', dueDate: '2027-01-01' }, // nodeId 不在候选 → 丢
  { nodeId: 'd', kind: 'bogus', title: '非法kind', dueDate: '2027-01-01' },   // kind 非法 → 丢
  { nodeId: 'd', kind: 'expiry', title: '没日期', dueDate: 'not-a-date' },     // 无日期 → 丢
  { nodeId: 'd', kind: 'expiry', title: '保修', dueDate: '2027-05-01' },        // ✓
]);
let findings = m.parseSweepResponse(good, cid);
// 注:parseSweepResponse 的结果数组在 vm 沙箱里用 [] 字面量建的,原型是沙箱 realm 的
// Array.prototype;deepStrictEqual 会因跨 realm 原型不等而失败 → 用 spread 归到外层 realm + join 比较。
assert.equal([...findings].map((f) => f.nodeId).sort().join(','), 'a,d', '只留指向真候选 + 合法 kind + 有日期的');
assert.equal(findings.find((f) => f.nodeId === 'a').kind, 'renewal', '保留 kind');

// 围栏/前后缀文本容忍
const fenced = '```json\n[{"nodeId":"a","kind":"expiry","title":"到期","dueDate":"2027-02-02"}]\n```';
assert.equal(m.parseSweepResponse(fenced, cid).length, 1, '容忍 ```json 围栏与前后缀');
assert.equal(m.parseSweepResponse('完全不是 JSON', cid).length, 0, '非 JSON → 空');

// ≤3 硬顶
const overflow = JSON.stringify(Array.from({ length: 6 }, () => ({ nodeId: 'a', kind: 'renewal', title: 't', dueDate: '2027-03-03' })));
assert.ok(m.parseSweepResponse(overflow, cid).length <= 3, '硬顶 ≤3 条/次');

// ── sweepFindingsToGuidanceEvents:窗口 + source ────────────────────────────
const now = new Date('2026-07-15T00:00:00Z');
const live = new Set(['a', 'd', 'e']);
const evs = m.sweepFindingsToGuidanceEvents(
  [
    { nodeId: 'a', kind: 'renewal', title: '护照续期', dueDate: '2026-10-01' }, // 78天内 → ✓
    { nodeId: 'd', kind: 'renewal', title: '太远', dueDate: '2028-01-01' },      // >180天 → ✗
    { nodeId: 'e', kind: 'expiry', title: '牛奶', dueDate: '2026-07-16' },       // 1天内 → ✓
    { nodeId: 'a', kind: 'expiry', title: '过窗', dueDate: '2026-08-30' },       // expiry>2天 → ✗
    { nodeId: 'gone', kind: 'renewal', title: '已删节点', dueDate: '2026-09-01' }, // 不在 live → ✗
  ],
  live,
  now,
);
const evIds = [...evs].map((e) => e.id).sort().join(',');
assert.equal(evIds, 'sweep-a,sweep-e', '只出在窗口内 + 节点还在的');
assert.ok(evs.every((e) => e.source === 'llm_sweep'), "source 全是 'llm_sweep'(供 ④ 保守处理)");
assert.ok(evs.every((e) => e.confidence === 68), 'confidence 68(低于确定性、≥50 不被自动压制)');
assert.ok(evs.every((e) => e.payload.viaSweep === true), 'payload.viaSweep 标记来源');
assert.equal(evs.find((e) => e.id === 'sweep-a').type, 'renewal', 'renewal 类型透传');

console.log('llm-sweep: OK');
