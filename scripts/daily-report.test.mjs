/**
 * 行为契约:每日日报生成器(纯函数)。
 * 锁死:日程升序、天气区间与降水概率、记忆分节、headline 概览、markdown 形状、
 * 无 emoji、空态判定(自动预生成据此跳过)、externalId 幂等键(同一天稳定)。
 *
 * ── 2026-07-30 改了三条,都是**用户拍板推翻旧行为**,不是回归 ──────────────
 *   ① 天气不再独立成节 —— 并进「今天」那一段(和 穿什么/吃什么/练什么 放一起)。
 *      跨面改版后天气只是「今天的底色」之一,单独一节撑不起来。
 *   ② 日程窗口从「今天剩余」改成**当天整天**。用户定了「早上 8 点定稿、当天不再变」,
 *      而人可能中午才打开这份「早上八点的日报」—— 用「今天剩余」的话早上那场会
 *      就从里面消失了,跟他早上看到的对不上。
 *   ③ 邮件从「列出亮点」改成**只给一行汇总 + 出口**。用户已经收到一份从邮件总结的
 *      日报,在这儿再抄一遍是更差的重复品,还会把只有 Nesio 知道的那几段挤下去。
 * 这三条的新判据在 scripts/daily-report-crossface.test.mjs 里正面钉住。
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
      { title: '一早已经开完的会', start: iso(6, 0) }, // 当天整天窗口 → 照样列(见文件头②)
    ],
    emailHighlights: ['账单到期提醒', '快递已发货'],
    memoryNotes: ['给妈妈买降压药'],
  });
  assert.equal(r.empty, false, '有内容不空');
  const cal = r.sections.find((s) => s.id === 'calendar');
  assert.ok(cal, '有日程节');
  // 当天整天,按时间升序
  assert.ok(cal.lines[0].includes('一早已经开完的会'), '当天日程按时间升序(最早的在前)');
  assert.ok(cal.lines.some((l) => l.includes('晨会')) && cal.lines.some((l) => l.includes('牙医')), '其余都在列');
  const today = r.sections.find((s) => s.id === 'today');
  assert.ok(today && today.lines[0].includes('18~27°C'), '天气报区间(现在并进「今天」那一段)');
  assert.ok(today.lines[0].includes('降水概率 60%'), '高降水概率并入');
  const mail = r.sections.find((s) => s.id === 'email');
  assert.equal(mail.lines.length, 1, '邮件只给一行汇总,不复述内容(见文件头③)');
  assert.ok(r.sections.some((s) => s.id === 'memory' && s.lines[0].includes('降压药')), '记忆提醒分节');
  assert.ok(/今天 3 个安排/.test(r.headline), 'headline 概览当天安排数');
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
  assert.ok(r.sections.some((s) => s.id === 'today'), '天气在「今天」那一段');
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
