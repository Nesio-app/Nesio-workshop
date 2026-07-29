/**
 * 行为契约:日历同步去重 + 主动卡「静音到内容变化为止」+ 头像不闪破图。
 * 三条都来自真机:日历项计数在 51/39 之间来回跳且满屏重复;
 * 「AT&T 涨价了」取消多少次第二天还来;头像加载前先闪一下浏览器的破图图标。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const localDayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function loadTs(rel, extra = {}) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    // 真实的 localDayKey —— 打桩成空对象的话,当日静音那条分支会静默失效,测试就测了个寂寞
    module: mod, exports: mod.exports, require: (p) => (String(p).includes('local-day') ? { localDayKey } : {}), console,
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, ...extra,
  });
  return mod.exports;
}

// ── ① 日历:同一次同步内也必须去重 ──
const sync = fs.readFileSync(new URL('../lib/portal/providers/connector-sync.ts', import.meta.url), 'utf8');
const calFn = sync.slice(sync.indexOf('export async function saveCalendarEventsToMemory'));
const calBody = calFn.slice(0, calFn.indexOf('\nexport '));
assert.match(calBody, /seenThisRun/, '必须有「本次同步已落过」的集合');
assert.match(
  calBody,
  /seenThisRun\.has\(calId\)[\s\S]{0,80}continue/,
  '同一 calendarId 在一次同步内只能落一次',
);
assert.match(calBody, /seenThisRun\.has\(dupKey\)/, '同名同时间(多日历订阅同一会议)也要挡住');
// 占位必须在 ingest 之前,否则等于没挡
const guardAt = calBody.indexOf('seenThisRun.add(dupKey)');
const ingestAt = calBody.indexOf('ingestLifeNode({');
assert.ok(guardAt > 0 && ingestAt > guardAt, '去重占位必须先于 ingestLifeNode');

// ── ② 主动卡:静音到内容变化为止 ──
const store = new Map();
const P = loadTs('../components/portal/today/proactive-types.ts', {
  window: {},
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  },
});

const CARD = 'finance-hike-att';
// 指纹由管线在 **AI 改写之前** 算定(useTodayData 的 factKey),这里直接用指纹值。
const FP_V1 = 'fp-att-53.91';
const FP_V2 = 'fp-att-70.00';

assert.equal(P.isProactiveCardDismissed(CARD, FP_V1), false, '没关过 → 该显示');
P.dismissProactiveById(CARD, FP_V1);
assert.equal(P.isProactiveCardDismissed(CARD, FP_V1), true, '关掉后立刻不再显示');

// 关键:换一天(当日 map 失效)后,同样内容仍然静音 —— 这正是真机反复冒出来的场景
store.set('nesio-proactive-dismissed', JSON.stringify({ [CARD]: '1999-01-01' })); // 模拟「隔天了」
assert.equal(
  P.isProactiveCardDismissed(CARD, FP_V1), true,
  '事实没变 → 第二天也不该再冒出来(旧逻辑只记「今天已关」,所以天天回来)',
);

// 内容变了(又涨了一次)→ 是新消息,应当放行
assert.equal(P.isProactiveCardDismissed(CARD, FP_V2), false, '涨价数字变了 → 属于新事实,可以再提醒');

// 不传指纹时退回「当天」语义,老调用点不受影响
assert.equal(P.isProactiveCardDismissed('other-card'), false);
P.dismissProactiveById('other-card');
assert.equal(P.isProactiveCardDismissed('other-card'), true, '不带指纹 → 仍是当天静音');

// 指纹绝不能在这一层重算:proactive-types 拿到的 title/body 已被 Layer 7 改写过。
assert.doesNotMatch(
  fs.readFileSync(new URL('../components/portal/today/proactive-types.ts', import.meta.url), 'utf8'),
  /charCodeAt/,
  'proactive-types 不该自己对文案取哈希(改写后的文案每天都是新指纹,静音永远命中不了)',
);

// 调用点传的必须是 factKey(否则新语义形同虚设)
const feed = fs.readFileSync(new URL('../components/portal/TodayFeed.tsx', import.meta.url), 'utf8');
assert.match(feed, /dismissProactiveById\(card\.id, card\.factKey\)/, '关闭时要带上事实指纹');
const todayData = fs.readFileSync(new URL('../components/portal/today/useTodayData.ts', import.meta.url), 'utf8');
assert.match(todayData, /isProactiveCardDismissed\(c\.id, c\.factKey\)/, '过滤时也要带指纹');
// 硬拆后(2026-07-29):润色层已删,同一条不变式换了形态 ——
// 判决卡的 factKey = 源信号指纹(AI 文案不参与),原理同「改写前定死」。
assert.match(todayData, /factKey: c\.fingerprints\[0\]/, '判决卡 factKey = 源信号首指纹(AI 文案不参与)');

// ── ③ 头像:换签前先摘掉坏 URL,不让浏览器画破图 ──
const avatar = fs.readFileSync(new URL('../components/portal/use-profile-avatar.ts', import.meta.url), 'utf8');
const refreshFn = avatar.slice(avatar.indexOf('const refreshAvatar'));
assert.match(
  refreshFn.slice(0, 400),
  /setAvatarUrl\(''\)[\s\S]{0,200}fetchFreshUrl/,
  'refreshAvatar 必须先置空(退回首字母)再去换签,否则过期 URL 会先渲染成破图',
);

console.log('sync-dedup-mute: OK(日历同批去重 / 卡片静音到内容变化 / 头像不闪破图)');
