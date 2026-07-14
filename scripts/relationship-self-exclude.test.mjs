/**
 * 行为契约:关系提取的数据质量门 —— 账户本人不进联系人、一次性会议与会人降噪。
 * 修用户实机反馈:自己的 hanbing6228+cc 被当成联系人;路人与会人被升成关系。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadRel() {
  const src = fs.readFileSync(new URL('../lib/portal/relationships.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Date, Map, Set, RegExp,
    window: undefined,
    require: (p) => p.includes('storage-health') ? { reportStorageDropped: () => {} }
      : p.includes('relationship-overrides') ? { loadRelationshipOverrides: () => ({}) }
      : ({}),
  });
  return mod.exports;
}
const rel = loadRel();
const now = Date.parse('2026-07-08T00:00:00Z');

// normalizeEmail:+别名 / gmail 点号归一
{
  assert.equal(rel.normalizeEmail('hanbing6228+cc@gmail.com'), 'hanbing6228@gmail.com', '去 +别名');
  assert.equal(rel.normalizeEmail('han.bing.6228@gmail.com'), 'hanbing6228@gmail.com', 'gmail 去点号');
  assert.equal(rel.normalizeEmail('a+x@outlook.com'), 'a@outlook.com', '非 gmail 也去 +别名、留点号');
}

// 账户本人(邮箱各种别名 + 名字)不进联系人
{
  const nodes = [
    { id: 'p1', type: 'person', name: '我自己', createdAt: '2026-07-01', attributes: { email: 'hanbing6228+cc@gmail.com' }, relations: [] },
    { id: 'e1', type: 'note', name: '抄送给自己', source: 'email', createdAt: '2026-07-02', attributes: { from: 'Han Bing <han.bing.6228@gmail.com>', date: '2026-07-02' }, relations: [] },
    { id: 'p2', type: 'person', name: 'Linda', createdAt: '2026-06-01', attributes: { email: 'linda@x.com' }, relations: [] },
  ];
  const self = { emails: ['hanbing6228@gmail.com'], names: ['我自己'] };
  const contacts = rel.buildRelationships(nodes, now, {}, self);
  const names = contacts.map((c) => c.name.toLowerCase());
  assert.ok(!contacts.some((c) => rel.normalizeEmail(c.key).includes('hanbing6228')), '本人邮箱(+别名/点号)不进联系人');
  assert.ok(!names.includes('我自己'), '本人名字不进联系人');
  assert.ok(names.includes('linda'), '别人照常进');
}

// 一次性会议与会人降噪:只当过一次 participant、无分组无记录 → 不列入
{
  const nodes = [
    { id: 'm1', type: 'event', name: '周会', createdAt: '2026-07-03', attributes: {}, relations: [{ targetId: 'Julia Vassallo', relation: 'participant' }] },
    // 多次出现的与会人 → 保留(不是路人)
    { id: 'm2', type: 'event', name: '项目会', createdAt: '2026-07-04', attributes: {}, relations: [{ targetId: 'Mark', relation: 'participant' }] },
    { id: 'm3', type: 'event', name: '复盘', createdAt: '2026-07-05', attributes: {}, relations: [{ targetId: 'Mark', relation: 'participant' }] },
  ];
  const contacts = rel.buildRelationships(nodes, now, {});
  const names = contacts.map((c) => c.name.toLowerCase());
  assert.ok(!names.includes('julia vassallo'), '一次性与会人不列入');
  assert.ok(names.includes('mark'), '多次与会人保留');
}

console.log('relationship-self-exclude: OK');
