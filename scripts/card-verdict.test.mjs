/**
 * 行为契约:用户对主动卡的裁决必须比数据活得久。
 *
 * 真机实锤:「我点了稍后、不要再出现、或者喜欢,不管点哪个他都会出现」。
 * 审计结论 —— per-card 反馈在 2026-07-27 退役在线学习之后**没有任何消费者**:
 *   preference-store 只认可复用维度(card 不在内,被丢弃)、
 *   guidance-ranker RANKER_LEARNING_ENABLED=false 不订总线、
 *   feedback-log 对 today/card 直接 return、
 *   稍后只走 snoozeOverdue(nodeId) 而财务卡没有 nodeId。
 * 剩下的唯一记忆是 cooling-store 的 2~24 小时冷却,还把键写错了。
 *
 * 本文件钉死修复后的语义,任何一条被改回去都要立刻红。
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

const store = new Map();
const V = loadTs('../lib/portal/card-verdict.ts', {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  },
});

const T0 = new Date('2026-07-29T10:00:00Z');
const plus = (days) => new Date(T0.getTime() + days * 86_400_000);

const ATT = { cardId: 'guidance-finance-hike-att', cardType: 'domain_insight', factKey: V.fingerprint('AT&T 涨到 $53.91') };
const ATT_V2 = { ...ATT, factKey: V.fingerprint('AT&T 涨到 $70.00') };

// ── ① 稍后:必须真的有到期时间,且不依赖 nodeId ──
assert.equal(V.isCardSuppressed(ATT, T0), false, '没裁决过 → 可以出');
V.recordCardVerdict(ATT, 'snooze', T0);
assert.equal(V.isCardSuppressed(ATT, plus(1)), true, '稍后 → 第二天不该再出(旧实现只 snoozeOverdue(nodeId),财务卡没 nodeId 等于空转)');
assert.deepEqual(V.cardSuppression(ATT, plus(1)).reason, 'snoozed');
assert.equal(V.isCardSuppressed(ATT, plus(V.SNOOZE_DAYS + 0.1)), false, '稍后是延后不是永久 → 到期要回来');
// 稍后看的是时间不是内容:同一张卡内容变了也仍在稍后期内
assert.equal(V.isCardSuppressed(ATT_V2, plus(1)), true, '稍后期内,内容变了也先别打扰(时机问题)');

store.clear();

// ── ② 不要再出现:事实没变就永远闭嘴,变了才放行 ──
V.recordCardVerdict(ATT, 'mute', T0);
assert.equal(V.isCardSuppressed(ATT, plus(1)), true, '第二天不该回来');
assert.equal(V.isCardSuppressed(ATT, plus(3650)), true, '十年后也不该回来 —— 事实没变,重复通知就是骚扰');
assert.equal(V.cardSuppression(ATT, plus(1)).reason, 'muted');
assert.equal(V.isCardSuppressed(ATT_V2, plus(1)), false, '涨价数字变了 → 是新事实,可以再说一次');

store.clear();

// ── ③ 太多了:连这一类一起静音,而不是一张一张关 ──
const OTHER_SAME_TYPE = { cardId: 'guidance-domain-health-1', cardType: 'domain_insight', factKey: 'fp-x' };
assert.equal(V.isCardSuppressed(OTHER_SAME_TYPE, T0), false);
V.recordCardVerdict(ATT, 'mute_type', T0);
assert.equal(V.isCardSuppressed(OTHER_SAME_TYPE, plus(1)), true, '太多了 → 同类的别的卡也该让路');
assert.equal(V.cardSuppression(OTHER_SAME_TYPE, plus(1)).reason, 'type_muted');
assert.equal(V.isCardSuppressed(OTHER_SAME_TYPE, plus(V.MUTE_TYPE_DAYS + 1)), false, '整类静音 30 天后解封(题材可能又相关了)');
// 被点的那张自己仍按指纹永久静音
assert.equal(V.isCardSuppressed(ATT, plus(V.MUTE_TYPE_DAYS + 1)), true, '整类解封后,被点掉的那条事实仍然闭嘴');

// ── ④ 喜欢:不该影响出不出(它只改排序) ──
const LIKED = { cardId: 'guidance-liked', cardType: 'renewal', factKey: 'fp-l' };
V.recordCardVerdict(LIKED, 'useful', T0);
assert.equal(V.isCardSuppressed(LIKED, plus(1)), false, '喜欢不等于关掉');

// ── ⑤ 必须可反悔:能列出来、能解除 ──
const listing = V.readCardVerdicts(plus(1));
assert.ok(listing.some((e) => e.scope === 'card' && e.key === ATT.cardId), '静音的卡要能列出来');
assert.ok(listing.some((e) => e.scope === 'type' && e.key === 'domain_insight'), '整类静音也要能列出来');
assert.ok(!listing.some((e) => e.key === LIKED.cardId), '喜欢不进静音清单');
V.clearCardVerdict('card', ATT.cardId);
assert.equal(V.isCardSuppressed(ATT, plus(1)), true, '解了卡但整类还静音着 → 仍然不出');
V.clearCardVerdict('type', 'domain_insight');
assert.equal(V.isCardSuppressed(ATT, plus(1)), false, '两条都解了 → 回来');
V.recordCardVerdict(ATT, 'mute', T0);
V.resetCardVerdicts();
assert.equal(V.readCardVerdicts(plus(1)).length, 0, '全部解除要真的清空');

// 过期的裁决不该还挂在清单上(看起来像解不掉)
store.clear();
V.recordCardVerdict(ATT, 'snooze', T0);
assert.equal(V.readCardVerdicts(plus(V.SNOOZE_DAYS + 1)).length, 0, '过期的稍后不进清单');

// ── ⑥ 接线:三个动作都必须写进裁决层,且反馈要落到可复用维度 ──
const card = fs.readFileSync(new URL('../components/portal/today/ProactiveGuidanceCard.tsx', import.meta.url), 'utf8');
assert.match(card, /recordCardVerdict\(verdictRef, 'snooze'\)/, '稍后要写裁决');
assert.match(card, /feedback === 'wrong'\) recordCardVerdict\(verdictRef, 'mute'\)/, '没用 → 按事实静音');
assert.match(card, /feedback === 'too_much'\) recordCardVerdict\(verdictRef, 'mute_type'\)/, '太多了 → 整类静音');
assert.match(
  card,
  /dimension: 'card_type'/,
  "per-card 的 dimension:'card' 会被 Preference 丢弃(不在可复用维度里),必须补发 card_type 才学得到",
);
// 稍后不能再退回「只有 nodeId 才生效」
assert.doesNotMatch(
  card.slice(card.indexOf('if (ddx > 64)'), card.indexOf('if (ddx > 64)') + 260),
  /if \(card\.nodeId\) snoozeOverdue/,
  '右滑必须走 handleSnooze(无条件写裁决),不能再是「有 nodeId 才算数」',
);

// 过滤链上真的读了裁决层
const todayData = fs.readFileSync(new URL('../components/portal/today/useTodayData.ts', import.meta.url), 'utf8');
assert.match(todayData, /isCardSuppressed\(\{ cardId: c\.id, cardType: c\.cardType, factKey: c\.factKey \}, now\)/, '出卡前要按裁决过滤');

// 管线打分读 card_type 权重,否则「喜欢」改不到排序
const pipeline = fs.readFileSync(new URL('../lib/platform/guidance-engine/guidance-pipeline.ts', import.meta.url), 'utf8');
assert.match(pipeline, /getWeight\('card_type', event\.type\)/, '排序要读 card_type 权重');
assert.match(pipeline, /coolKey: dk/, '冷却键要随卡带到渲染层');

// 冷却键错位:渲染层记 dismiss 必须用 coolKey(= dedupKey),不能用 cardType
const feed = fs.readFileSync(new URL('../components/portal/TodayFeed.tsx', import.meta.url), 'utf8');
assert.match(feed, /const coolKey = card\.coolKey \|\| card\.cardType/, '关卡计数要记在管线读得到的键上');
assert.match(feed, /recordDismissed\(coolKey, loadCoolingStore\(\)\)/, 'recordDismissed 用 coolKey');

// card_type 确实在 Preference 的可复用维度里(不然补发也白搭)
const pref = fs.readFileSync(new URL('../lib/platform/personalization/preference-store.ts', import.meta.url), 'utf8');
assert.match(pref, /PREFERENCE_DIMENSIONS = new Set\(\[[^\]]*'card_type'/, 'card_type 必须是可复用维度');

console.log('card-verdict: OK(稍后有到期 / 不要再出现按事实永久 / 太多了整类 30 天 / 可反悔 / 权重接上 card_type)');
