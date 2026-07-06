/**
 * 行为契约:健康四层 → guidance 事件桥。
 * 验证:只把红旗/可关注(②)+ 高/中风险(③)升成 health_insight 事件;info/正常/low 不打扰;
 * 红旗排前;最多 3 条;payload 带 severity + 双语 title/body + reason(供 Today 卡渲染)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/platform/guidance-engine/source-adapters.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
// 别的适配器有外部依赖,但本桥函数只用入参、不触及它们 → require 全桩成空对象即可加载。
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console });
const { healthFindingsToGuidanceEvents } = mod.exports;

const finding = (id, severity) => ({ id, severity, title: [`${id}-zh`, `${id}-en`], detail: ['d-zh', 'd-en'], source: '共识X' });
const score = (id, category) => ({ id, label: [`${id}-zh`, `${id}-en`], value: '值', category, detail: ['rd-zh', 'rd-en'], source: '常模Y' });

// info / low 不打扰
assert.equal(healthFindingsToGuidanceEvents([finding('a', 'info')], []).length, 0, 'info 不出卡');
assert.equal(healthFindingsToGuidanceEvents([], [score('b', 'low')]).length, 0, 'low 风险不出卡');
assert.equal(healthFindingsToGuidanceEvents([], [score('c', 'info')]).length, 0, 'info 风险不出卡');

// flag / attention / high / moderate 出卡,类型正确
const one = healthFindingsToGuidanceEvents([finding('tbr', 'flag')], []);
assert.equal(one.length, 1);
assert.equal(one[0].type, 'domain_insight', '类型:通用 domain_insight');
assert.equal(one[0].payload.domain, 'health', 'payload 标注 health 域');
assert.equal(one[0].payload.icon, '🩺', '域图标随 payload');
assert.equal(one[0].payload.severity, 'flag');
assert.equal(one[0].confidence, 84, 'flag 置信 84');
assert.equal(one[0].payload.titleZh, 'tbr-zh'); assert.equal(one[0].payload.titleEn, 'tbr-en');
assert.match(String(one[0].payload.bodyZh), /依据 共识X/, 'body 带出处');
assert.match(String(one[0].payload.reason), /健康/, 'reason 供「为什么现在出现」');
assert.equal(one[0].id, 'health-tbr', 'id 稳定(供逐实例去重/冷却)');

// 高风险归一成 flag 词汇(供 window/action 统一分支)
const hi = healthFindingsToGuidanceEvents([], [score('bmi', 'high')]);
assert.equal(hi[0].payload.severity, 'flag', 'high 风险归一为 flag');
assert.equal(hi[0].id, 'health-risk-bmi');
// 中风险归一成 attention
const mod2 = healthFindingsToGuidanceEvents([], [score('gmi', 'moderate')]);
assert.equal(mod2[0].payload.severity, 'attention', 'moderate 风险归一为 attention');
assert.equal(mod2[0].confidence, 68);

// 红旗排前
const mixed = healthFindingsToGuidanceEvents([finding('att', 'attention'), finding('flag', 'flag')], []);
assert.equal(mixed[0].payload.severity, 'flag', '红旗必须排在可关注前');

// 最多 3 条
const many = healthFindingsToGuidanceEvents(
  [finding('f1', 'flag'), finding('f2', 'flag'), finding('a1', 'attention'), finding('a2', 'attention')],
  [score('r1', 'high'), score('r2', 'moderate')],
);
assert.equal(many.length, 3, '最多 3 条,避免 Today 变体检报告');
assert.ok(many.every((e) => e.payload.severity === 'flag'), '3 条应先占满红旗');

console.log('health-guidance-bridge: OK');
