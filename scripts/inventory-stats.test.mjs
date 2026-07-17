/**
 * 行为契约:物品①③④⑥——分类/标签/估值字段 + 库存统计 + 卖闲置堆 + 容器 + 转卖文案。
 * 锁死:字段写读回路(add/update/清空);标签与域标「收纳」隔离;统计口径
 * (数量计入件数与估值、容器按空间+容器去重、未分类归桶、分类降序、Top 标签封顶);
 * 物品变容器回路(containedCount 跨物品计数、解除容器不动已放进去的物品);
 * 转卖文案模板(名称/价格/数量齐全、无 undefined 漏字)。
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
  updateLifeNode: (id, patch) => { const i = nodes.findIndex((x) => x.id === id); if (i < 0) return false; nodes[i] = { ...nodes[i], ...patch }; return true; },
  deleteLifeNode: (id) => { const i = nodes.findIndex((x) => x.id === id); if (i < 0) return false; nodes.splice(i, 1); return true; },
};
function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, process: { env: {} }, console, Date, Math, Set, Map, JSON, Number, Array, Object, String });
  return mod.exports;
}
const inv = loadTs('../lib/portal/inventory.ts', (p) => (
  p.includes('life-graph') ? lifeGraphStub
  // 批次192:inventory 现在从 named-places 引 displayStoredLocation(placeId 解析);测试用字符串样例,回退 location。
  : p.includes('named-places') ? { displayStoredLocation: (a) => (a && typeof a.location === 'string' ? a.location : '') }
  : ({})));

// ── 字段回路:add → 投影 → update → 清空 ──
const n1 = inv.addInventoryItem({ name: 'Lancome Toner', location: '🏠 家 · 卫生间', category: '护肤', tags: ['skincare', 'pink', '收纳'], price: 55, quantity: 1 });
let item = inv.listInventoryItems().find((i) => i.id === n1.id);
assert.equal(item.category, '护肤');
assert.deepEqual([...item.tags], ['skincare', 'pink'], '域标「收纳」不混进物品标签');
assert.equal(item.price, 55);
assert.ok(n1.tags.includes('收纳'), 'node.tags 仍带域标(记忆检索用)');
inv.updateInventoryItem(n1.id, { category: '', tags: ['gift'], price: null });
item = inv.listInventoryItems().find((i) => i.id === n1.id);
assert.equal(item.category, '', '清空分类');
assert.deepEqual([...item.tags], ['gift'], '标签整体替换');
assert.equal(item.price, null, '清空估值');

// ── 统计口径 ──
nodes.length = 0; seq = 0;
inv.addInventoryItem({ name: 'A', location: '家 · 卧室 · 衣柜', category: '衣物', price: 20, quantity: 3, tags: ['冬装'] });
inv.addInventoryItem({ name: 'B', location: '家 · 卧室 · 抽屉', category: '衣物', price: 10, tags: ['冬装', '袜子'] });
inv.addInventoryItem({ name: 'C', location: '车库', tags: [] });                       // 未分类、无容器、无价
inv.addInventoryItem({ name: 'D', location: '家 · 卧室 · 衣柜', category: '电子', price: 100 });
const st = inv.inventoryStats(inv.listInventoryItems());
assert.equal(st.spaces, 2, '空间:家/车库');
assert.equal(st.containers, 2, '容器:卧室衣柜与卧室抽屉…按空间+容器去重');
assert.equal(st.count, 6, '件数含数量(3+1+1+1)');
assert.equal(st.totalValue, 170, '估值 = 20×3 + 10 + 100(无价不计)');
assert.equal(st.byCategory[0].category, '衣物', '分类计数降序');
assert.equal(st.byCategory[0].count, 4, '分类计数含数量');
assert.ok(st.byCategory.some((c) => c.category === '未分类'), '未分类归桶');
assert.equal(st.topTags[0].tag, '冬装', 'Top 标签按出现物品数降序');
assert.equal(st.topTags[0].count, 2);
// 空库
assert.equal(inv.inventoryStats([]).count, 0);
assert.equal(inv.inventoryStats([]).totalValue, 0);

// ── 物品③:卖闲置堆 ──
nodes.length = 0; seq = 0;
const s1 = inv.addInventoryItem({ name: '旧相机', price: 130, forSale: true });
inv.addInventoryItem({ name: '闲置包', price: 65, quantity: 2, forSale: true });
inv.addInventoryItem({ name: '不卖的', price: 999 });
inv.addInventoryItem({ name: '没估值的', forSale: true });
let pile = inv.sellPile(inv.listInventoryItems());
assert.equal(pile.items.length, 3, '只收标记出售的');
assert.equal(pile.totalValue, 260, '合计 = 130 + 65×2(无价不计)');
assert.equal(pile.items[0].name, '旧相机', '按估值(价×量)降序…');
assert.equal(pile.items[2].name, '没估值的', '…无价在最后');
inv.updateInventoryItem(s1.id, { forSale: false });
pile = inv.sellPile(inv.listInventoryItems());
assert.equal(pile.items.length, 2, '取消出售即移出卖堆');
assert.equal(pile.totalValue, 130);

// ── 物品④:变容器回路 + containedCount + 解绑不动内容物 ──
nodes.length = 0; seq = 0;
const box = inv.addInventoryItem({ name: '宜家收纳箱', location: '家 · 车库' });
inv.addInventoryItem({ name: '滑雪手套', location: '家 · 宜家收纳箱' });
inv.addInventoryItem({ name: '头盔', location: '车库 · 宜家收纳箱' });
inv.addInventoryItem({ name: '无关物品', location: '家 · 抽屉' });
let boxItem = inv.listInventoryItems().find((i) => i.id === box.id);
assert.equal(boxItem.isContainer, false, '默认不是容器');
inv.updateInventoryItem(box.id, { isContainer: true });
boxItem = inv.listInventoryItems().find((i) => i.id === box.id);
assert.equal(boxItem.isContainer, true, '变成容器');
assert.equal(boxItem.containedCount, 2, '装了几件 = 其他物品容器段命中该物品名(跨空间也算)');
inv.updateInventoryItem(box.id, { isContainer: false });
const after = inv.listInventoryItems();
assert.equal(after.find((i) => i.id === box.id).isContainer, false, '解除容器');
assert.equal(after.find((i) => i.name === '滑雪手套').location, '家 · 宜家收纳箱', '解绑不动已放进去的物品');

// ── 物品⑥:转卖文案模板 ──
{
  const t = inv.buildListingText({ name: '旧相机', quantity: 2, price: 130, category: '电子', tags: ['胶片', '复古'], note: '快门正常', location: '', space: '', container: '', hasPhoto: false, forSale: true, isContainer: false, containedCount: 0, id: 'x' });
  assert.ok(t.includes('旧相机') && t.includes('×2') && t.includes('130'), '名称/数量/价格齐全');
  assert.ok(t.includes('电子') && t.includes('#胶片') && t.includes('快门正常'), '分类/标签/备注带上');
  assert.ok(!t.includes('undefined') && !t.includes('null'), '无漏字');
  const noPrice = inv.buildListingText({ name: '闲置包', tags: [], location: '', space: '', container: '', hasPhoto: false, forSale: true, isContainer: false, containedCount: 0, id: 'y' });
  assert.ok(noPrice.includes('价格私聊'), '无价降级为面议');
  assert.ok(!noPrice.includes('×'), '数量 1 不显示');
}

// ── 客户端接线(源码级):统计视图 + 表单三字段 ──
const sheet = fs.readFileSync(new URL('../components/portal/InventorySheet.tsx', import.meta.url), 'utf8');
assert.ok(sheet.includes("view === 'stats'"), '统计视图存在');
assert.ok(sheet.includes('inventoryStats(items)'), '统计走纯函数');
assert.ok(sheet.includes('fCategory') && sheet.includes('fTags') && sheet.includes('fPrice'), '添加表单三字段');
assert.ok(sheet.includes("view === 'sell'") && sheet.includes('sellPile(items)'), '物品③:卖闲置视图走纯函数');
assert.ok(sheet.includes('forSale: !item.forSale'), '详情页标记/取消出售');
// 物品④⑤⑥ 接线
assert.ok(sheet.includes('isContainer: !item.isContainer'), '物品④:详情页变成/解除容器');
assert.ok(sheet.includes('容器'), '物品④:容器切换可见(设计去 emoji 后按文案而非图标区分)');
assert.ok(sheet.includes('containedCount'), '物品④:装了几件可见');
assert.ok(sheet.includes('/api/portal/inventory-extract') && sheet.includes('clipboard.readText'), '物品⑤:粘贴商品信息走提取路由');
assert.ok(sheet.includes('pasteMsg'), '物品⑤:识别失败可见(不静默)');
assert.ok(sheet.includes('buildListingText') && sheet.includes('clipboard.writeText'), '物品⑥:复制转卖文案接线');
assert.ok(sheet.includes('copiedId'), '物品⑥:复制成功有反馈');

console.log('inventory-stats: OK');
