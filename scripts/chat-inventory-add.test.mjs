/**
 * 行为契约:问一问·像发消息一样记物品。
 * 锁死:提取路由字段钳制(数量/价格/标签上限、超长截断、非数组容错)、
 * 空文本 400、AI 失败 502;聊天意图门(加物品命中、找东西/问句不劫持)、
 * 提取空落回普通聊天、入库确认气泡(源码级)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadRoute(fakeCompleteText) {
  const src = fs.readFileSync(new URL('../app/api/portal/inventory-extract/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Number, Math, String, process: { env: {} },
    require: (p) => p === 'next/server' ? { NextRequest: class {}, NextResponse: { json: (b, init) => ({ __json: b, __status: init?.status ?? 200 }) } }
      : p === '@/lib/portal/api-auth' ? { guardAiRoute: async () => null }
      : p === '@/lib/portal/ai-complete' ? { completeText: fakeCompleteText }
      : p === '@/lib/extraction/extraction' ? { parseJsonBlock: (raw) => { try { return JSON.parse(raw); } catch { return null; } } } : ({}),
  });
  return mod.exports;
}
const req = (text) => ({ json: async () => ({ text }) });

// ── 正常提取 + 钳制 ──
{
  const route = loadRoute(async () => ({ text: JSON.stringify([
    { name: '红色 Nike 鞋', quantity: 1, location: '鞋柜', category: '鞋', tags: ['红色', '运动'], price: 89.995 },
    { name: 'AA 电池', quantity: 2000, tags: ['a', 'b', 'c', 'd', 'e', 'f'] },
    { name: 'x'.repeat(200), price: -5 },
    { notName: '没名字的丢弃' },
  ]) }));
  const res = await route.POST(req('红色 Nike 鞋放鞋柜,两包 AA 电池'));
  assert.equal(res.__json.ok, true);
  const items = res.__json.items.map((i) => ({ ...i, tags: i.tags ? [...i.tags] : undefined }));
  assert.equal(items.length, 3, '缺名条目丢弃');
  assert.equal(items[0].location, '鞋柜');
  assert.equal(items[0].price, 90, '价格四舍五入两位');
  assert.equal(items[1].quantity, 999, '数量钳到 999');
  assert.equal(items[1].tags.length, 4, '标签最多 4 个');
  assert.equal(items[2].name.length, 60, '名称截断 60');
  assert.equal(items[2].price, undefined, '负价丢弃');
}
// ── 非记物品(模型回 [])→ items 空;坏 JSON → 空数组不炸 ──
{
  const route = loadRoute(async () => ({ text: '[]' }));
  assert.deepEqual([...(await route.POST(req('今天天气怎么样'))).__json.items], []);
}
{
  const route = loadRoute(async () => ({ text: '抱歉我不明白' }));
  assert.deepEqual([...(await route.POST(req('随便说说'))).__json.items], [], '坏 JSON 容错为空');
}
// ── 空文本 400;AI 挂 502 ──
{
  const route = loadRoute(async () => ({ text: '[]' }));
  assert.equal((await route.POST(req(''))).__status, 400);
}
{
  const route = loadRoute(async () => { throw new Error('down'); });
  assert.equal((await route.POST(req('记一下东西'))).__status, 502, 'AI 失败 502 可见');
}

// ── 聊天接线(源码级):意图门 + 问句排除 + 落回 + 确认气泡 ──
const chat = fs.readFileSync(new URL('../components/portal/NesioChatSheet.tsx', import.meta.url), 'utf8');
assert.ok(chat.includes('INVENTORY_ADD_RE'), '加物品意图门存在');
assert.ok(chat.includes('INVENTORY_QUESTION_RE'), '问句(找东西)排除,不劫持搜索');
assert.ok(chat.includes('/api/portal/inventory-extract'), '走提取路由');
assert.ok(chat.includes('addInventoryItem(it)'), '提取结果直接入库');
assert.ok(chat.includes('落回普通聊天'), '提取失败静默落回');
// 门本身的行为:加物品命中、找东西不命中
const addRe = /(记|加|收|添|买了).{0,8}(物品|东西|收纳|库存)|收纳[::]|放(在|到|进)|add (an? )?item/i;
const qRe = /[??]|哪里|在哪|哪儿|找一?下|找找|去哪/;
assert.ok(addRe.test('帮我记一下东西:红色 Nike 鞋放到鞋柜') && !qRe.test('帮我记一下东西:红色 Nike 鞋放到鞋柜'), '记物品命中');
assert.ok(addRe.test('蓝色宜家收纳箱放在车库'), '「放在」命中');
const q = '我的护照放在哪了?';
assert.ok(qRe.test(q), '找东西问句被排除');

console.log('chat-inventory-add: OK');
