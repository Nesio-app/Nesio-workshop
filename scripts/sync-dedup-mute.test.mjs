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
const TEXT_V1 = 'AT&T 定期扣款涨价了|AT&T 最近一笔 $53.91,此前约 $20(涨 170%)';
const TEXT_V2 = 'AT&T 定期扣款涨价了|AT&T 最近一笔 $70.00,此前约 $53.91(涨 30%)';

assert.equal(P.isProactiveCardDismissed(CARD, TEXT_V1), false, '没关过 → 该显示');
P.dismissProactiveById(CARD, TEXT_V1);
assert.equal(P.isProactiveCardDismissed(CARD, TEXT_V1), true, '关掉后立刻不再显示');

// 关键:换一天(当日 map 失效)后,同样内容仍然静音 —— 这正是真机反复冒出来的场景
store.set('nesio-proactive-dismissed', JSON.stringify({ [CARD]: '1999-01-01' })); // 模拟「隔天了」
assert.equal(
  P.isProactiveCardDismissed(CARD, TEXT_V1), true,
  '事实没变 → 第二天也不该再冒出来(旧逻辑只记「今天已关」,所以天天回来)',
);

// 内容变了(又涨了一次)→ 是新消息,应当放行
assert.equal(P.isProactiveCardDismissed(CARD, TEXT_V2), false, '涨价数字变了 → 属于新事实,可以再提醒');

// 不传内容时退回「当天」语义,老调用点不受影响
assert.equal(P.isProactiveCardDismissed('other-card'), false);
P.dismissProactiveById('other-card');
assert.equal(P.isProactiveCardDismissed('other-card'), true, '不带指纹 → 仍是当天静音');

// 调用点确实把内容传进去了(否则新语义形同虚设)
const feed = fs.readFileSync(new URL('../components/portal/TodayFeed.tsx', import.meta.url), 'utf8');
assert.match(feed, /dismissProactiveById\(card\.id, `\$\{card\.title\}\|\$\{card\.body\}`\)/, '关闭时要带上卡片当前内容');
const todayData = fs.readFileSync(new URL('../components/portal/today/useTodayData.ts', import.meta.url), 'utf8');
assert.match(todayData, /isProactiveCardDismissed\(c\.id, `\$\{c\.title\}\|\$\{c\.body\}`\)/, '过滤时也要带内容');

// ── ③ 头像:换签前先摘掉坏 URL,不让浏览器画破图 ──
const avatar = fs.readFileSync(new URL('../components/portal/use-profile-avatar.ts', import.meta.url), 'utf8');
const refreshFn = avatar.slice(avatar.indexOf('const refreshAvatar'));
assert.match(
  refreshFn.slice(0, 400),
  /setAvatarUrl\(''\)[\s\S]{0,200}fetchFreshUrl/,
  'refreshAvatar 必须先置空(退回首字母)再去换签,否则过期 URL 会先渲染成破图',
);

console.log('sync-dedup-mute: OK(日历同批去重 / 卡片静音到内容变化 / 头像不闪破图)');
