/**
 * 行为契约:DEC 多卡不被下游去重/冷却塌缩成一张(PRD TODAY-002)。
 *
 * 背景(回归):runDEC 最多产出 3 张证据门控的跨域推荐,但每张都是
 * type='dec_insight'。管线的「一类型一卡」去重(seenTypes.has(event.type))
 * 会把除第一张外全部丢弃,随后 12h 中等冷却按裸类型再压掉其余——DEC 引擎
 * 的整个产出静默塌缩成一张卡,且无日志无痕迹。
 *
 * 守护意图(行为,非钉字符串):
 * 1. coolingKey:dec_insight 按 id 区分,其余类型仍折叠到 type。
 * 2. 去重门:N 张不同 id 的 dec_insight 全部存活;N 张同类型(生日)只留一张。
 * 3. 冷却身份:展示一张 DEC 卡不会让另一张 DEC 卡进入冷却。
 * 这些直接 import 并执行管线真正使用的 guidance-dedup.mjs,而不是断言源码文本。
 *
 * 另加一条结构守护:确认 guidance-pipeline.ts 确实接线到 guidance-dedup,
 * 且不再以裸 event.type 去重——防止未来重构悄悄把回归改回来。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { coolingKey, makeDedupGate } from '../lib/platform/guidance-engine/guidance-dedup.mjs';

const repoRoot = resolve(new URL('.', import.meta.url).pathname, '..');
const read = (p) => readFileSync(resolve(repoRoot, p), 'utf8');

// ── 1. coolingKey 身份规则 ──────────────────────────────────────────────────
assert.equal(coolingKey('dec_insight', 'dec-a'), 'dec-a', 'DEC insight keys by its own id.');
assert.notEqual(
  coolingKey('dec_insight', 'dec-a'),
  coolingKey('dec_insight', 'dec-b'),
  'Two distinct DEC insights must have distinct cooling identities.',
);
assert.equal(coolingKey('birthday', 'evt-1'), 'birthday', 'Non-DEC types collapse to the type.');
assert.equal(
  coolingKey('birthday', 'evt-1'),
  coolingKey('birthday', 'evt-2'),
  'Two birthdays share one identity (one birthday card, not two).',
);

// ── 2. 去重门行为 ───────────────────────────────────────────────────────────
// 三张不同 id 的 DEC 卡:全部存活。
const decGate = makeDedupGate();
const decEvents = [
  { type: 'dec_insight', id: 'dec-a' },
  { type: 'dec_insight', id: 'dec-b' },
  { type: 'dec_insight', id: 'dec-c' },
];
const survivingDec = decEvents.filter((e) => !decGate(e.type, e.id));
assert.equal(survivingDec.length, 3, 'All three distinct DEC insights must survive dedup — the regression collapsed them to 1.');

// 三张生日卡:仍只留一张。
const bdayGate = makeDedupGate();
const bdayEvents = [
  { type: 'birthday', id: 'b1' },
  { type: 'birthday', id: 'b2' },
  { type: 'birthday', id: 'b3' },
];
const survivingBday = bdayEvents.filter((e) => !bdayGate(e.type, e.id));
assert.equal(survivingBday.length, 1, 'Same-type non-DEC events still collapse to one card.');

// 混合、按管线顺序喂:2 张 DEC + 2 张生日 → 2 DEC + 1 生日存活。
const mixedGate = makeDedupGate();
const mixed = [
  { type: 'dec_insight', id: 'dec-x' },
  { type: 'birthday', id: 'b1' },
  { type: 'dec_insight', id: 'dec-y' },
  { type: 'birthday', id: 'b2' },
];
const survivors = mixed.filter((e) => !mixedGate(e.type, e.id));
assert.deepEqual(
  survivors.map((e) => e.id),
  ['dec-x', 'b1', 'dec-y'],
  'DEC insights survive independently; duplicate birthday is dropped.',
);

// ── 3. 冷却身份:每张 DEC 卡占独立冷却槽,生日共用一个 ─────────────────────
// 管线用 coolingKey 作为冷却表的键(见 guidance-pipeline recordShown/isOnCooldown)。
// 键互不相同 ⇒ 展示一张 DEC 卡不会把另一张 DEC 卡压进 12h 冷却。
const decCoolKeys = new Set(['dec-a', 'dec-b', 'dec-c'].map((id) => coolingKey('dec_insight', id)));
assert.equal(decCoolKeys.size, 3, 'Three DEC insights must occupy three independent cooldown slots — the regression shared one 12h slot.');
const bdayCoolKeys = new Set(['b1', 'b2', 'b3'].map((id) => coolingKey('birthday', id)));
assert.equal(bdayCoolKeys.size, 1, 'Birthdays still share one cooldown slot (one nudge per day).');

// ── 4. 结构守护:管线确实接线到 guidance-dedup,不再裸类型去重 ───────────────
const pipeline = read('lib/platform/guidance-engine/guidance-pipeline.ts');
assert.match(pipeline, /from '\.\/guidance-dedup\.mjs'/, 'Pipeline must import the shared dedup/cooling identity.');
assert.match(pipeline, /makeDedupGate\(\)/, 'Pipeline must use the identity-based dedup gate.');
assert.match(pipeline, /coolingKey\(event\.type, event\.id\)/, 'Cooldown check must key by identity, not bare type.');
assert.doesNotMatch(
  pipeline,
  /seenTypes\.has\(event\.type\)/,
  'Pipeline must NOT dedup by bare event.type — that collapsed all DEC insights to one card.',
);

console.log('guidance-dec-multicard: OK');
