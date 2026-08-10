/**
 * 行为契约:承诺门(三门 + 两钳制)与结构化兜底(设计定稿 2026-07-29,Step 2)。
 *
 * 规则从「判断内容」退到「执行承诺」之后,这几条就是产品对用户的全部硬承诺:
 *   ① 静音过的永不再出;② 点掉的今天不回来;③ 超配额必被截断(severity 3 豁免 —— 承诺管噪音不管安全);
 *   ④ AI 挂了仍出结构化兜底,且兜底零分类零正则(防线不依赖被拆的墙)。
 * 全部可注入 now,不依赖真实时钟。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel, extra = {}) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: () => ({}), console,
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, ...extra,
  });
  return mod.exports;
}

const G = loadTs('../lib/platform/guidance-engine/guidance-gates.ts');
const F = loadTs('../lib/platform/guidance-engine/fallback-cards.ts');

const mk = (over = {}) => ({
  fingerprints: [over.fp ?? 'calendar:e:1'],
  group: '日程', severity: 1,
  showFrom: '2026-07-29', showUntil: '2026-07-31',
  hasStructuredSource: true,
  ...over,
});
const CTX = {
  localDayISO: '2026-07-29',
  nowMs: Date.parse('2026-07-29T10:00:00'),
  isMuted: () => false,
  dismissedToday: new Set(),
  budget: 1,
};

// ── 窗口钳制 ──
let r = G.applyGuidanceGates([mk({ showFrom: '2026-08-01', showUntil: '2026-08-03' })], CTX);
assert.equal(r.shown.length, 0, '没到 showFrom 静默持有');
assert.equal(r.blocked[0].gate, 'window');
r = G.applyGuidanceGates([mk({ showFrom: '2026-07-20', showUntil: '2026-07-28' })], CTX);
assert.equal(r.blocked[0].gate, 'window', '过了 showUntil 永不再出');

// ── 临近保底:开始 <2h → severity 保底 3(判决锁定后不随临近升级的唯一补丁) ──
r = G.applyGuidanceGates(
  [mk({ severity: 1, eventStartMs: CTX.nowMs + 90 * 60_000 })],
  { ...CTX, budget: 0 },
);
assert.equal(r.shown.length, 1, '开始前 90 分钟的事件即使配额 0 也要出(保底成 3 → 豁免)');
assert.equal(r.shown[0].severity, 3);
r = G.applyGuidanceGates([mk({ severity: 1, eventStartMs: CTX.nowMs + 5 * 3_600_000 })], { ...CTX, budget: 0 });
assert.equal(r.shown.length, 0, '5 小时后的事件不触发保底');

// ── ① 静音门:AI 对它不知情、无权 ──
r = G.applyGuidanceGates([mk({ severity: 3 })], { ...CTX, isMuted: () => true });
assert.equal(r.shown.length, 0, '静音过的永不再出 —— severity 3 也不例外(承诺一旦能被推翻就不是承诺)');
assert.equal(r.blocked[0].gate, 'silence');

// ── ② 当日 dismiss(cooling 的全部合法遗产) ──
r = G.applyGuidanceGates([mk()], { ...CTX, dismissedToday: new Set(['calendar:e:1']) });
assert.equal(r.blocked[0].gate, 'dismissed', '点掉的当天不回来');

// ── ③ 配额门:定序截断 + severity 3 豁免 ──
const cards = [
  mk({ fp: 'a', severity: 1, showUntil: '2026-08-05' }),
  mk({ fp: 'b', severity: 2, showUntil: '2026-08-05' }),
  mk({ fp: 'c', severity: 2, showUntil: '2026-07-29' }),
  mk({ fp: 'd', severity: 3 }),
  mk({ fp: 'e', severity: 3 }),
];
r = G.applyGuidanceGates(cards, { ...CTX, budget: 2 });
const shownFps = Array.from(r.shown, (c) => c.fingerprints[0]);
assert.equal(shownFps.join(','), 'd,e,c,b', 'severity 3 全放行(豁免),≤2 按 severity 降序→showUntil 近者先,配额 2 截断');
assert.ok(r.blocked.some((b) => b.card.fingerprints[0] === 'a' && b.gate === 'quota'), '超配额的被 quota 拦住且可查');
// 同分时结构化来源优先
r = G.applyGuidanceGates(
  [mk({ fp: 'x', severity: 1, hasStructuredSource: false }), mk({ fp: 'y', severity: 1 })],
  { ...CTX, budget: 1 },
);
assert.equal(r.shown[0].fingerprints[0], 'y', '同分时结构化来源排前');

// ── ④ 兜底:零分类,只认结构化字段 ──
const NOW = new Date('2026-07-29T10:00:00');
const fb = F.buildFallbackCards({
  calendarEvents: [
    { id: 'c1', title: '家长会', startMs: Date.parse('2026-07-29T15:00:00') },
    { id: 'c2', title: '飞北京', startMs: Date.parse('2026-07-29T11:30:00') },
    { id: 'c3', title: '昨天的会', startMs: Date.parse('2026-07-28T10:00:00') },
    { id: 'c4', title: '下周的会', startMs: Date.parse('2026-08-05T10:00:00') },
  ],
  expiryItems: [
    { id: 'i1', name: '牛奶', expiry: '2026-07-30' },
    { id: 'i2', name: '面包', expiry: '2026-09-01' },
  ],
  dueBills: [
    { id: 'b1', account: 'Chase', dueDate: '2026-07-31', minPayment: 35 },
    { id: 'b2', account: 'Amex', dueDate: '2026-08-20' },
  ],
}, NOW);
const ids = fb.map((c) => c.id);
assert.ok(!ids.includes('fallback-cal-c1'), '≤24h 的日历事件归时间线,不进提醒卡');
assert.ok(!ids.includes('fallback-cal-c2'), '<2h 的事件同样归时间线');
assert.ok(!ids.includes('fallback-cal-c3'), '已结束的不吵');
assert.ok(!ids.includes('fallback-cal-c4'), '下周的太远不进');
// >24h 且 ≤7 天的才进提醒卡
const fbFar = F.buildFallbackCards({
  calendarEvents: [
    { id: 'c5', title: '后天的会', startMs: Date.parse('2026-07-31T15:00:00') },
  ],
}, NOW);
assert.ok(fbFar.some((c) => c.id === 'fallback-cal-c5'), '>24h 的事件进提醒卡');
assert.ok(ids.includes('fallback-exp-i1') && !ids.includes('fallback-exp-i2'), '物品只认今明效期');
assert.ok(ids.includes('fallback-bill-b1') && !ids.includes('fallback-bill-b2'), '账单只认 ≤3 天');

// 兜底文件本体:零分类零正则(防线不依赖被拆的墙)
const fbSrc = fs.readFileSync(new URL('../lib/platform/guidance-engine/fallback-cards.ts', import.meta.url), 'utf8');
assert.ok(!fbSrc.includes('keyword-lexicon'), '兜底不许 import 正则词典');
assert.ok(!/LEXICON|\.test\(/.test(fbSrc), '兜底不许做任何正则分类');

console.log('guidance-gates: OK(窗口 / 临近保底 / 静音无上诉 / 当日dismiss / 配额定序+sev3豁免 / 兜底零分类)');
