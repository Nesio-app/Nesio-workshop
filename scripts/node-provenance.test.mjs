/**
 * 行为契约:节点 provenance / AI 幻觉信任横切(批次210)。
 * 纯逻辑:isNodeUncertain 阈值 + nodeConfidenceToGuidance 映射。
 * 接线契约:guidance 聚焦适配器把写死高置信降到真实抽取置信(uncertain 时);FocusNode 透传 confidence;
 *          MemoryTab 用共享 isNodeUncertain(不再本地定义)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ── 纯逻辑 ──
const src = read('../lib/portal/node-provenance.ts');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, {
  module: mod,
  exports: mod.exports,
  require: (p) => {
    if (String(p).includes('signal-epistemic')) {
      return {
        isSignalEpistemic: (v) => typeof v === 'string' && [
          'observation', 'user_asserted', 'extraction', 'derived', 'feedback', 'system_summary',
        ].includes(v),
      };
    }
    return {};
  },
  Math,
  Number,
});
const { isNodeUncertain, nodeConfidenceToGuidance } = mod.exports;

assert.equal(isNodeUncertain({ confidence: 0.4 }), true, '0.4 < 0.6 → 不确定');
assert.equal(isNodeUncertain({ confidence: 0.59 }), true, '0.59 → 不确定');
assert.equal(isNodeUncertain({ confidence: 0.6 }), false, '0.6 → 确定(边界)');
assert.equal(isNodeUncertain({ confidence: 0.9 }), false, '0.9 → 确定');
assert.equal(isNodeUncertain({ confidence: 0 }), false, '0(无置信)→ 不算不确定');
assert.equal(isNodeUncertain({}), false, '无 confidence → 不算不确定');
assert.equal(isNodeUncertain({ confidence: 0.95, attributes: { epistemic: 'extraction' } }), true, 'extraction → 不确定');
assert.equal(isNodeUncertain({ confidence: 0.95, epistemic: 'derived' }), false, 'derived 高置信不算 uncertain(另走检索滤层)');

assert.equal(nodeConfidenceToGuidance({ confidence: 0.4 }), 40, '0.4 → 40(0-100)');
assert.equal(nodeConfidenceToGuidance({ confidence: 0.9 }), 90, '0.9 → 90');
assert.equal(nodeConfidenceToGuidance({}), 70, '缺失 → 保守 0.7 → 70');
assert.equal(nodeConfidenceToGuidance({ confidence: 1.5 }), 100, '超界 → 夹到 100');

// ── 接线契约:guidance 聚焦适配器 ──
const adapters = read('../lib/platform/guidance-engine/source-adapters.ts');
assert.match(adapters, /import \{ isNodeUncertain, nodeConfidenceToGuidance \} from '@\/lib\/portal\/node-provenance'/, '引入共享 provenance');
assert.match(adapters, /const uncertain = isNodeUncertain\(node\)/, '每个聚焦节点算 uncertain');
assert.match(adapters, /confOf\s*=\s*\(base: number\)[\s\S]{0,80}nodeConfidenceToGuidance\(node\)\s*:\s*base/, 'confOf:uncertain 时降到真实抽取置信,否则保原值');
// 四个聚焦卡置信度都过 confOf(不再写死高置信冒充用户确认)
assert.ok((adapters.match(/confidence: confOf\(/g) || []).length >= 4, 'flight/renewal/expiry/deadline 四处置信都过 confOf');
assert.ok(!/source: 'memory', confidence: 8[85],/.test(adapters), '不再有写死的 confidence: 88/85(已换 confOf)');

// ── FocusNode 透传 confidence ──
const vm2 = read('../lib/platform/view-models/today-view-model.ts');
assert.match(vm2, /interface FocusNode[\s\S]{0,500}confidence\?: number/, 'FocusNode 带 confidence');
assert.match(vm2, /confidence: n\.confidence/, 'toFocusNode 透传 n.confidence');

// ── MemoryTab 用共享定义(不再本地) ──
const mt = read('../components/portal/MemoryTab.tsx');
assert.match(mt, /import \{ isNodeUncertain \} from '@\/lib\/portal\/node-provenance'/, 'MemoryTab 引入共享 isNodeUncertain');
assert.ok(!/function isNodeUncertain\(/.test(mt), 'MemoryTab 不再本地定义 isNodeUncertain(单一真源)');

console.log('node-provenance: OK');
