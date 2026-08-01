/**
 * 行为契约:「计划」内容的优先级排序 + 时间冲突检测(2026-08-01,#184)。
 *
 * 用户拍板范围:「关联」「blocker」分析没有真实数据源(reminders 没有优先级
 * 字段,life-graph 没有依赖/阻塞关系建模)——不做,不编造数据。只锁两项:
 *   ① 优先级:复用 lib/platform/attention-engine.ts 的确定性关键词规则(非 AI)
 *      给日历项/提醒重新排序,不再单纯按时间先后。
 *   ② 冲突:两个非全天事件的时间区间重叠才算冲突;全天事件、没写 end 的事件
 *      不参与冲突判定(不替它编时长)。
 *
 * 这里真编译 keyword-lexicon.ts + attention-engine.ts(而非 stub 空对象)——
 * 要测的正是"buildPlan 有没有真的用上这套规则打分",stub 掉就测不出回归。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function compile(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
function run(js, sandbox) {
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Date, RegExp, ...sandbox });
  return mod.exports;
}

const lexicon = run(compile('../lib/platform/keyword-lexicon.ts'), {});
const attn = run(compile('../lib/platform/attention-engine.ts'), {
  require: (p) => (p === './keyword-lexicon' ? lexicon : {}),
});

let remindersFixture = [];
const pr = run(compile('../lib/portal/periodic-report.ts'), {
  require: (p) => {
    if (p === '@/lib/platform/attention-engine') return attn;
    return {
      ingestLifeNode: () => {},
      getLifeGraph: () => [],
      listCompleted: () => [],
      listReminders: () => remindersFixture,
      looseThreads: () => [],
      listDailyReports: () => [],
    };
  },
  window: undefined,
});

// now 落在这一周(8/10~8/16)——plan 方向看的是下一周(8/17~8/23,见
// periodic-report-anchor.test.mjs 已经钉死的窗口方向)。
const now = new Date(2026, 7, 12);

// ── ① 优先级:日期越早的事越先做,但重要度更高的应该排到前面 ──────────────
remindersFixture = [];
const events = [
  { title: '买菜', start: '2026-08-17T09:00:00', end: '2026-08-17T09:30:00' },       // other(45),日期最早
  { title: '团队周会', start: '2026-08-18T10:00:00', end: '2026-08-18T11:00:00' },   // meeting(75)
  { title: '陈医生复诊', start: '2026-08-19T14:00:00', end: '2026-08-19T14:30:00' }, // medical(92),日期最晚
];
const planPriority = pr.buildPlan('week', events, [], now, 'zh');
const calSection = planPriority.sections.find((s) => s.id === 'calendar');
assert.ok(calSection, '有"已经排定的"这一段');
assert.match(calSection.title, /按重要度/, '段标题标注是按重要度排的');
// 用 join 比较,不用 assert.deepEqual——vm 沙箱里跑出来的数组和这里字面量数组
// 分属不同 realm,deepEqual 会因为"结构相同但引用不同"误报失败。
assert.equal(
  calSection.lines.map((l) => l.split(' · ')[1].split('(')[0]).join(','),
  ['陈医生复诊', '团队周会', '买菜'].join(','),
  '按重要度降序,不是按日期升序(医疗 92 > 会议 75 > 其他 45,日期反而是买菜最早)',
);
assert.ok(calSection.lines[0].includes('医疗预约'), '医疗类打上正确的类型标签');

// ── ② 冲突:两个时间重叠的事件应该被抓出来,不重叠的和全天的不应该 ────────
remindersFixture = [];
const eventsWithConflict = [
  { title: '与陈医生见面', start: '2026-08-18T14:00:00', end: '2026-08-18T14:30:00' },
  { title: '团队评审会', start: '2026-08-18T14:15:00', end: '2026-08-18T15:00:00' }, // 与上面重叠 14:15-14:30
  { title: '跑步', start: '2026-08-19T07:00:00', end: '2026-08-19T07:30:00' },
  { title: '写周报', start: '2026-08-19T08:00:00', end: '2026-08-19T08:30:00' }, // 不重叠
  { title: '公司周年庆', start: '2026-08-18T00:00:00', allDay: true },            // 全天,不参与冲突判定
];
const planConflict = pr.buildPlan('week', eventsWithConflict, [], now, 'zh');
const conflictSection = planConflict.sections.find((s) => s.id === 'conflicts');
assert.ok(conflictSection, '有冲突时必须出现"时间冲突"这一段');
assert.equal(conflictSection.lines.length, 1, '只有一对真的重叠,不多不少');
assert.match(conflictSection.lines[0], /14:00.*与陈医生见面.*14:15.*团队评审会/, '冲突行点名两边+各自的时间点');
assert.ok(!conflictSection.lines.some((l) => l.includes('周年庆')), '全天事件不参与冲突判定');
assert.ok(!conflictSection.lines.some((l) => l.includes('跑步') && l.includes('写周报')), '不重叠的一对不应该被判冲突');
assert.match(planConflict.headline, /时间重叠/, 'headline 提一句有冲突,不是憋着不说也不是报警式用词');

// ── 没有事件/冲突时,不出现冲突段,headline 照常 ──────────────────────────
remindersFixture = [];
const planNoConflict = pr.buildPlan('week', [
  { title: '写周报', start: '2026-08-19T08:00:00', end: '2026-08-19T08:30:00' },
], [], now, 'zh');
assert.ok(!planNoConflict.sections.find((s) => s.id === 'conflicts'), '没有冲突就不该有这一段(不硬造)');

console.log('periodic-report-plan: OK');
