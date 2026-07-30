/**
 * 行为契约:「纪录」只认已经发生的,「Unknown」不是地名(2026-07-30 真机实锤)。
 *
 * 一次真机走查同时打出三条,病根是同一句话的三种说法 ——
 * **「凡是没被拦住的都算数」**:
 *
 *   bug #34  足迹回顾页:「最长停留 8月9日」「最忙的一天 10月27日」
 *            「走得最远 12月24日」—— 而今天是 7 月 30。一件还没发生的事
 *            不可能已经「停留最久」。footprintHighlights 拿全时间线排序,
 *            **从不问这天到了没有**。
 *
 *   bug #32/#33  「最长停留 · Unknown」「去过最北的地方 · Unknown」——
 *            Unknown 是「我不知道这是哪」的**记号**,不是一个地方的名字。
 *            原样印上去,用户会以为自己去过一个叫 Unknown 的地方。
 *
 *   bug(行程)  一趟 `7/28 → 8/1` 的行程列在「即将出发」下面 —— 它明明已经在路上。
 *            根因是拿**状态**当日期用:planned/active 一起返回,标题却只写了一种。
 *            状态是人标的,不一定跟得上日历;**日期是硬事实,状态是软标记**。
 *
 * 三条都改成正向判据:
 *   上榜的日子必须**已经过去**;上榜的地名必须**认出来了**;分组按**日期**算。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function loadTs(rel, extraGlobals = {}) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, require: () => ({}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean,
    ...extraGlobals,
  });
  return mod.exports;
}

/* ══ ① 行程:按日期分组,不按状态 ═══════════════════════════════════ */
{
  // travel-trips 顶部有存储依赖,只取纯函数那段跑
  const src = read('lib/portal/travel-trips.ts');
  const start = src.indexOf('export function groupTripsByTime');
  assert.ok(start > 0, 'groupTripsByTime 得在 travel-trips 里(两个消费者共用一份判据)');
  const end = src.indexOf('export function listCompletedTrips');
  const js = ts.transpileModule(src.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Date, String, Number, Array, Object });
  const { groupTripsByTime } = mod.exports;

  const NOW = new Date(2026, 6, 30, 12);   // 2026-07-30
  const trips = [
    { id: 'a', startDate: '2026-07-28', endDate: '2026-08-01', status: 'planned' },  // 截图里那趟
    { id: 'b', startDate: '2026-09-10', endDate: '2026-09-20', status: 'planned' },
    { id: 'c', startDate: '2026-06-01', endDate: '2026-06-08', status: 'planned' },
    { id: 'd', startDate: '2026-07-30', endDate: '2026-07-30', status: 'planned' },  // 今天出发
  ];
  const g = groupTripsByTime(trips, NOW);
  assert.equal(g.ongoing.map((t) => t.id).join(','), 'a,d',
    '7/28 出发、8/1 才回的那趟**已经在路上**了。它被列在「即将出发」下面,' +
    '是因为代码看的是 status(人标的),不是日期(硬事实)');
  assert.equal(g.upcoming.map((t) => t.id).join(','), 'b', '9 月那趟才是真的「即将出发」');
  assert.equal(g.overdue.map((t) => t.id).join(','), 'c',
    '6 月那趟结束日期都过了却还挂着 —— 要说出来(「其实结束了,只是没人标完成」),' +
    '而不是继续假装它要出发');

  // 日期缺失/看不懂的:归「在路上」而不是「即将出发」
  const messy = groupTripsByTime([{ id: 'x', startDate: '', endDate: '' }], NOW);
  assert.equal(messy.upcoming.length, 0,
    '日期都读不出来,凭什么说它「即将出发」—— 那又是「没被拦住就算数」');

  // 接线
  const panel = strip(read('components/portal/travel/TravelPlanPanel.tsx'));
  assert.match(panel, /groupTripsByTime\(/, '计划页要真的用这套分组,不能写了没接上');
  assert.match(panel, /正在路上/, '「正在路上」这组要渲染出来');
  assert.doesNotMatch(panel, /nesio-travel-plan-title">\{L\(dict, '即将出发'/,
    '大标题不许再写死「即将出发」—— 它下面装着三种状态的行程');
}

/* ══ ② 纪录只认已经发生的 + 占位符不上榜 ═══════════════════════════ */
{
  const src = read('lib/portal/place-stats.ts');
  const fn = src.slice(src.indexOf('export function footprintHighlights'));

  assert.match(fn, /d\.dateKey <= todayKey/,
    '「纪录」这个词的意思就是**已经发生过**。不挡未来的日子,' +
    '回顾页就会告诉用户「你 12 月 24 日走得最远」—— 而今天是 7 月 30');
  assert.match(fn, /isGenericPlaceLabel\(s\.label\)/,
    'Unknown 是「没认出来」的记号,不是地名。让它进「最长停留」,' +
    '用户会以为自己去过一个叫 Unknown 的地方');
  assert.match(src, /now: Date = new Date\(\)/,
    '得能把「今天」注进来,否则这条判据没法被测 —— 测不了的判据等于没有');

  // 判据本身:排除条件是**与**关系,不是「或」(两条都得满足才上榜)
  assert.match(fn, /s\.category !== 'home' && !isGenericPlaceLabel\(s\.label\)/,
    '两个排除条件必须都成立才上榜。写成 || 的话 Unknown 又漏回来了');
}

/* ══ ③ 时间线卡片不许把 Unknown 当地名印出来 ═══════════════════════ */
{
  // 这里不 strip:TimelineTab 里有内容把块注释正则带偏,strip 后整段就没了。
  // 判据本来就要落在真实源码上,直接切函数体。
  const tl = read('components/portal/insights/TimelineTab.tsx');
  const at = tl.indexOf('const placeOf =');
  assert.ok(at > 0, 'placeOf 还在');
  const placeOf = tl.slice(at, at + 1200);
  assert.match(placeOf, /isGenericPlace\(label\)/,
    'placeOf 要先问一句「这名字是真名还是占位符」,再决定印什么');
  assert.match(placeOf, /还没认出这个地方/,
    '认不出来就实话实说。这张卡本来就带坐标 —— 说「还没认出来」不丢信息,' +
    '只是不再假装认识');
  assert.match(placeOf, /g\?\.city/,
    '有城市/国家的话优先顶上 —— 「上海」比「还没认出这个地方」有用得多');
}

console.log('past-tense-and-placeholder: OK(行程按日期分组 / 纪录只认过去 / 占位符不当地名)');
