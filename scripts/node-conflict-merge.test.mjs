/**
 * 行为契约:生活图谱节点冲突合并(数据审计#3 收尾,批次209)。
 * 锁死:
 *  - 按 attributes.updatedAt(缺失退 createdAt)取新者的标量字段;
 *  - **attributes 两侧并集** —— 较旧侧独有属性键不丢(修「并发加不同属性静默丢一侧」);
 *  - **tags 两侧并集去重**;
 *  - 共有键由新者赢。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/life-node-merge.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), String, Object, Array, Set, Date });
const { mergeConflictingNodes, nodeStamp } = mod.exports;

const A = {
  id: 'n1', type: 'object', name: 'A名', source: 'manual', createdAt: '2026-07-01T00:00:00.000Z',
  tags: ['共有', 'A标签'], relations: [],
  attributes: { updatedAt: '2026-07-05T00:00:00.000Z', shared: 'A值', expiry: '2027-01-01' },
};
const B = {
  id: 'n1', type: 'object', name: 'B名', source: 'manual', createdAt: '2026-07-01T00:00:00.000Z',
  tags: ['共有', 'B标签'], relations: [],
  attributes: { updatedAt: '2026-07-09T00:00:00.000Z', shared: 'B值', location: '北京' },
};

// B 较新(updatedAt 09 > 05)→ B 赢标量
const m = mergeConflictingNodes(A, B);
assert.equal(m.name, 'B名', '新者(B)赢标量字段 name');
assert.equal(m.attributes.shared, 'B值', '共有属性键新者赢');
// 关键:两侧独有属性都在(核心修复)
assert.equal(m.attributes.expiry, '2027-01-01', '较旧侧(A)独有属性 expiry 不丢 ← 核心修复');
assert.equal(m.attributes.location, '北京', '较新侧(B)独有属性 location 在');
// tags 并集去重
assert.deepEqual([...m.tags].sort(), ['A标签', 'B标签', '共有'], 'tags 两侧并集去重');

// 对称:交换入参,结果一致(合并与顺序无关,新者恒赢)
const m2 = mergeConflictingNodes(B, A);
assert.equal(m2.name, 'B名', '交换入参仍是新者 B 赢(与顺序无关)');
assert.equal(m2.attributes.expiry, '2027-01-01', '交换入参 A 独有属性仍不丢');

// nodeStamp:updatedAt 优先,缺失退 createdAt
assert.equal(nodeStamp(A), '2026-07-05T00:00:00.000Z', 'nodeStamp 取 attributes.updatedAt');
assert.equal(
  nodeStamp({ id: 'x', createdAt: '2026-01-01T00:00:00.000Z', attributes: {} }),
  '2026-01-01T00:00:00.000Z',
  'nodeStamp 无 updatedAt → 退 createdAt',
);

console.log('node-conflict-merge: OK');
