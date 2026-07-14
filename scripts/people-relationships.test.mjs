/**
 * 行为契约:People 通讯录 → person 节点(人缘管理底料)+ 关系 tab demo 种子修复。
 * 锁死:buildRelationships 收 person 节点/人关系,但结构性关系(品牌架构/文档/包含/定义)
 * 不漏成假联系人(修 demo 种子误显示);runPeopleSync 拉 /api/portal/people 灌 person 节点、
 * 去重、并入 syncAllConnectors(源码级)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

// ── buildRelationships:demo 结构性关系不进联系人,真人/人关系进 ──
function loadRel() {
  const src = fs.readFileSync(new URL('../lib/portal/relationships.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Date, Map, RegExp,
    window: undefined,
    require: (p) => p.includes('storage-health') ? { reportStorageDropped: () => {} }
      // 批次 180:buildRelationships 现在会读关系覆盖(agent 关系重构),补 mock 供其调用
      : p.includes('relationship-overrides') ? { loadRelationshipOverrides: () => ({}), setRelationshipOverride: () => {} }
      : ({}),
  });
  return mod.exports;
}
const rel = loadRel();
const now = Date.parse('2026-07-08T00:00:00Z');

{
  const nodes = [
    // demo 种子:结构性关系,targetId 不是人 —— 不该进联系人
    { id: 'd1', type: 'object', name: 'Nesio 系统', createdAt: '2026-07-05', attributes: {}, relations: [{ targetId: '品牌架构', relation: '属于品牌架构' }] },
    { id: 'd2', type: 'document', name: 'Nesio 指南 1.0', createdAt: '2026-07-05', attributes: {}, relations: [{ targetId: '对象', relation: '文档定义对象' }] },
    // 真联系人:person 节点
    { id: 'p1', type: 'person', name: 'Linda', createdAt: '2026-06-01', attributes: { email: 'linda@x.com' }, relations: [] },
    // 真人关系:朋友
    { id: 'n1', type: 'note', name: '和 Bob 吃饭', createdAt: '2026-07-01', attributes: {}, relations: [{ targetId: 'Bob', relation: '朋友' }] },
  ];
  const contacts = rel.buildRelationships(nodes, now, {});
  const names = contacts.map((c) => c.name.toLowerCase());
  assert.ok(names.includes('linda'), 'person 节点进联系人');
  assert.ok(names.includes('bob'), '人关系(朋友)进联系人');
  assert.ok(!contacts.some((c) => c.key === '品牌架构' || c.name.includes('品牌架构')), '品牌架构结构关系不漏成联系人');
  assert.ok(!contacts.some((c) => c.key === '对象' || c.name === '对象'), '文档定义关系不漏成联系人');
  // Bob 标了朋友 → close
  assert.equal(contacts.find((c) => c.name === 'Bob')?.closeness, 'close', '朋友=亲近');
}

// ── 非人类发件人不进联系人:机器人/银行卡/机构通知(用户实测污染) ──
{
  const nodes = [
    { id: 'e1', type: 'note', source: 'email', name: 'PR review', createdAt: '2026-07-08', attributes: { from: 'vercel[bot] <notifications@github.com>', date: '2026-07-08' }, relations: [] },
    { id: 'e2', type: 'note', source: 'email', name: '账单', createdAt: '2026-07-08', attributes: { from: 'Platinum Card from American Express <AmericanExpress@welcome.aexp.com>', date: '2026-07-08' }, relations: [] },
    { id: 'e3', type: 'note', source: 'email', name: '提醒', createdAt: '2026-07-08', attributes: { from: 'Chase® Ink® <no.reply.alerts@chase.com>', date: '2026-07-08' }, relations: [] },
    { id: 'e4', type: 'note', source: 'email', name: 'support', createdAt: '2026-07-08', attributes: { from: 'support@acme.com', date: '2026-07-08' }, relations: [] },
    // 真人不该被误杀:即便姓 Chase(单词银行名是常见姓氏,不据此过滤)
    { id: 'p9', type: 'person', name: 'John Chase', source: 'system', createdAt: '2026-06-01', attributes: { email: 'john@personal.com' }, relations: [] },
  ];
  const contacts = rel.buildRelationships(nodes, now, {});
  const names = contacts.map((c) => c.name);
  assert.ok(!contacts.some((c) => /\[bot\]/.test(c.name)), '机器人发件人不进联系人');
  assert.ok(!contacts.some((c) => /American Express|Card/.test(c.name)), '银行卡发件人不进联系人');
  assert.ok(!contacts.some((c) => /®/.test(c.name)), '带商标符的机构不进联系人');
  assert.ok(!contacts.some((c) => c.key === 'support@acme.com'), '角色地址(support@)不进联系人');
  assert.ok(names.includes('John Chase'), '真人(姓 Chase)不被误杀');
}

// ── 公司邮件发件人不进联系人:公司名标记 + 陌生公司域;个人域/已知真人保留 ──
{
  const nodes = [
    // 公司名标记(用户实测:Calendar/Investments/.com)
    { id: 'c1', type: 'note', source: 'email', name: '日历', createdAt: '2026-07-08', attributes: { from: 'Calendar (Google Calendar) <calendar-notification@google.com>', date: '2026-07-08' }, relations: [] },
    { id: 'c2', type: 'note', source: 'email', name: '对账单', createdAt: '2026-07-08', attributes: { from: 'Fidelity Investments <alerts@fidelity.com>', date: '2026-07-08' }, relations: [] },
    { id: 'c3', type: 'note', source: 'email', name: '订单', createdAt: '2026-07-08', attributes: { from: 'Amazon.com <ship@amazon.com>', date: '2026-07-08' }, relations: [] },
    // 人名 + 陌生公司域 + 不在通讯录 → 不新建(公司刷不进人缘)
    { id: 'c4', type: 'note', source: 'email', name: 'x', createdAt: '2026-07-08', attributes: { from: 'Jane Roe <jane@fidelity.com>', date: '2026-07-08' }, relations: [] },
    // 真人 + 个人邮箱域 → 进联系人
    { id: 'c5', type: 'note', source: 'email', name: 'y', createdAt: '2026-07-08', attributes: { from: 'Emma Wu <emma@gmail.com>', date: '2026-07-08' }, relations: [] },
    // 已知真人(通讯录里)即便公司邮箱也保留富化
    { id: 'p8', type: 'person', name: 'Coworker Kim', source: 'system', createdAt: '2026-06-01', attributes: { email: 'kim@corp.com' }, relations: [] },
    { id: 'c6', type: 'note', source: 'email', name: 'z', createdAt: '2026-07-08', attributes: { from: 'Coworker Kim <kim@corp.com>', date: '2026-07-08' }, relations: [] },
  ];
  const contacts = rel.buildRelationships(nodes, now, {});
  const has = (frag) => contacts.some((c) => c.name.includes(frag) || c.key.includes(frag));
  assert.ok(!has('Calendar') && !has('google.com'), '日历通知不进联系人');
  assert.ok(!has('Fidelity') && !contacts.some((c) => c.key === 'alerts@fidelity.com'), '投资机构不进联系人');
  assert.ok(!has('Amazon'), '电商不进联系人');
  assert.ok(!contacts.some((c) => c.key === 'jane@fidelity.com'), '陌生人+公司域 不新建联系人');
  assert.ok(contacts.some((c) => c.key === 'emma@gmail.com'), '真人+个人邮箱域 进联系人');
  assert.ok(contacts.some((c) => c.name === 'Coworker Kim'), '已知真人(公司邮箱)保留');
}

// ── runPeopleSync:源码级(动态 import life-graph,vm 跑成本高) ──
const cs = fs.readFileSync(new URL('../lib/portal/providers/connector-sync.ts', import.meta.url), 'utf8');
assert.ok(/export async function runPeopleSync/.test(cs), 'runPeopleSync 存在');
assert.ok(cs.includes("fetch('/api/portal/people')"), '拉 People 路由');
assert.ok(cs.includes("res.status === 401") && cs.includes("'not_connected'"), '未连接可见');
assert.ok(cs.includes("type: 'person'") && cs.includes("source: 'system'") && cs.includes("'联系人'"), '灌 person 节点(source system + tag 联系人)');
assert.ok(cs.includes('byEmail') && cs.includes('byName') && cs.includes('updateLifeNode'), '按邮箱/名字去重、已存在则更新富化');
assert.ok(cs.includes("email ? attrs.email") || cs.includes('attrs.email = email'), 'email 落 attributes');
assert.ok(cs.includes('c.photo') && cs.includes('c.birthday'), '头像/生日落 attributes');
// 并入全源同步
assert.ok(/runPeopleSync\(\)/.test(cs) && cs.includes("id: 'people'"), 'runPeopleSync 并入 syncAllConnectors');
assert.ok(/'calendar' \| 'gmail' \| 'flomo' \| 'plaid' \| 'people'/.test(cs), 'SyncAllOutcome 含 people');

// ── ConnectorsHub 的 Google「同步」按钮也拉通讯录(用户从数据接入点同步的路径) ──
const hub = fs.readFileSync(new URL('../components/portal/ConnectorsHub.tsx', import.meta.url), 'utf8');
const syncGoogle = hub.slice(hub.indexOf('async function syncGoogle'), hub.indexOf('async function syncGoogle') + 6000);
assert.ok(syncGoogle.includes('runPeopleSync'), 'syncGoogle 调 runPeopleSync(数据接入同步含通讯录)');
assert.ok(syncGoogle.includes('通讯录'), 'syncGoogle 通讯录结果可见');
assert.ok(syncGoogle.includes('not_connected') && syncGoogle.includes('重新授权'), '通讯录缺权限提示重授权');

console.log('people-relationships: OK');
