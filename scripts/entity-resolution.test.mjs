/**
 * 行为契约:实体解析(数据审计 #4 —— 同一实体跨记录收敛 + 别名归一)。
 * 锁死:
 *  - normalizeEntityKey:大小写 / 首尾空白 / 内部多空白 / 全角 / 首尾引号 都收敛。
 *  - resolveEntityKey:顺别名表跳到规范键,带环保护。
 *  - buildRelationships:同一人不同写法(Linda / linda / LINDA / 全角)收敛成一个联系人。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function compile(path, requireImpl, extraGlobals = {}) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: requireImpl, console,
    Date, Math, JSON, Number, Array, Object, String, Set, Map, RegExp, Buffer,
    window: undefined, ...extraGlobals,
  });
  return mod.exports;
}

const er = compile('../lib/portal/entity-resolution.ts', () => ({}));

// ── 规范化收敛 ──
assert.equal(er.normalizeEntityKey('  Linda  '), 'linda', '首尾空白 + 大小写');
assert.equal(er.normalizeEntityKey('A   B'), 'a b', '内部多空白折叠');
assert.equal(er.normalizeEntityKey('Ｌｉｎｄａ'), 'linda', '全角→半角(NFKC)');
assert.equal(er.normalizeEntityKey('“Mom”'), 'mom', '去首尾引号');
assert.equal(er.normalizeEntityKey('「妈妈」'), '妈妈', '去书名号/引号(中文)');

// ── 别名解析 + 环保护 ──
assert.equal(er.resolveEntityKey('母亲', { '母亲': '妈妈' }), '妈妈', '别名跳转');
assert.ok(['a', 'b'].includes(er.resolveEntityKey('a', { a: 'b', b: 'a' })), '环不死循环(到访即停,不 hang)');
assert.equal(er.resolveEntityKey('Linda', {}), 'linda', '无别名 = 纯规范化');

// ── buildRelationships:同一人不同写法收敛成一个联系人 ──
const rel = compile('../lib/portal/relationships.ts', (p) =>
  p.includes('storage-health') ? { reportStorageDropped: () => {} }
  : p.includes('relationship-overrides') ? { loadRelationshipOverrides: () => ({}) }
  : p.includes('entity-resolution') ? er     // 用真实实体解析
  : ({}));

const nodes = [
  { type: 'note', name: 'n1', source: 'manual', createdAt: '2026-07-01', relations: [{ targetId: 'Linda', relation: '朋友' }] },
  { type: 'note', name: 'n2', source: 'manual', createdAt: '2026-07-02', relations: [{ targetId: 'linda ', relation: '朋友' }] },
  { type: 'note', name: 'n3', source: 'manual', createdAt: '2026-07-03', relations: [{ targetId: 'LINDA', relation: '朋友' }] },
  { type: 'note', name: 'n4', source: 'manual', createdAt: '2026-07-04', relations: [{ targetId: 'Ｌｉｎｄａ', relation: '朋友' }] },
];
const contacts = rel.buildRelationships(nodes, Date.parse('2026-07-10'));
const linda = contacts.filter((c) => c.key === 'linda');
assert.equal(linda.length, 1, '四种写法收敛成一个联系人(不是四个)');
assert.equal(linda[0].mentions, 4, '四次提及都归到同一人');

console.log('entity-resolution: OK');
