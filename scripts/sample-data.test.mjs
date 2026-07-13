/**
 * 行为契约:冷启动样例数据(「先看看样例」)。
 * 锁死:buildSampleNodes 覆盖八域(人物/记忆/邮件/日历/提醒/位置/心情/回顾)、每条带
 * 稳定 externalId(幂等键)、统一盖「样例」tag(供一键清)、关系指向真实人物名。
 * 与游客 demo-seed 分家:样例走合法写入门、可清;demo 只读、写路径拒收。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function compile(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
function run(js, sandbox) {
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Date, RegExp, ...sandbox });
  return mod.exports;
}

// sample-data 只有 buildSampleNodes/hasSampleData 是纯逻辑;seed/clear 触碰 window 与
// life-graph,这里把 import 全 stub 成空,只测模板构造。
const sd = run(compile('../lib/portal/sample-data.ts'), {
  require: () => ({ getLifeGraph: () => [], deleteLifeNode: () => {}, ingestLifeNode: () => {} }),
  window: undefined,
});

const nodes = sd.buildSampleNodes();
assert.ok(nodes.length >= 8, '至少八条样例');

// 每条都带「样例」tag(一键清的锚点)+ 稳定 externalId(幂等键)
for (const n of nodes) {
  assert.ok((n.tags || []).includes(sd.SAMPLE_TAG), `${n.name} 盖样例 tag`);
  assert.ok(typeof n.attributes?.externalId === 'string' && n.attributes.externalId.startsWith('sample-'), `${n.name} 带 sample- externalId`);
}

// externalId 唯一(不自撞)
const ids = nodes.map((n) => n.attributes.externalId);
assert.equal(new Set(ids).size, ids.length, 'externalId 无重复');

// 八域覆盖
const types = new Set(nodes.map((n) => n.type));
assert.ok(types.has('person'), '有人物');
assert.ok(types.has('commitment'), '有提醒/承诺');
assert.ok(types.has('place'), '有位置');
assert.ok(types.has('health_state'), '有心情');
assert.ok(nodes.some((n) => n.source === 'email'), '有邮件来源');
assert.ok(nodes.some((n) => n.source === 'calendar'), '有日历来源');

// 位置带经纬度(足迹世界地图要用)
const cafe = nodes.find((n) => n.type === 'place');
assert.ok(typeof cafe.attributes.lat === 'number' && typeof cafe.attributes.lon === 'number', '位置带经纬度');

// 心情带情绪语义(今天页第一拍/洞察情绪)
const mood = nodes.find((n) => n.type === 'health_state');
assert.ok(mood.attributes.emotion && mood.attributes.emotionLabel, '心情带情绪标签');
assert.ok((mood.tags || []).includes('feeling'), '心情带 feeling tag');

// 关系指向真实人名(攒关系热度),且这些人名都在样例人物里
const personNames = new Set(nodes.filter((n) => n.type === 'person').map((n) => n.name));
for (const n of nodes) {
  for (const r of n.relations || []) {
    assert.ok(personNames.has(r.targetId), `关系 targetId「${r.targetId}」是样例人物`);
  }
}

// hasSampleData:按 tag 判定
assert.equal(sd.hasSampleData([{ tags: ['样例'] }]), true, 'hasSampleData 命中');
assert.equal(sd.hasSampleData([{ tags: ['别的'] }]), false, 'hasSampleData 不误判');
assert.equal(sd.hasSampleData([]), false, 'hasSampleData 空库为假');

console.log('sample-data: OK');
