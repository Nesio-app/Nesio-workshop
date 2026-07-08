/**
 * 行为契约:物品②——CSV 批量导入。
 * 锁死:parseCsv(引号/双引号转义/引号内逗号换行/BOM);表头中英对照大小写
 * 不敏感;仅 Name 必填、缺名跳过并计数;Space+Bin 拼 location;$/千分位价格;
 * 标签多分隔符;无独立字段列(序列号/型号/条码/购买日期)并进备注不丢;
 * 缺 Name 列/空文件报错可见。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const nodes = [];
let seq = 0;
const lifeGraphStub = {
  getLifeGraph: () => nodes,
  addLifeNode: (n) => { const full = { ...n, id: `n${++seq}`, createdAt: '2026-07-01' }; nodes.push(full); return full; },
  updateLifeNode: () => true,
  deleteLifeNode: () => true,
};
function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, process: { env: {} }, console, Date, Math, Set, Map, JSON, Number, Array, Object, String });
  return mod.exports;
}
const inv = loadTs('../lib/portal/inventory.ts', (p) => (p.includes('life-graph') ? lifeGraphStub : ({})));
const imp = loadTs('../lib/portal/inventory-import.ts', (p) => (p === './inventory' ? inv : ({})));

// ── parseCsv:引号/转义/引号内逗号与换行/BOM ──
const csv = '﻿a,b,c\n"x,y","he said ""hi""","line1\nline2"\nplain,2,3';
const rows = imp.parseCsv(csv).map((r) => [...r]);
assert.deepEqual(rows[0], ['a', 'b', 'c'], 'BOM 剥离');
assert.deepEqual(rows[1], ['x,y', 'he said "hi"', 'line1\nline2'], '引号内逗号/双引号转义/换行');
assert.deepEqual(rows[2], ['plain', '2', '3']);

// ── 英文表头全字段 ──
nodes.length = 0;
const en = [
  'Name,Value,Category,Space,Bin,Tags,Quantity,Expires,Notes,Serial Number,Model Number,Barcode/UPC,Purchase Date',
  '"Lancome Toner","$1,234.56",Skincare,Bathroom,Cabinet A,"skincare, pink",2,2027-01-01,fragile,SN123,LT-400,012345678905,2026-06-15',
].join('\n');
let r = imp.importInventoryCsv(en);
assert.equal(r.imported, 1);
assert.equal(r.skipped, 0);
let item = inv.listInventoryItems()[0];
assert.equal(item.name, 'Lancome Toner');
assert.equal(item.price, 1234.56, '$ 与千分位剥离');
assert.equal(item.category, 'Skincare');
assert.equal(item.location, 'Bathroom · Cabinet A', 'Space+Bin 拼 location');
assert.equal(item.space, 'Bathroom');
assert.equal(item.container, 'Cabinet A');
assert.deepEqual([...item.tags], ['skincare', 'pink']);
assert.equal(item.quantity, 2);
assert.equal(item.expiry, '2027-01-01');
assert.ok(item.note.includes('fragile') && item.note.includes('SN SN123') && item.note.includes('型号 LT-400') && item.note.includes('条码 012345678905') && item.note.includes('购于 2026-06-15'), '无独立字段列并进备注不丢');

// ── 中文表头 + 缺名跳过 + 多分隔符标签 ──
nodes.length = 0;
const zh = [
  '名称,估值,分类,空间,容器,标签,数量',
  '维生素 D3,15,保健品,家,药箱,"补剂、日常",1',
  ',10,,,,,',
  '备用钥匙,,,玄关,,,',
].join('\n');
r = imp.importInventoryCsv(zh);
assert.equal(r.imported, 2, '中文表头可用');
assert.equal(r.skipped, 1, '缺名称行跳过并计数');
assert.ok(r.errors.some((e) => e.includes('第 3 行')), '错误样本带行号');
const items = inv.listInventoryItems();
assert.deepEqual([...items.find((i) => i.name.includes('维生素')).tags], ['补剂', '日常'], '顿号分隔标签');
assert.equal(items.find((i) => i.name === '备用钥匙').location, '玄关', '只有空间没有容器');

// ── 缺 Name 列 / 空文件:错误可见 ──
assert.ok(imp.importInventoryCsv('Value,Category\n1,x').errors[0].includes('Name'), '缺必填列报错');
assert.equal(imp.importInventoryCsv('Name\n').errors[0], '文件为空或只有表头');

// ── 客户端接线(源码级):导入入口 + 结果可见 ──
const sheet = fs.readFileSync(new URL('../components/portal/InventorySheet.tsx', import.meta.url), 'utf8');
assert.ok(sheet.includes('importInventoryCsv'), '导入入口接线');
assert.ok(sheet.includes('importMsg'), '导入结果可见展示(不静默)');

console.log('inventory-import: OK');
