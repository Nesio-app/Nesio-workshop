/**
 * 行为契约:周期报告(周报/月报)的锚点时间(2026-08-01 用户拍板改期)。
 * 原先锚点在**期初**(周一 8 点 / 每月 1 日 8 点)——下一期开始时才回头追认
 * 上一期的回顾。现在改到**期末**(周日下午 4 点 / 每月最后一天下午 4 点)——
 * 这一期快结束时就地生成:回顾看的是刚过完的这一期,计划看的是下一期。
 * 窗口方向随之整体后移一期,periodKey 必须跟着对。
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

// 只测纯日期逻辑(periodAnchor/periodDue/windowOf 经 buildRetrospect/buildPlan 间接验证)——
// 跨文件的 value import 在这个单文件沙箱里会被 require stub 成 undefined,所以把
// ingest/graph/schedule/thread/daily-report-persist 全部 stub 成最小实现,不影响纯逻辑。
const pr = run(compile('../lib/portal/periodic-report.ts'), {
  require: () => ({
    ingestLifeNode: () => {},
    getLifeGraph: () => [],
    listCompleted: () => [],
    listReminders: () => [],
    looseThreads: () => [],
    listDailyReports: () => [],
  }),
  window: undefined,
});

// 周锚点:2026-08-10(周一)到 2026-08-16(周日)这一周,锚点应落在周日 16:00。
const midWeek = new Date(2026, 7, 12); // 周三
const weekAnchor = pr.periodAnchor('week', midWeek);
assert.equal(weekAnchor.getFullYear(), 2026);
assert.equal(weekAnchor.getMonth(), 7);
assert.equal(weekAnchor.getDate(), 16, '周锚点是这一周的周日');
assert.equal(weekAnchor.getDay(), 0, '周锚点当天是周日');
assert.equal(weekAnchor.getHours(), 16, '周锚点是下午 4 点');

// periodDue:锚点前一刻未到点,锚点整点及之后到点。
assert.equal(pr.periodDue('week', new Date(2026, 7, 16, 15, 59, 59)), false, '周日 15:59 还没到点');
assert.equal(pr.periodDue('week', new Date(2026, 7, 16, 16, 0, 0)), true, '周日 16:00 整到点');
assert.equal(pr.periodDue('week', new Date(2026, 7, 16, 16, 0, 1)), true, '周日 16:00 之后仍到点');

// 月锚点:2026-08 有 31 天,锚点应落在 8 月 31 日 16:00(不是 9 月 1 日)。
const midMonth = new Date(2026, 7, 12);
const monthAnchor = pr.periodAnchor('month', midMonth);
assert.equal(monthAnchor.getMonth(), 7, '月锚点仍在这个月(8 月),不是下个月');
assert.equal(monthAnchor.getDate(), 31, '月锚点是这个月最后一天');
assert.equal(monthAnchor.getHours(), 16, '月锚点是下午 4 点');
assert.equal(pr.periodDue('month', new Date(2026, 7, 31, 15, 59, 59)), false, '月末 15:59 还没到点');
assert.equal(pr.periodDue('month', new Date(2026, 7, 31, 16, 0, 0)), true, '月末 16:00 整到点');

// 窗口方向:锚点落在期末,回顾看**这一期**,计划看**下一期**——用 buildRetrospect/
// buildPlan 的 periodKey(report.date)间接验证 windowOf(未导出)。
const week = pr.buildRetrospect('week', [], midWeek, 'zh');
assert.equal(week.date, '2026-W33', '周回顾的 periodKey 是「这一周」(8/10~8/16),不是上一周');
const weekPlan = pr.buildPlan('week', [], [], midWeek, 'zh');
assert.equal(weekPlan.date, '2026-W34', '周计划的 periodKey 是「下一周」(8/17~8/23)');

const month = pr.buildRetrospect('month', [], midMonth, 'zh');
assert.equal(month.date, '2026-08', '月回顾的 periodKey 是「这个月」,不是上个月');
const monthPlan = pr.buildPlan('month', [], [], midMonth, 'zh');
assert.equal(monthPlan.date, '2026-09', '月计划的 periodKey 是「下个月」');

console.log('periodic-report-anchor: OK');
