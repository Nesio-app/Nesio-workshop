/**
 * 衣橱 bug3 契约(用户标注 p8–p12 的防回潮锁)。
 *
 * 三件事最容易被下一次改动悄悄弄回去:
 *   ① 「换一套」在免费档点了不动 —— 确定性算法输入没变就给同一个答案。
 *      修法是给 suggestOutfit 一个 rotate 游标;这里用真数据跑一遍,断言结果真的换了。
 *   ② 「淘汰」曾经只是展示层一句话,算法照推。现在 avoidKeys 从候选里剔掉。
 *   ③ 三个子 tab(今天/搭配/衣帽间)与「加衣服挪进衣帽间」是结构性要求,源码级钉。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Set, Map, Number, Math, Date, String, RegExp, Boolean,
    require: () => ({ addLifeNode: () => ({}), deleteLifeNode: () => true, getLifeGraph: () => [], updateLifeNode: () => true }),
  });
  return mod.exports;
}
const { suggestOutfit } = load('../lib/portal/wardrobe.ts');

const g = (id, name, type, warmth, formality, colors = []) => ({
  id, name, garmentType: type, warmth, formality, colors, assetId: null, mimeType: null, lastWornAt: null,
});
const wardrobe = [
  g('t1', '白T', 'top', 1, 'casual'), g('t2', '灰卫衣', 'top', 2, 'casual'), g('t3', '蓝衬衫', 'top', 2, 'smart'),
  g('b1', '牛仔裤', 'bottom', 2, 'casual'), g('b2', '西裤', 'bottom', 2, 'smart'), g('b3', '短裤', 'bottom', 1, 'casual'),
];
const ctx = { repTempC: 18, tempMinC: 14, tempMaxC: 22, precipProb: 10, formalNeed: 'casual' };
const DAY = '2026-07-30T00:00:00.000Z';
const keyOf = (s) => s.pieces.map((p) => p.id).sort().join('|');

// ── ① rotate 真的换一套 ──
const r0 = suggestOutfit(wardrobe, ctx, DAY, undefined, { rotate: 0 });
const r1 = suggestOutfit(wardrobe, ctx, DAY, undefined, { rotate: 1 });
assert.ok(r0.pieces.length >= 2, '基准组合至少上下装两件');
assert.notStrictEqual(keyOf(r1), keyOf(r0), 'rotate=1 必须给出不同的一套 —— 否则「换一套」又变成死按钮');
// 转一圈要能回到原点(游标是环形的,不会越点越空)
let cycled = false;
for (let i = 1; i <= 40; i++) {
  if (keyOf(suggestOutfit(wardrobe, ctx, DAY, undefined, { rotate: i })) === keyOf(r0)) { cycled = true; break; }
}
assert.ok(cycled, 'rotate 必须是环形游标 —— 一直点下去要回到最佳,不能走空');

// ── ② 淘汰过的组合真的不再被推 ──
const avoided = suggestOutfit(wardrobe, ctx, DAY, undefined, { avoidKeys: [keyOf(r0)] });
assert.notStrictEqual(keyOf(avoided), keyOf(r0), '淘汰过的一组必须从候选里剔掉,不能只在界面上提示一句');
// 全被淘汰时不能返回空搭配(空搭配比重复搭配更没用)
const allKeys = [];
for (let i = 0; i < 40; i++) allKeys.push(keyOf(suggestOutfit(wardrobe, ctx, DAY, undefined, { rotate: i })));
const everything = suggestOutfit(wardrobe, ctx, DAY, undefined, { avoidKeys: [...new Set(allKeys)] });
assert.ok(everything.pieces.length >= 1, '所有组合都被淘汰时要退回不过滤那一版,不许给空搭配');

// ── ③ 三个子 tab + 加衣服在衣帽间 ──
const panelRaw = fs.readFileSync(new URL('../components/portal/insights/WardrobePanel.tsx', import.meta.url), 'utf8');
const panel = panelRaw;
// 剥注释再查「已删文案」—— 本仓踩过多次「注释里提了一句就把断言喂饱/喂假了」。
const code = panelRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
assert.ok(/'today' \| 'saved' \| 'closet'/.test(panel), '衣橱必须有三个子 tab(今天 / 搭配 / 衣帽间)');
assert.ok(panel.includes("'衣帽间'"), '第三个 tab 叫「衣帽间」');
const closetAt = panel.indexOf('衣帽间(bug3 新增第三个 tab)');
assert.ok(closetAt > 0, '找不到衣帽间分支 —— 测试锚点失效,请更新此测试');
assert.ok(panel.indexOf('加衣服 · 拍照或选图') > closetAt, '「加衣服」按钮必须在衣帽间分支里,不许留在「今天」');

// 删掉的文案不许回来
for (const dead of ['今天穿这套', '这套怎么样', '这套穿了', '上身试穿', '试穿这套', 'Wore it']) {
  assert.ok(!code.includes(dead), `「${dead}」已按标注删除,不许回来`);
}
assert.ok(!code.includes("L(dict, '穿了'"), '搭配详情「穿了」按钮不许回来');

// 搭配列表:穿过几次 / 长按排日子 / 点开详情 / 淘汰变灰的含义
assert.ok(panel.includes('wornCount'), '搭配行必须显示这一组穿过几次');
assert.ok(/onPointerDown=\{startHold\}/.test(panel), '搭配行必须支持长按 → 直接排哪天穿');
assert.ok(panel.includes('排进日历'), '排完日子要能进日历(aria-label 保留文案)');
assert.ok(panel.includes('>✓<') || />\s*✓\s*</.test(panel), '「排进日历」按钮面是对勾符号');
assert.ok(panel.includes('已淘汰:这一组变灰'), '「变灰」必须在界面上写清楚是什么意思');
assert.ok(panel.includes('tryonAssetId'), '日历那天要能显示上身图(搭配上的 tryonAssetId)');
assert.ok(/Plugins\?\.Filesystem/.test(panel), '试穿保存要有 Capacitor Filesystem 回退');

console.log('wardrobe-bug3: OK');
