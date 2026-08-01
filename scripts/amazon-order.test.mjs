/**
 * 行为契约:亚马逊订单截图 → 一条物品(consolidateAmazonOrder)。
 * 锁死:识别拆成多条(总计/税费/税前总计/订单号)也能合并成 ONE 产品节点,
 * 订单号/买入价/税/商家/日期归位,打「亚马逊」标签;税前缺失时可反推。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, Date, Math, Number, Array, Object, String, RegExp, parseFloat });
  return mod.exports;
}
const { consolidateAmazonOrder, parseOrderDate } = loadTs('../lib/portal/amazon-order.ts');

// ── 用户实测 IMG_9228:一张亚马逊订单被拆成 5 条 ──
const split = [
  { type: 'note', name: '总计 $127.62', attributes: {} },
  { type: 'note', name: '预估税费 $8.63', attributes: {} },
  { type: 'note', name: '税前总计 $118.99', attributes: {} },
  { type: 'note', name: '订单号 112-4313914-7678611', attributes: {} },
  { type: 'Thing', name: 'ALPHA CAMP 20 Inch', attributes: {} },
];
const c = consolidateAmazonOrder(split, 'Sold by: Makun\nOrder placed July 23, 2026');
assert.equal(c.name, 'ALPHA CAMP 20 Inch', '产品名取 object 节点');
assert.equal(c.type, 'Thing');
assert.deepEqual([...c.tags], ['亚马逊'], '打亚马逊标签');
assert.equal(c.attributes.orderNo, '112-4313914-7678611', '订单号');
assert.equal(c.attributes.buyPrice, 118.99, '买入价 = 税前总计');
assert.equal(c.attributes.tax, 8.63, '税');
assert.equal(c.attributes.seller, 'Makun', '商家 Sold by');
assert.equal(c.attributes.orderedAt, '2026-07-23', '下单日 July 23, 2026');

// ── 税前缺失 → 用总计 − 税反推 ──
const noSub = [
  { type: 'Thing', name: '钛双面案板', attributes: {} },
  { type: 'note', name: '总计 $40.00', attributes: {} },
  { type: 'note', name: '税费 $2.40', attributes: {} },
];
const c2 = consolidateAmazonOrder(noSub);
assert.equal(c2.attributes.buyPrice, 37.6, '反推税前 = 40 − 2.4');
assert.equal(c2.attributes.tax, 2.4);

// ── 模型已经只返一条(带结构化 attributes)也照收 ──
const clean = [{ type: 'Thing', name: 'Storage Stool', attributes: { orderNo: '112-0000000-0000000', buyPrice: 38.6, seller: 'Makun' } }];
const c3 = consolidateAmazonOrder(clean);
assert.equal(c3.name, 'Storage Stool');
assert.equal(c3.attributes.buyPrice, 38.6);
assert.equal(c3.attributes.orderNo, '112-0000000-0000000');

// ── 日期解析 ──
assert.equal(parseOrderDate('July 23, 2026'), '2026-07-23');
assert.equal(parseOrderDate('2026-07-05'), '2026-07-05');
assert.equal(parseOrderDate('7月5日', 2026), '2026-07-05');
assert.equal(parseOrderDate('乱码'), '');

console.log('amazon-order: OK');
