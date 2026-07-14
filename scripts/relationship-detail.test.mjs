/**
 * 行为契约:人物详情页(人缘㊁)。
 * 锁死:buildPersonProfile 从 life-graph 汇出一个人的档案 —— 联系人状态(亲疏/该联系)、
 * 头像(自定义上传优先于 Google 照片)、家庭判定、时间线、ego 关系网;找不到返回 null。
 * 并源码级锁死:关系 tab 卡片点开详情 sheet;详情 sheet 读 buildPersonProfile、可上传头像、复用 RelationGraph。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function compile(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
function run(js, requireShim) {
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Date, Map, Set, RegExp,
    window: undefined, require: requireShim,
  });
  return mod.exports;
}

const storageHealth = { reportStorageDropped() {} };
const relationships = run(compile('../lib/portal/relationships.ts'), (p) => (p.includes('storage-health') ? storageHealth : p.includes('relationship-overrides') ? { loadRelationshipOverrides: () => ({}) } : {}));
const profileMod = run(compile('../lib/portal/relationship-profile.ts'), (p) => (p.endsWith('relationships') ? relationships : {}));
const { buildPersonProfile } = profileMod;
assert.equal(typeof buildPersonProfile, 'function', 'buildPersonProfile 导出');

const now = Date.parse('2026-07-08T00:00:00Z');

// ── 家庭成员档案:头像优先自定义、家庭判定、ego、时间线 ──
{
  const nodes = [
    { id: 'p-mia', type: 'person', name: 'Mia', source: 'system', createdAt: '2026-06-01T00:00:00Z',
      attributes: { photo: 'http://photo', avatar: 'data:image/jpeg;base64,AAA', birthday: '--07-12', email: 'mia@x.com' },
      tags: ['联系人', '家人'], relations: [{ targetId: 'Leo', relation: '哥哥' }] },
    { id: 'n1', type: 'note', name: '和 Mia 吃饭', source: 'manual', createdAt: '2026-07-01T00:00:00Z', attributes: {}, relations: [{ targetId: 'Mia', relation: '妹妹' }] },
  ];
  const p = buildPersonProfile(nodes, 'mia', now, {});
  assert.ok(p, '有联系人档案');
  assert.equal(p.nodeId, 'p-mia', '对应 person 节点');
  assert.equal(p.avatar, 'data:image/jpeg;base64,AAA', '自定义头像');
  assert.equal(p.photo, 'http://photo', 'Google 照片保留(UI 里自定义优先)');
  assert.equal(p.contact?.closeness, 'core', '关系词妹妹 → 核心');
  assert.equal(p.isFamily, true, '家庭成员判定');
  assert.equal(p.birthday, '--07-12', '生日带出');
  assert.ok(p.ego.nodes.length >= 2, 'ego 含中心 + 邻居');
  assert.ok(p.ego.nodes[0].id === 'p-mia', 'ego 中心是本人');
  assert.ok(p.timeline.length >= 1, '时间线非空');
}

// ── 无自定义头像时 photo 兜底(avatar undefined) ──
{
  const nodes = [
    { id: 'p2', type: 'person', name: 'Sam', source: 'system', createdAt: '2026-06-01T00:00:00Z', attributes: { photo: 'http://p2' }, tags: ['联系人'], relations: [] },
  ];
  const p = buildPersonProfile(nodes, 'sam', now, {});
  assert.ok(p, '有档案');
  assert.equal(p.avatar, undefined, '无自定义头像');
  assert.equal(p.photo, 'http://p2', 'photo 兜底可用');
  assert.equal(p.isFamily, false, '非家庭');
}

// ── 找不到线索 → null ──
assert.equal(buildPersonProfile([{ id: 'x', type: 'person', name: 'A', source: 'system', createdAt: '2026-01-01', attributes: {}, relations: [] }], 'nobody', now, {}), null, '未知 key → null');

// ── 源码级:关系 tab 点开详情 + 详情 sheet 接线 ──
const panel = fs.readFileSync(new URL('../components/portal/relationships/RelationshipsPanel.tsx', import.meta.url), 'utf8');
assert.ok(panel.includes("import RelationshipDetailSheet"), '关系 tab 引入详情 sheet');
assert.ok(panel.includes('setOpenKey(c.key)') && panel.includes('<RelationshipDetailSheet'), '卡片点开 + 渲染详情');

const sheet = fs.readFileSync(new URL('../components/portal/relationships/RelationshipDetailSheet.tsx', import.meta.url), 'utf8');
assert.ok(sheet.includes('buildPersonProfile'), '详情 sheet 读后台档案(非现算)');
assert.ok(sheet.includes('updateLifeNode') && sheet.includes('addLifeNode') && sheet.includes('avatar'), '可上传头像(有节点则富化、无则建)');
assert.ok(sheet.includes('RelationGraph'), '复用关系图组件');
assert.ok(sheet.includes('markContacted'), '详情里可「联系过了」');

console.log('relationship-detail: OK');
