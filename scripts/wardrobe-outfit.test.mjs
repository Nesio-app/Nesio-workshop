/**
 * 行为契约:衣橱每日穿搭规则引擎(免费·端上·确定性)。
 * 锁死:
 *   - 温度 → 保暖档 + 是否外套(冷加外套、热穿薄);
 *   - 日历 → 正式度(面试=正式、会议=通勤、其余=休闲);
 *   - 选衣:各类挑最契合(保暖+正式度),同分时「久没穿」优先(穿遍全衣橱);
 *   - 降水≥50% → 带伞提示;
 *   - 缺口:该有没有 → gaps 记录;
 *   - outfitFindings:空衣橱不打扰、1 件引导补充、能搭出「今天穿这套 · N 件」。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/portal/wardrobe.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Set, Number, Math, Date, String, RegExp, Boolean,
    // 引擎测试只碰纯函数;storage 依赖给个安全 stub。
    require: () => ({
      addLifeNode: () => ({}), deleteLifeNode: () => true, getLifeGraph: () => [], updateLifeNode: () => true,
    }),
  });
  return mod.exports;
}

const W = load();
const TODAY = '2026-07-24T00:00:00Z';

const g = (over) => ({
  node: {}, id: over.id || 'x', name: over.name || '衣',
  garmentType: 'top', warmth: 2, formality: 'casual',
  colors: [], material: '', seasons: [], hasPhoto: false, assetId: null,
  lastWornAt: null, wearCount: 0, ...over,
});
const ctx = (over) => ({ repTempC: 20, tempMinC: null, tempMaxC: null, precipProb: null, formalNeed: 'casual', ...over });

// ── warmthForTemp:温度档(逐字段断言,避开跨 realm deepEqual 原型差异) ──
{
  const eq = (r, t, o, msg) => { assert.equal(r.target, t, `${msg} target`); assert.equal(r.needOuter, o, `${msg} needOuter`); };
  eq(W.warmthForTemp(2), 3, true, '≤5°C 保暖+外套');
  eq(W.warmthForTemp(12), 2, true, '6–15°C 适中+外套');
  eq(W.warmthForTemp(22), 2, false, '16–25°C 适中不外套');
  eq(W.warmthForTemp(30), 1, false, '>25°C 薄');
  eq(W.warmthForTemp(null), 2, false, '未知 → 默认适中不外套');
}

// ── inferFormalNeed:日历 → 正式度 ──
{
  assert.equal(W.inferFormalNeed([{ title: '和朋友喝咖啡' }]), 'casual', '闲事=休闲');
  assert.equal(W.inferFormalNeed([{ title: '产品评审会议' }]), 'smart', '会议=通勤');
  assert.equal(W.inferFormalNeed([{ title: '早上 10 点面试' }, { title: '午饭' }]), 'formal', '面试=正式(优先)');
  assert.equal(W.inferFormalNeed([]), 'casual', '无事=休闲');
}

// ── suggestOutfit:冷天 + 正式,挑出外套 & 正式款 ──
{
  const wardrobe = [
    g({ id: 't-cas', garmentType: 'top', warmth: 1, formality: 'casual', name: '休闲T恤' }),
    g({ id: 't-for', garmentType: 'top', warmth: 3, formality: 'formal', name: '正式衬衫' }),
    g({ id: 'b-for', garmentType: 'bottom', warmth: 3, formality: 'formal', name: '西裤' }),
    g({ id: 'o-for', garmentType: 'outer', warmth: 3, formality: 'formal', name: '大衣' }),
    g({ id: 's-for', garmentType: 'shoes', warmth: 2, formality: 'formal', name: '皮鞋' }),
  ];
  const s = W.suggestOutfit(wardrobe, ctx({ repTempC: 3, formalNeed: 'formal', tempMinC: 1, tempMaxC: 7 }), TODAY);
  const ids = s.pieces.map((p) => p.id);
  assert.equal(s.warmthTarget, 3, '目标保暖档 3');
  assert.equal(s.needOuter, true, '冷天需要外套');
  assert.ok(ids.includes('t-for'), '上装选正式保暖那件,不是休闲薄款');
  assert.ok(!ids.includes('t-cas'), '不选休闲薄T');
  assert.ok(ids.includes('o-for'), '挑了外套');
  assert.ok(ids.includes('s-for'), '挑了鞋');
  assert.equal(s.gaps.length, 0, '该有的都齐,无缺口');
  assert.ok(/带伞/.test(s.reason[0]) === false, '无降水不提伞');
}

// ── suggestOutfit:热天不加外套 ──
{
  const wardrobe = [
    g({ id: 't', garmentType: 'top', warmth: 1, formality: 'casual' }),
    g({ id: 'b', garmentType: 'bottom', warmth: 1, formality: 'casual' }),
    g({ id: 'o', garmentType: 'outer', warmth: 3, formality: 'casual' }),
    g({ id: 's', garmentType: 'shoes', warmth: 1, formality: 'casual' }),
  ];
  const s = W.suggestOutfit(wardrobe, ctx({ repTempC: 31 }), TODAY);
  assert.equal(s.needOuter, false, '热天不需外套');
  assert.ok(!s.pieces.map((p) => p.id).includes('o'), '热天不挑外套');
}

// ── suggestOutfit:同样合适时,久没穿的优先(穿遍衣橱) ──
{
  const wardrobe = [
    g({ id: 'fresh', garmentType: 'top', warmth: 2, formality: 'casual', lastWornAt: '2026-07-23' }), // 昨天穿过
    g({ id: 'stale', garmentType: 'top', warmth: 2, formality: 'casual', lastWornAt: '2026-06-01' }), // 很久没穿
    g({ id: 'b', garmentType: 'bottom', warmth: 2, formality: 'casual' }),
    g({ id: 's', garmentType: 'shoes', warmth: 2, formality: 'casual' }),
  ];
  const s = W.suggestOutfit(wardrobe, ctx({ repTempC: 20 }), TODAY);
  const ids = s.pieces.map((p) => p.id);
  assert.ok(ids.includes('stale'), '久没穿的上装优先');
  assert.ok(!ids.includes('fresh'), '刚穿过的靠后');
}

// ── suggestOutfit:缺口(没有鞋)→ gaps ──
{
  const wardrobe = [
    g({ id: 't', garmentType: 'top', warmth: 2 }),
    g({ id: 'b', garmentType: 'bottom', warmth: 2 }),
  ];
  const s = W.suggestOutfit(wardrobe, ctx({ repTempC: 22 }), TODAY);
  assert.ok(s.gaps.includes('shoes'), '没鞋 → gaps 含 shoes');
}

// ── suggestOutfit:降水 → 带伞 ──
{
  const wardrobe = [g({ id: 't', garmentType: 'top' }), g({ id: 'b', garmentType: 'bottom' }), g({ id: 's', garmentType: 'shoes' })];
  const s = W.suggestOutfit(wardrobe, ctx({ repTempC: 18, precipProb: 70 }), TODAY);
  assert.equal(s.needUmbrella, true, '降水≥50% 需带伞');
  assert.ok(/带伞/.test(s.reason[0]), '中文理由提到带伞');
  assert.ok(/umbrella/i.test(s.reason[1]), '英文理由提到 umbrella');
}

// ── outfitFindings:空 / 1 件 / 能搭 ──
{
  assert.equal(W.outfitFindings([], ctx({}), TODAY).length, 0, '空衣橱不打扰');

  const one = W.outfitFindings([g({ id: 't', garmentType: 'top' })], ctx({}), TODAY);
  assert.equal(one.length, 1, '1 件 → 一条引导');
  assert.ok(/拍|衣橱/.test(one[0].title[0]), '引导让用户加衣服');

  const full = [
    g({ id: 't', garmentType: 'top', warmth: 2 }),
    g({ id: 'b', garmentType: 'bottom', warmth: 2 }),
    g({ id: 's', garmentType: 'shoes', warmth: 2 }),
  ];
  const out = W.outfitFindings(full, ctx({ repTempC: 22 }), TODAY);
  assert.equal(out.length, 1, '能搭 → 一条穿搭卡');
  assert.ok(/今天穿这套/.test(out[0].title[0]), '标题=今天穿这套');
  assert.ok(/· 3 件/.test(out[0].title[0]), '件数正确(上装+下装+鞋=3)');
  assert.equal(out[0].id, 'outfit-2026-07-24', 'id 带当天日期,每天新实例');
}

console.log('✓ wardrobe-outfit 契约全部通过');
