/**
 * 行为契约:ICS 日历时区(用户实测:纽约上午 9 点的会议显示成 05:00)。
 * 锁死:DTSTART;TZID=<IANA> 的墙上时间按该时区换算成 UTC 时刻(与服务器时区无关);
 * Z 结尾按 UTC;DST 两侧偏移各自正确;未知 TZID 容错;端到端 TZID 事件时间正确。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, process: { env: {} }, console, Date, Math, JSON, Number, Array, Object, String, Intl });
  return mod.exports;
}
const ics = loadTs('../lib/portal/providers/ics.ts', () => ({}));

// ── parseIcsDate 直测:核心修复 —— 纽约夏令时(EDT,UTC-4)9:00 → 13:00Z
// (此前 UTC 服务器把墙上时间当服务器本地,存成 09:00Z,客户端显示 05:00)──
assert.equal(ics.parseIcsDate('20260717T090000', 'America/New_York').toISOString(), '2026-07-17T13:00:00.000Z', 'EDT 9:00 = 13:00Z');
// DST 另一侧:冬令时(EST,UTC-5)9:00 → 14:00Z(偏移随 DST 变,不能写死 -4)
assert.equal(ics.parseIcsDate('20261217T090000', 'America/New_York').toISOString(), '2026-12-17T14:00:00.000Z', 'EST 9:00 = 14:00Z');
// 上海(无 DST,UTC+8)9:00 → 01:00Z
assert.equal(ics.parseIcsDate('20260717T090000', 'Asia/Shanghai').toISOString(), '2026-07-17T01:00:00.000Z', 'CST 9:00 = 01:00Z');
// Z 结尾按 UTC,不受 TZID 影响
assert.equal(ics.parseIcsDate('20260717T130000Z', 'America/New_York').toISOString(), '2026-07-17T13:00:00.000Z', 'Z 形式原样');
// 未知 TZID 容错不炸(退回运行环境本地解析)
assert.ok(ics.parseIcsDate('20260717T090000', 'Mars/Olympus') instanceof Date, '未知时区容错');
// 全天(8 位)本地日历日语义,不被时区逻辑波及
const allday = ics.parseIcsDate('20260717', 'America/New_York');
assert.equal(allday.getDate(), 17, '全天事件日历日');

// ── 端到端:TZID 事件走 parseIcsEvents(近期日期过 30 天窗)──
const soon = new Date(Date.now() + 3 * 86_400_000);
const y = soon.getUTCFullYear(); const mo = String(soon.getUTCMonth() + 1).padStart(2, '0'); const d = String(soon.getUTCDate()).padStart(2, '0');
const icsText = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:u1\nSUMMARY:Meeting\nDTSTART;TZID=America/New_York:${y}${mo}${d}T090000\nDTEND;TZID=America/New_York:${y}${mo}${d}T100000\nEND:VEVENT\nEND:VCALENDAR`;
const [ev] = ics.parseIcsEvents(icsText, 12, '');
assert.ok(ev, '事件被解析');
const h = new Date(ev.start).getUTCHours();
assert.ok(h === 13 || h === 14, `TZID 事件换算成 UTC 时刻(9:00 ET → 13/14:00Z,得 ${h}:00Z)`);
assert.ok(new Date(ev.end).getTime() - new Date(ev.start).getTime() === 3_600_000, 'DTEND 同步换算,时长 1 小时');

console.log('ics-timezone: OK');
