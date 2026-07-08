/**
 * 行为契约:免费最大化·Calendar —— 与会人/地点/会议链接(Google OAuth 路径)。
 * 锁死:conferenceData 视频入会链接优先于 description 的 zoom 正则;与会人去掉自己;
 * location/organizer 透传;request 不设 fields 白名单(否则拿不到这些字段)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../app/api/portal/calendar/route.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function grab(name) {
  const re = new RegExp(`function ${name}\\b[\\s\\S]*?\\n\\}`, 'm');
  const m = js.match(re);
  assert.ok(m, `抽到 ${name}`);
  return m[0];
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext([grab('extractZoomFromText'), grab('conferenceUrl'), grab('mapGoogleCalendarItem'),
  'globalThis.__x = { mapGoogleCalendarItem, conferenceUrl };'].join('\n'), sandbox);
const { mapGoogleCalendarItem, conferenceUrl } = sandbox.__x;

// ── conferenceData 视频链接优先 ──
{
  const ev = mapGoogleCalendarItem({
    id: 'e1', summary: '周会', description: '旧链接 https://foo.zoom.us/j/999',
    start: { dateTime: '2026-07-08T13:00:00Z' }, end: { dateTime: '2026-07-08T14:00:00Z' },
    location: 'Room A', organizer: { displayName: 'Alice' },
    attendees: [
      { displayName: 'Alice', organizer: true },
      { displayName: '我', self: true },
      { email: 'bob@x.com' },
    ],
    conferenceData: { entryPoints: [
      { entryPointType: 'more', uri: 'https://meet.google.com/info' },
      { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' },
    ] },
    htmlLink: 'https://calendar.google.com/event?x',
  });
  assert.equal(ev.meetingUrl, 'https://meet.google.com/abc-defg-hij', 'conferenceData 视频链接优先(压过 zoom 正则)');
  assert.equal(ev.url, 'https://meet.google.com/abc-defg-hij', 'url 也用会议链接');
  assert.equal(ev.location, 'Room A');
  assert.equal(ev.organizer, 'Alice');
  assert.deepEqual([...ev.attendees], ['Alice', 'bob@x.com'], '与会人去掉自己,保留名称/邮箱');
}

// ── 无 conferenceData 时回退 description 的 zoom ──
{
  const ev = mapGoogleCalendarItem({
    id: 'e2', summary: 'x', description: 'join https://acme.zoom.us/j/123',
    start: { dateTime: '2026-07-08T13:00:00Z' }, end: { dateTime: '2026-07-08T14:00:00Z' },
  });
  assert.equal(ev.meetingUrl, 'https://acme.zoom.us/j/123', '无 conferenceData 退 zoom 正则');
  assert.equal(ev.attendees, undefined, '无与会人不出字段');
  assert.equal(ev.location, undefined);
}

// ── 无任何会议信息 → htmlLink 兜底,meetingUrl 不出 ──
{
  const ev = mapGoogleCalendarItem({ id: 'e3', summary: 'x', start: { date: '2026-07-08' }, htmlLink: 'https://calendar.google.com/e' });
  assert.equal(ev.url, 'https://calendar.google.com/e', 'url 退 htmlLink');
  assert.equal(ev.meetingUrl, undefined, '无会议链接不出 meetingUrl');
}

// ── 请求不设 fields 白名单(否则拿不到 conferenceData/attendees) ──
assert.ok(!/searchParams\.set\('fields'/.test(src), 'events.list 不限 fields');
assert.ok(src.includes('conferenceData') && src.includes('attendees'), '类型声明 conferenceData/attendees');

console.log('calendar-fields: OK');
