/**
 * 行为契约:联系人分组(人缘㊃)。
 * 锁死:People 路由拉 memberships + join contactGroups.list → groups;识别 family 组补规范「家人」;
 * runPeopleSync 把 groups 并入 person 节点 tags;buildRelationships 把 tags(排除内部标记)透出成
 * Contact.groups;关系 tab 有分组筛选 chips + 家庭置顶 + 家人徽章。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

// ── buildRelationships:person 节点 tags → Contact.groups(排除「联系人」内部标记) ──
function loadRel() {
  const src = fs.readFileSync(new URL('../lib/portal/relationships.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Date, Map, Set, RegExp,
    window: undefined, require: (p) => (p.includes('storage-health') ? { reportStorageDropped: () => {} }
      : p.includes('relationship-overrides') ? { loadRelationshipOverrides: () => ({}), setRelationshipOverride: () => {} }
      : {}),
  });
  return mod.exports;
}
const rel = loadRel();
const now = Date.parse('2026-07-08T00:00:00Z');
{
  const nodes = [
    { id: 'p1', type: 'person', name: 'Mom', source: 'system', createdAt: '2026-06-01', attributes: { email: 'mom@gmail.com' }, tags: ['联系人', '家人', '同事'], relations: [] },
    { id: 'p2', type: 'person', name: 'Sam', source: 'system', createdAt: '2026-06-01', attributes: { email: 'sam@gmail.com' }, tags: ['联系人'], relations: [] },
  ];
  const contacts = rel.buildRelationships(nodes, now, {});
  const mom = contacts.find((c) => c.name === 'Mom');
  const sam = contacts.find((c) => c.name === 'Sam');
  assert.ok(mom.groups.includes('家人') && mom.groups.includes('同事'), '分组进 contact.groups');
  assert.ok(!mom.groups.includes('联系人'), '内部标记「联系人」不算分组');
  assert.equal(sam.groups.length, 0, '无分组 → 空数组');
}

// ── People 路由:memberships + contactGroups.list join + 家人规范化(源码级) ──
const route = fs.readFileSync(new URL('../app/api/portal/people/route.ts', import.meta.url), 'utf8');
assert.ok(/personFields=[^`'"]*memberships/.test(route), 'personFields 含 memberships');
assert.ok(route.includes('/contactGroups?'), 'join contactGroups.list 拿组名');
assert.ok(route.includes("'contactGroups/family'") && route.includes('家人'), '识别系统 family 组 → 补规范「家人」');
assert.ok(route.includes('groups'), '每人回 groups');
assert.ok(route.includes('myContacts') && route.includes('SKIP_GROUPS'), '泛系统组(全部联系人/加星标)不当分组');

// ── runPeopleSync:groups 并入 tags(去重合并) ──
const cs = fs.readFileSync(new URL('../lib/portal/providers/connector-sync.ts', import.meta.url), 'utf8');
assert.ok(cs.includes('c.groups'), 'People 同步读 groups');
assert.ok(cs.includes('mergedTags') || cs.includes('new Set([...'), 'groups 去重并入 person 节点 tags');

// ── 关系 tab:分组筛选 chips + 家庭置顶 + 家人徽章(源码级) ──
const panel = fs.readFileSync(new URL('../components/portal/relationships/RelationshipsPanel.tsx', import.meta.url), 'utf8');
assert.ok(panel.includes('nesio-rel-chips') && panel.includes('setActiveGroup'), '分组筛选 chips');
// 批次 180:agent 关系列表重构 —— 扁平 allGroups 换成 BUCKETS(桶)+「更多」原始组;筛选仍按 c.groups.includes(activeGroup)
assert.ok(panel.includes('BUCKETS') && panel.includes('c.groups.includes(activeGroup)'), '按选中组筛选(桶+原始组)');
// 批次 180:agent 重构 —— 家人识别从 FAMILY_RE 改为 BUCKETS 里的 family 桶正则 + buildFamilyDigest;
// FamilySummary 顶部摘要区不变(徽章从 👪 emoji 改为摘要区,去 emoji 设计)
assert.ok(panel.includes("id: 'family'") && panel.includes('buildFamilyDigest') && panel.includes('FamilySummary'), '家人桶 + 家人摘要区');

console.log('relationship-groups: OK');
