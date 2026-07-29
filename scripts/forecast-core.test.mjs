/**
 * 行为契约:预测回测核(forecast-core)。
 * 最重要的一条是**防未来泄漏** —— 回测里预测器只要看到一眼未来,整份准确率就是假的,
 * 而假的准确率比没有预测更危险(它会骗我们把不该上线的东西放行)。
 * 其余锁死:技能分/分位数/裁决门槛的算法,以及「最后残月不当真值」。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, Date, Math, Number, Array, Object, String, Set, Map, JSON });
  return mod.exports;
}
const F = loadTs('../lib/portal/forecast-core.ts');

// ── 基础工具 ──
assert.equal(F.ymOf('2026-03-15'), '2026-03');
assert.equal(F.dayOf('2026-03-05'), 5);
assert.equal(F.daysInMonth('2026-02'), 28, '平年 2 月 28 天');
assert.equal(F.daysInMonth('2024-02'), 29, '闰年 2 月 29 天');
assert.equal(F.daysInMonth('2026-01'), 31);

// ── 防泄漏:visibleAt ──
const rows = [
  { date: '2026-01-05', amount: 100 },
  { date: '2026-01-15', amount: 50 },
  { date: '2026-01-16', amount: 999 }, // cutoff 之后,绝不能被看到
  { date: '2026-01-28', amount: 777 },
];
const vis = F.visibleAt(rows, '2026-01-15');
assert.equal(vis.length, 2, 'cutoff 当天保留,之后剔除');
assert.ok(vis.every((r) => r.date <= '2026-01-15'), '没有任何未来行');
assert.ok(!vis.some((r) => r.amount === 999 || r.amount === 777), '未来金额没漏进来');

// ── 防泄漏:backtest 走查全程不给预测器看未来(用探针预测器抓现行)──
const multi = [];
for (const ym of ['2026-01', '2026-02', '2026-03', '2026-04']) {
  multi.push({ date: `${ym}-03`, amount: 500 });
  multi.push({ date: `${ym}-20`, amount: 300 }); // 20 号 > cutoff 15,回测中必须不可见
}
const seen = [];
F.backtest(multi, {
  cutoffDay: 15,
  predict: (visible, cutoff) => { seen.push({ cutoff, dates: visible.map((r) => r.date) }); return 100; },
  naive: () => 100,
});
assert.ok(seen.length >= 2, '至少走查到两个月');
for (const s of seen) {
  assert.ok(s.dates.every((d) => d <= s.cutoff), `预测器在 ${s.cutoff} 看到了未来数据:${s.dates.filter((d) => d > s.cutoff).join(',')}`);
  // 精确到「当月」:往月的 20 号是历史(可见),本月的 20 号是未来(必须不可见)。
  const ownMonth = s.cutoff.slice(0, 7);
  assert.ok(!s.dates.includes(`${ownMonth}-20`), `本月 20 号(晚于 cutoff ${s.cutoff})泄漏进了可见集`);
  assert.ok(s.dates.includes(`${ownMonth}-03`), '本月 cutoff 之前的行应当可见');
}

// ── 真值与月份 ──
assert.equal(F.monthTotal(rows, '2026-01'), 1926);
assert.deepEqual([...F.monthsPresent(multi)], ['2026-01', '2026-02', '2026-03', '2026-04']);
// 最后一个月是残月(可能还没走完)→ 不当真值
const samples = F.backtest(multi, { cutoffDay: 15, predict: () => 800, naive: () => 800 });
assert.ok(samples.every((s) => s.ym !== '2026-04'), '最后一个月不进样本(残月不当真值)');
assert.ok(samples.length >= 2, `应有 ≥2 个样本,实际 ${samples.length}`);

// ── 预测器行为 ──
// 日均外推:15 号已花 500,当月 31 天 → 500/15*31
const janVis = F.visibleAt(multi, '2026-02-15');
const rr = F.predictMonthEndRunRate(janVis, '2026-02-15');
assert.ok(Math.abs(rr - (500 / 15) * 28) < 0.02, `2 月日均外推应为 500/15*28,实际 ${rr}`);
assert.equal(F.predictMonthEndRunRate([], '2026-02-15'), null, '本月没花钱 → 不硬猜,返回 null');
// 尾段中位数:已发生 500 + 历史同期尾段(每月 20 号 300)→ 800
const tm = F.predictMonthEndTailMedian(F.visibleAt(multi, '2026-03-15'), '2026-03-15');
assert.equal(tm, 800, `已发生 500 + 尾段中位数 300 = 800,实际 ${tm}`);
assert.equal(F.predictMonthEndTailMedian(F.visibleAt(multi, '2026-01-15'), '2026-01-15'), null, '没有历史月 → 不编,返回 null');

// ── 笨基线 ──
assert.equal(F.naiveLastMonth(F.visibleAt(multi, '2026-03-15'), '2026-03-15'), 800, '上月总额 500+300');
assert.equal(F.naiveLastMonth(F.visibleAt(multi, '2026-01-15'), '2026-01-15'), null, '没有上月 → null');
assert.equal(F.naiveMedian3(F.visibleAt(multi, '2026-04-15'), '2026-04-15'), 800);

// ── 统计 ──
assert.equal(F.median([3, 1, 2]), 2);
assert.equal(F.median([4, 1, 2, 3]), 2.5);
assert.equal(F.quantile([0, 10], 0.5), 5, '两点中位线性插值');
assert.equal(F.quantile([0, 10, 20, 30, 40], 0.8), 32);
assert.equal(F.quantile([], 0.8), 0, '空集不炸');

// ── 评分:技能分 = 1 − mae/naiveMae ──
const mk = (pred, actual, naive) => ({ cutoff: '2026-01-15', ym: '2026-01', pred, actual, naive });
// 模型每次差 10,笨基线每次差 20 → 技能分 0.5
const good = F.scoreSamples('good', Array.from({ length: 10 }, () => mk(110, 100, 120)));
assert.equal(good.mae, 10);
assert.equal(good.naiveMae, 20);
assert.equal(good.skill, 0.5);
assert.equal(good.verdict, 'adopt', '赢笨基线一半 → 采纳');
assert.equal(good.bias, 10, '每次高 10 → 系统性高估 10');
assert.equal(good.mape, 10);

// 模型比笨基线差 → 必须否决(这条是整套设计的立身之本)
const bad = F.scoreSamples('bad', Array.from({ length: 10 }, () => mk(150, 100, 110)));
assert.ok(bad.skill < 0, '打不过笨基线技能分为负');
assert.equal(bad.verdict, 'reject', '打不过笨基线 → 否决,不许上线');

// 样本不足 → 不下结论(哪怕看起来很准)
const few = F.scoreSamples('few', Array.from({ length: 3 }, () => mk(100, 100, 200)));
assert.equal(few.verdict, 'unproven', `样本 <${F.MIN_SAMPLES} 一律存疑,不许因为「看着准」放行`);

// 赢得太少也不算数(避免为 3% 的提升引入一套复杂度):mae 2 vs 笨基线 2.06 → 技能分 2.9%
const meh = F.scoreSamples('meh', Array.from({ length: 10 }, () => mk(102, 100, 102.06)));
assert.ok(meh.skill > 0 && meh.skill < F.MIN_SKILL, `技能分应落在 (0, ${F.MIN_SKILL}),实际 ${meh.skill}`);
assert.equal(meh.verdict, 'unproven', '优势 <5% → 存疑');

// 完全没样本不炸
assert.equal(F.scoreSamples('none', []).verdict, 'unproven');

// ── 区间来自残差,不是拍脑袋 ──
const spread = F.scoreSamples('spread', [
  mk(100, 100, 200), mk(105, 100, 200), mk(110, 100, 200), mk(90, 100, 200), mk(95, 100, 200),
  mk(120, 100, 200), mk(100, 100, 200), mk(103, 100, 200), mk(97, 100, 200), mk(101, 100, 200),
]);
assert.ok(spread.p80Pct > 0 && spread.p80Pct <= 20, `p80 应落在真实残差范围内,实际 ${spread.p80Pct}`);
const errsSorted = [0, 1, 2, 3, 3, 5, 5, 10, 10, 20];
assert.equal(spread.p80Pct, F.quantile(errsSorted, 0.8), 'p80 就是残差分布的 p80,没有别的来源');

// ── 绝对可用性门槛:赢过笨基线 ≠ 能用(首轮真实回测的教训)──
// 技能分很高,但区间 ±100% → 「月底大概花 1000,上下浮动一千」,不许上线。
const wide = F.scoreSamples('wide', [
  mk(10, 100, 500), mk(190, 100, 500), mk(20, 100, 500), mk(180, 100, 500),
  mk(30, 100, 500), mk(170, 100, 500), mk(40, 100, 500), mk(160, 100, 500),
  mk(50, 100, 500), mk(150, 100, 500),
]);
assert.ok(wide.skill > F.MIN_SKILL, `技能分应远超门槛,实际 ${wide.skill}`);
assert.ok(wide.p80Pct > F.MAX_P80_PCT, `区间应超上限,实际 ±${wide.p80Pct}%`);
assert.equal(wide.verdict, 'unusable', '赢了笨基线但区间没法给人看 → 不可用,不许上线');

// ── 开口率门槛:三分之二时候说不出话的预测器,再准也不是功能 ──
const rarely = F.scoreSamples('rarely', Array.from({ length: 10 }, () => mk(101, 100, 130)), 0.33);
assert.equal(rarely.verdict, 'sparse', '开口率 33% → 判 sparse');
assert.equal(rarely.coverage, 0.33);
// 开口率达标时不受影响
assert.equal(F.scoreSamples('ok', Array.from({ length: 10 }, () => mk(101, 100, 130)), 0.9).verdict, 'adopt');

// ── 配对回测:横向比较只能在共同可比月份上做 ──
// 造一个「A 只在有月初消费时开口、B 一直开口」的局面,验证 common 与 coverage。
const pairRows = [];
for (const ym of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']) {
  if (ym !== '2026-03') pairRows.push({ date: `${ym}-05`, amount: 200 }); // 3 月没有月初消费
  pairRows.push({ date: `${ym}-25`, amount: 100 });
}
const run = F.backtestPaired(pairRows, 15, {
  A: F.predictMonthEndRunRate,          // 本月 15 号前没花钱 → null
  B: (v, c) => (F.naiveLastMonth(v, c) ?? 0) + 1, // 永远给得出值(除首月)
  N: F.naiveLastMonth,
});
assert.ok(!run.months.includes('2026-05'), '残月不进走查');
assert.ok(run.values.A['2026-03'] == null, '3 月 15 号前无消费 → A 开不了口');
assert.ok(!run.common.includes('2026-03'), '有人开不了口的月份不进共同集');
assert.ok(run.common.every((ym) => run.values.A[ym] != null && run.values.N[ym] != null), 'common 里所有预测器都有值');
assert.ok(run.coverage.A < 1, `A 的开口率应 <100%,实际 ${run.coverage.A}`);

// pairedSamples 只在 common 上取,且三方对齐
const ps = F.pairedSamples(run, 'A', 'N');
assert.equal(ps.length, run.common.length, '样本数 = 共同月份数');
for (const s of ps) {
  assert.ok(Number.isFinite(s.pred) && Number.isFinite(s.naive) && Number.isFinite(s.actual), '三个值都齐');
  assert.equal(s.actual, run.actual[s.ym], '真值取自同一张表');
}

// ── 门槛常量对外可见(改门槛必须是显式决定)──
assert.equal(F.MIN_SAMPLES, 8);
assert.equal(F.MIN_SKILL, 0.05);
assert.equal(F.MAX_P80_PCT, 25);
assert.equal(F.MIN_COVERAGE, 0.8);

console.log('forecast-core: OK(防泄漏 + 技能分 + 残差区间 + 裁决门槛)');
