/**
 * 行为契约:家庭汇总(人缘㊅)。
 * 锁死:buildFamilyDigest 把家庭成员(家人分组/核心亲疏)挂的分类数据汇成 每成员计数 +
 * 合并近期动态(倒序);非家庭不计;只含挂了数据的成员。关系 tab 顶部渲染 FamilySummary。
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Date, RegExp, Map, Set, ...sandbox });
  return mod.exports;
}

const store = {};
const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
const pr = run(compile('../lib/portal/person-records.ts'), {
  localStorage, window: win, CustomEvent: class { constructor(t) { this.type = t; } },
  require: (p) => (p.includes('storage-health') ? { reportStorageDropped: () => {} } : {}),
});
const fd = run(compile('../lib/portal/family-digest.ts'), {
  require: (p) => (p.endsWith('person-records') ? pr : {}),
});

const C = (key, name, closeness, groups = []) => ({ key, name, relation: null, closeness, mentions: 1, lastContactAt: null, daysSince: null, cadenceDays: 14, reachOut: false, overdueRatio: 1, groups });

// 家人:妹妹(核心)+ 爸(家人分组);非家人:同事
pr.addPersonRecord({ personKey: 'mei', category: 'achievement', title: '年级第一', date: '2026-06-02' });
pr.addPersonRecord({ personKey: 'mei', category: 'health', title: '体检正常', date: '2026-06-20' });
pr.addPersonRecord({ personKey: 'dad', category: 'medical', title: '复诊', date: '2026-07-01' });
pr.addPersonRecord({ personKey: 'coworker', category: 'spending', title: '午饭', amount: 30, date: '2026-07-05' });

const contacts = [
  C('mei', '小妹', 'core'),
  C('dad', '爸爸', 'acquaintance', ['家人']),
  C('coworker', '老王', 'acquaintance', ['同事']),
];
const digest = fd.buildFamilyDigest(contacts);

const memberKeys = digest.members.map((m) => m.key);
assert.ok(memberKeys.includes('mei') && memberKeys.includes('dad'), '家庭成员(核心/家人分组)进汇总');
assert.ok(!memberKeys.includes('coworker'), '非家庭不进汇总');
const mei = digest.members.find((m) => m.key === 'mei');
assert.equal(mei.total, 2, '小妹两条');
assert.equal(mei.counts.achievement, 1); assert.equal(mei.counts.health, 1);

// 近期动态:只含家庭、倒序、非家庭排除
assert.ok(!digest.recent.some((r) => r.personKey === 'coworker'), '近期动态排除非家庭');
assert.equal(digest.recent[0].record.personKey || digest.recent[0].personKey, 'dad', '最新在前(7-01 复诊)');
assert.ok(digest.recent.every((r, i, a) => i === 0 || (a[i - 1].record.date || '') >= (r.record.date || '')), '倒序');

// 无数据成员不显示
assert.ok(digest.members.every((m) => m.total > 0), '只含挂了数据的成员');

// ── 源码级:关系 tab 顶部渲染家庭汇总 ──
const panel = fs.readFileSync(new URL('../components/portal/relationships/RelationshipsPanel.tsx', import.meta.url), 'utf8');
assert.ok(panel.includes('buildFamilyDigest') && panel.includes('<FamilySummary'), '关系 tab 渲染家庭汇总');
assert.ok(panel.includes("'nesio-person-records-updated'"), '挂数据后汇总刷新');

console.log('family-digest: OK');
