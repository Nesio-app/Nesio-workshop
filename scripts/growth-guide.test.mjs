/**
 * 行为契约:成长引导 v0(用户定:被动观察数据 → 个性化引导)。
 * 锁死:
 *  1) commitment_review:5–30 天未完成承诺入卡;<5 天 / 已 done / 会议记录本体不入;
 *  2) spend_shift:本月类目较上月涨 ≥$50 且 ≥30% 才入卡,取涨幅最大者;
 *  3) dusty_memory:≥21 天高置信记忆入卡,且同一天选择稳定(日幂等);
 *  4) 已回答(kind+refId 落成 growth.reflection Signal)不再出;
 *  5) recordGrowthAnswer 落一等公民 Signal(数据主权),growthHistory 重建回看流,
 *     growthStreakDays 连续天数(今天未答不打断昨天起的连续)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: requireImpl, console,
    Array, Object, JSON, Map, Set, String, Number, Boolean, Date, Math,
  });
  return mod.exports;
}

const NOW = new Date('2026-07-17T12:00:00.000Z').getTime();
const day = (n) => new Date(NOW - n * 86_400_000).toISOString();

function makeWorld({ nodes = [], txs = [] } = {}) {
  const signals = [];
  const gg = loadTs('../lib/portal/growth-guide.ts', (p) => {
    if (p.includes('life-graph')) return { getLifeGraph: () => nodes };
    if (p.includes('bank-tx')) return { loadBankTx: () => txs };
    if (p.includes('create-signal')) return { createSignal: (input) => { const s = { ...input, capturedAt: new Date(NOW).toISOString() }; signals.unshift(s); return s; } };
    if (p.includes('signal')) return { getSignals: (o) => signals.filter((s) => !o?.types?.length || o.types.includes(s.type)) };
    return {};
  });
  return { gg, signals };
}

const COMMIT_OLD = { id: 'c1', type: 'commitment', name: '给妈妈打电话聊搬家', createdAt: day(8), confidence: 1, attributes: {}, tags: [] };

// 1) commitment_review 规则边界
{
  const { gg } = makeWorld({ nodes: [
    COMMIT_OLD,
    { id: 'c2', type: 'commitment', name: '太新', createdAt: day(2), confidence: 1, attributes: {}, tags: [] },
    { id: 'c3', type: 'commitment', name: '已完成', createdAt: day(9), confidence: 1, attributes: { done: true }, tags: [] },
    { id: 'c4', type: 'commitment', name: '会议记录 · X', createdAt: day(9), confidence: 1, attributes: {}, tags: ['meeting-notes'] },
  ] });
  const cards = gg.todayGrowthCards(3, NOW);
  assert.equal(cards.filter((c) => c.kind === 'commitment_review').length, 1);
  assert.equal(cards[0].refId, 'c1');
  assert.ok(cards[0].question.includes('给妈妈打电话'));
}

// 2) spend_shift 阈值:≥$50 且 ≥30%,取最大涨幅
{
  const txs = [
    { id: 't1', date: '2026-06-05', name: 'a', amount: 100, currency: 'USD', category: '外卖' },
    { id: 't2', date: '2026-07-05', name: 'b', amount: 200, currency: 'USD', category: '外卖' },   // +100, +100%
    { id: 't3', date: '2026-06-06', name: 'c', amount: 500, currency: 'USD', category: '房租' },
    { id: 't4', date: '2026-07-06', name: 'd', amount: 540, currency: 'USD', category: '房租' },   // +40 <50 不入
    { id: 't5', date: '2026-07-07', name: 'e', amount: -80, currency: 'USD', category: '退款' },    // 负数不计
  ];
  const { gg } = makeWorld({ txs });
  const cards = gg.todayGrowthCards(3, NOW);
  const spend = cards.find((c) => c.kind === 'spend_shift');
  assert.ok(spend, 'spend_shift 卡存在');
  assert.ok(spend.question.includes('外卖'));
  assert.ok(!cards.some((c) => c.question.includes('房租')));
}

// 3) dusty_memory 日幂等 + 21 天线
{
  const nodes = [
    { id: 'm1', type: 'preference', name: '旧念头A', createdAt: day(30), confidence: 0.9, attributes: {}, tags: [] },
    { id: 'm2', type: 'preference', name: '旧念头B', createdAt: day(40), confidence: 0.9, attributes: {}, tags: [] },
    { id: 'm3', type: 'preference', name: '太新', createdAt: day(3), confidence: 0.9, attributes: {}, tags: [] },
    { id: 'm4', type: 'preference', name: '低置信', createdAt: day(40), confidence: 0.5, attributes: {}, tags: [] },
  ];
  const { gg } = makeWorld({ nodes });
  const a = gg.todayGrowthCards(3, NOW).find((c) => c.kind === 'dusty_memory');
  const b = gg.todayGrowthCards(3, NOW).find((c) => c.kind === 'dusty_memory');
  assert.ok(a && b && a.refId === b.refId, '同一天稳定');
  assert.ok(['m1', 'm2'].includes(a.refId), '只从合格池里挑');
}

// 4+5) 回答 → Signal → 去重 + 回看流 + streak
{
  const { gg, signals } = makeWorld({ nodes: [COMMIT_OLD] });
  const card = gg.todayGrowthCards(3, NOW)[0];
  gg.recordGrowthAnswer(card, '还想做,周末就打');
  assert.equal(signals.length, 1);
  assert.equal(signals[0].type, 'growth.reflection');
  assert.equal(signals[0].payload.refId, 'c1');
  assert.ok(!gg.todayGrowthCards(3, NOW).some((c) => c.refId === 'c1'), '已答不再出');
  const hist = gg.growthHistory();
  assert.equal(hist.length, 1);
  assert.equal(hist[0].answer, '还想做,周末就打');
  assert.equal(gg.growthStreakDays(NOW), 1);
  gg.recordGrowthAnswer({ ...card, refId: 'x2', id: 'commitment_review:x2' }, '  ');
  assert.equal(signals.length, 1, '空回答不落 Signal');
}

console.log('growth-guide contract tests passed');
