/**
 * 行为契约:一次性自愈(2026-07-29)。
 *
 * 两条都必须**保守** —— 自愈跑在用户真数据上,误删不可逆:
 *  ① 同 emailId 多条 → 只删「不是最早那条」;
 *  ② 无 emailId 的邮件节点 → **仅当**存在同名且带 emailId 的正主时才删。
 *     老同步遗留的、没有正主的无 id 节点必须留着(宁可冗余,不误删)。
 * 另钉:已拆模块(cooling/ranker/llm-sweep/润色)的孤儿 key 要被清掉;
 *      按设备的簿记 key 不得当用户数据同步上云。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN });
  return mod.exports;
}

const H = loadTs('../lib/portal/storage-heal.ts');

const n = (id, name, createdAt, emailId) => ({
  id, name, source: 'email', createdAt,
  attributes: emailId ? { emailId } : {},
});

// ① 同 emailId → 保最早
let plan = H.planEmailDedup([
  n('a', '订单已发货', '2026-07-01T00:00:00Z', 'm1'),
  n('b', '订单已发货', '2026-07-02T00:00:00Z', 'm1'),
  n('c', '订单已发货', '2026-07-03T00:00:00Z', 'm1'),
]);
assert.deepEqual([...plan.dupIds].sort().join(','), 'b,c', '同 emailId 只保最早那条');
assert.equal(plan.orphanIds.length, 0);

// ② 无 emailId + 有同名正主 → 判为富化孤儿
plan = H.planEmailDedup([
  n('real', '会议纪要', '2026-07-01T00:00:00Z', 'm9'),
  n('orphan', '会议纪要', '2026-07-02T00:00:00Z', null),
]);
assert.deepEqual(plan.orphanIds, ['orphan'], '有正主的无 id 副本才删');

// ② 反例:无 emailId 且**没有**同名正主 → 必须留(老同步的真数据)
plan = H.planEmailDedup([
  n('legacy', '很久以前的邮件', '2025-01-01T00:00:00Z', null),
  n('other', '别的邮件', '2026-07-01T00:00:00Z', 'm3'),
]);
assert.equal(plan.orphanIds.length, 0, '没有同名正主的无 id 邮件节点不许删 —— 宁可冗余不误删');
assert.equal(plan.dupIds.length, 0);

// 非邮件节点一律不碰
plan = H.planEmailDedup([
  { id: 'cal1', name: '周会', source: 'calendar', createdAt: '2026-07-01T00:00:00Z', attributes: {} },
  { id: 'cal2', name: '周会', source: 'calendar', createdAt: '2026-07-02T00:00:00Z', attributes: {} },
]);
assert.equal(plan.dupIds.length + plan.orphanIds.length, 0, '自愈只管邮件节点,不碰日历/记忆');

// ── 接线与孤儿 key ──
const src = fs.readFileSync(new URL('../lib/portal/storage-heal.ts', import.meta.url), 'utf8');
for (const dead of ['nesio-guidance-cooling', 'nesio-guidance-ranker-v1', 'nesio-ranker-trainlog-v1', 'nesio-llm-sweep-ledger-v1', 'nesio-guidance-lang-cache-v1']) {
  assert.ok(src.includes(dead), `已拆模块的孤儿 key ${dead} 要被清掉`);
}
assert.match(src, /nesio-storage-heal-v1/, '自愈必须幂等(完成标记)');

const portal = fs.readFileSync(new URL('../components/portal/Portal.tsx', import.meta.url), 'utf8');
assert.match(portal, /runStorageHealOnce\(\)/, '自愈要在 Portal 空闲时跑一次');
assert.match(portal, /whenIdle\(\(\) => \{ void import\('@\/lib\/portal\/storage-heal'\)/, '自愈走 whenIdle,不阻塞首屏');

// ── 按设备的簿记不得当用户数据同步 ──
const manifest = fs.readFileSync(new URL('../lib/portal/storage-manifest.ts', import.meta.url), 'utf8');
for (const perDevice of ['nesio-guidance-judge-ledger-v1', 'nesio-judge-dismissed-v1', 'nesio-push-enabled-v1', 'nesio-card-archive-v1']) {
  assert.ok(manifest.includes(perDevice), `${perDevice} 必须登记进 CACHE_KEYS(按设备簿记,整键 replace 会两端互抹)`);
}
// 反面:用户的静音裁决必须**留在 durable**(跨端跟人走)
assert.ok(!manifest.includes("'nesio-card-verdict-v1'"), '静音裁决是用户承诺,必须 durable 跨端同步,不能进 CACHE_KEYS');

console.log('storage-heal: OK(同 id 保最早 / 只删有正主的孤儿 / 不碰非邮件 / 孤儿 key 清理 / 簿记不上云)');
