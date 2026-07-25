/**
 * 行为契约:创建日程纯函数层(lib/portal/calendar-create.ts)。
 * validateDraft 门槛 / draftToGoogleEvent(定时·全天·默认时长)/ parseDraftFromLlm 容错 /
 * buildEventParsePrompt 锚点。只测纯函数,无 fetch/env/LLM。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/portal/calendar-create.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, JSON, Array, Object, Number, String, Boolean, Date, Math });
  return mod.exports;
}

const M = load();

// ── validateDraft ────────────────────────────────────────────────
assert.equal(M.validateDraft(null), 'no_draft');
assert.equal(M.validateDraft({ startISO: '2026-08-01T10:00:00+08:00' }), 'missing_summary');
assert.equal(M.validateDraft({ summary: '牙医' }), 'missing_start');
assert.equal(M.validateDraft({ summary: '牙医', startISO: 'not-a-date' }), 'bad_start');
assert.equal(
  M.validateDraft({ summary: '牙医', startISO: '2026-08-01T10:00:00+08:00', endISO: '2026-08-01T09:00:00+08:00' }),
  'end_before_start',
);
assert.equal(M.validateDraft({ summary: '牙医', startISO: '2026-08-01T10:00:00+08:00' }), null);

// ── draftToGoogleEvent:定时(带时区)默认 +1h ─────────────────────
const timed = M.draftToGoogleEvent({ summary: '牙医', startISO: '2026-08-01T15:00:00+08:00', timeZone: 'Asia/Shanghai' });
assert.equal(timed.summary, '牙医');
assert.equal(timed.start.dateTime, '2026-08-01T15:00:00+08:00');
assert.equal(timed.start.timeZone, 'Asia/Shanghai');
assert.ok(timed.end.dateTime, '默认补 end');
assert.equal(new Date(timed.end.dateTime) - new Date(timed.start.dateTime), 60 * 60 * 1000, '默认 +1h');

// ── draftToGoogleEvent:全天(纯日期 startISO)end 次日排他 ───────────
const allday = M.draftToGoogleEvent({ summary: '生日', startISO: '2026-08-01' });
assert.equal(allday.start.date, '2026-08-01');
assert.equal(allday.end.date, '2026-08-02', '全天 end.date = 次日(排他)');
assert.equal(allday.start.dateTime, undefined, '全天不应有 dateTime');

// ── draftToGoogleEvent:显式 allDay 标记 ─────────────────────────
const allday2 = M.draftToGoogleEvent({ summary: '假期', startISO: '2026-12-25', endISO: '2026-12-27', allDay: true });
assert.equal(allday2.end.date, '2026-12-27');

// ── parseDraftFromLlm:围栏 / 裸 JSON / 垃圾 ───────────────────────
const fenced = M.parseDraftFromLlm('好的\n```json\n{"summary":"牙医","startISO":"2026-08-01T15:00:00+08:00"}\n```');
assert.equal(fenced.summary, '牙医');
assert.equal(fenced.startISO, '2026-08-01T15:00:00+08:00');
const bare = M.parseDraftFromLlm('{"summary":"晚饭","startISO":"2026-08-01"} ');
assert.equal(bare.summary, '晚饭');
assert.equal(M.parseDraftFromLlm('没有 json'), null);
assert.equal(M.parseDraftFromLlm('{"startISO":"2026-08-01"}'), null, '缺 summary → null');

// ── buildEventParsePrompt:锚点齐全 ───────────────────────────────
const prompt = M.buildEventParsePrompt('周五下午3点约牙医', '2026-07-25T12:00:00+08:00', 'Asia/Shanghai');
assert.ok(prompt.includes('2026-07-25T12:00:00+08:00'), 'prompt 含当前时间');
assert.ok(prompt.includes('Asia/Shanghai'), 'prompt 含时区');
assert.ok(prompt.includes('周五下午3点约牙医'), 'prompt 含原文');

console.log('✓ calendar-create 契约通过');
