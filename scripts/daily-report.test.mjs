/**
 * 行为契约:每日图文日报生成器(块1,纯函数)。
 * 锁死:前瞻(今天/临近安排)、天气区间、邮件/记忆分节、headline 概览、markdown 形状、
 * 空态判定(自动预生成据此跳过)、externalId 幂等键(同一天稳定)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/daily-report.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports }); // 模块无 import,无需 require
const { buildDailyReport, dailyReportExternalId } = mod.exports;

// 用本地分量构造(与 buildDailyReport 里的 getHours/getTime 同 tz,避免测试机时区干扰)。
const NOW = new Date(2026, 6, 9, 8, 0, 0);           // 本地 2026-07-09 08:00
const iso = (h, m = 0) => new Date(2026, 6, 9, h, m, 0).toISOString();

// ── 有日程 + 天气 + 邮件 + 记忆 ──
{
  const r = buildDailyReport({
    displayName: '小明', now: NOW, locale: 'zh',
    weather: { tempMinC: 18, tempMaxC: 27, condition: '多云', precipProb: 60, placeLabel: 'Cary, NC' },
    events: [
      { title: '牙医', start: iso(15, 0), location: '诊所' },
      { title: '晨会', start: iso(9, 30) },
      { title: '昨天的事', start: iso(6, 0) }, // 早于 now-30min → 不算今天剩余
    ],
    emailHighlights: ['账单到期提醒', '快递已发货'],
    memoryNotes: ['给妈妈买降压药'],
  });
  assert.equal(r.empty, false, '有内容不空');
  const cal = r.sections.find((s) => s.id === 'calendar');
  assert.ok(cal, '有日程节');
  // 今日剩余按时间升序:晨会(9:30)在牙医(15:00)前;过去的事不列
  assert.ok(cal.lines[0].includes('晨会'), '今日日程按时间升序,晨会在前');
  assert.ok(cal.lines.some((l) => l.includes('牙医')), '牙医在列');
  assert.ok(!cal.lines.some((l) => l.includes('昨天的事')), '已过去的安排不列入今日剩余');
  assert.ok(r.sections.some((s) => s.id === 'weather' && s.lines[0].includes('18~27°C')), '天气报区间');
  assert.ok(r.sections.some((s) => s.id === 'weather' && s.lines[0].includes('降水概率 60%')), '高降水概率并入');
  assert.ok(r.sections.some((s) => s.id === 'email' && s.lines.length === 2), '邮件亮点分节');
  assert.ok(r.sections.some((s) => s.id === 'memory' && s.lines[0].includes('降压药')), '记忆提醒分节');
  assert.ok(/今天 2 个安排/.test(r.headline), 'headline 概览今日安排数(仅今天剩余的 2 个)');
  assert.ok(r.title.startsWith('每日日报'), 'title 字段');
  assert.ok(r.markdown.startsWith(`# ${r.title}`), 'markdown 标题 = title');
  assert.ok(r.markdown.includes('## 今日日程'), 'markdown 含日程节');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(r.markdown), 'markdown 无 emoji');
}

// ── 空日程:给"专注深度工作"文案,不算空(只要有天气/邮件之一就非空)──
{
  const r = buildDailyReport({ now: NOW, locale: 'zh', events: [], weather: { temperatureC: 20, condition: '晴' } });
  const cal = r.sections.find((s) => s.id === 'calendar');
  assert.ok(cal.lines[0].includes('专注深度工作'), '空日程给深度工作文案');
  assert.equal(r.empty, false, '有天气 → 非空');
}

// ── 全空 → empty:true(自动预生成跳过)──
{
  const r = buildDailyReport({ now: NOW, locale: 'zh', events: [] });
  assert.equal(r.empty, true, '无天气/日程/邮件/记忆 → empty');
}

// ── 英文 locale ──
{
  const r = buildDailyReport({ now: NOW, locale: 'en', displayName: 'Sam', weather: { temperatureC: 20, condition: 'Sunny' }, events: [{ title: 'Standup', start: iso(9, 30) }] });
  assert.ok(r.greeting.includes('Good morning') && r.greeting.includes('Sam'), 'en 问候');
  assert.ok(r.title.startsWith('Daily report'), 'en title');
  assert.ok(r.markdown.startsWith('# Daily report'), 'en markdown 标题');
  assert.ok(/1 event today/.test(r.headline), 'en headline');
}

// ── externalId 同一天稳定、跨天不同 ──
assert.equal(dailyReportExternalId(new Date('2026-07-09T23:00:00')), 'daily-report-2026-07-09', 'externalId 幂等键按本地日期');
assert.notEqual(dailyReportExternalId(new Date('2026-07-09')), dailyReportExternalId(new Date('2026-07-10')), '跨天不同键');

console.log('daily-report: OK');
