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

// ── 英文样例(locale='en'):同样锁八域/幂等/关系完整 + 无杜撰人名 + 导览三条 ──
const en = sd.buildSampleNodes('en');
assert.ok(en.length >= 8, '英文样例至少八条');
for (const n of en) {
  assert.ok((n.tags || []).includes(sd.SAMPLE_TAG), `${n.name} 盖样例 tag`);
  assert.ok(typeof n.attributes?.externalId === 'string' && n.attributes.externalId.startsWith('sample-'), `${n.name} 带 sample- externalId`);
}
const enIds = en.map((n) => n.attributes.externalId);
assert.equal(new Set(enIds).size, enIds.length, '英文 externalId 无重复');
const enTypes = new Set(en.map((n) => n.type));
for (const ty of ['person', 'commitment', 'place', 'health_state']) assert.ok(enTypes.has(ty), `英文有 ${ty}`);
assert.ok(en.some((n) => n.source === 'email'), '英文有邮件来源');
assert.ok(en.some((n) => n.source === 'calendar'), '英文有日历来源');
const enPlace = en.find((n) => n.type === 'place');
assert.ok(typeof enPlace.attributes.lat === 'number' && typeof enPlace.attributes.lon === 'number', '英文位置带经纬度');
const enMood = en.find((n) => n.type === 'health_state');
assert.ok(enMood.attributes.emotion && enMood.attributes.emotionLabel, '英文心情带情绪标签');
assert.ok((enMood.tags || []).includes('feeling'), '英文心情带 feeling tag');
// 关系 targetId 落在英文样例人物内
const enPersonNames = new Set(en.filter((n) => n.type === 'person').map((n) => n.name));
for (const n of en) for (const r of n.relations || []) assert.ok(enPersonNames.has(r.targetId), `英文关系 targetId「${r.targetId}」是样例人物`);
// 不出现 Linda 这类杜撰人名(整份数据的名字/正文都不含)
const enBlob = JSON.stringify(en);
assert.ok(!/\blinda\b/i.test(enBlob), '英文样例不含 Linda');
// 导览三条(洞察页 / 头像进设置 / 提醒卡手势)都在
for (const id of ['sample-en-guide-insights', 'sample-en-guide-avatar', 'sample-en-guide-gestures']) {
  assert.ok(en.some((n) => n.attributes.externalId === id), `英文导览含 ${id}`);
}
// 内容确为英文(至少人物 Mom 是角色名,非中文姓名)
assert.ok(enPersonNames.has('Mom'), '英文人物用角色名 Mom');

console.log('sample-data: OK');
