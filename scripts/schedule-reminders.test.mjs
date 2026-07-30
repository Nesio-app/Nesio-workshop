/**
 * 行为契约:我自己设的提醒(2026-07-30 用户要求
 *「日程里面可以增加我明确设置时间的提醒项目么,比如家务活,比如账单 due 等」)。
 *
 * 这件事和 2026-07-28 那条「周期提醒、还款、缴费、课程、家务项目不显示」看似打架,
 * 其实分界线是**谁设的**:同步进来的循环任务继续挡在门外(会把真约会淹掉),
 * 用户亲手敲的一个字都不许被关键词吃掉。所以第一条要钉的就是:
 * 提醒这条路**不许**经过 CHORE_RE —— 否则用户设的「交房租」会被自己的过滤器删掉,
 * 而且是静默的:他会以为没存上。
 *
 * 另外三条:
 *   ② 时间存**墙上时钟**,不折 UTC。「每月 15 号 9 点」是关于钟面的事,
 *      折成 UTC 再折回来,换时区/夏令时会漂成 8 点;
 *   ③ 「做好了」要一路推到**真的在未来**,不是简单 +1 期 —— 一张月账单落下三个月,
 *      推一次还是过去的时刻,那条提醒立刻又显示成没做,得点好几次才追得上;
 *   ④ 月推要**月末对齐**:1/31 + 1 月 = 2/28,不是 3/3。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function loadTs(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console,
    require: (id) => (String(id).includes('idb-blob-store')
      ? { createBlobStore: () => ({ load: () => [], save: () => {}, ready: () => Promise.resolve() }) }
      : {}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean,
  });
  return mod.exports;
}

const { nextOccurrence, parseWallClock, formatWallClock } =
  loadTs('lib/portal/schedule-reminders.ts');

/* ── ① 提醒不许经过日历那条 CHORE_RE ─────────────────────────────── */
{
  const panel = strip(read('components/portal/insights/SchedulePanel.tsx'));

  assert.match(panel, /RemindersSection/,
    '用户自己设的提醒要有自己的一段 —— 不是塞进那份 Row 列表里' +
    '(Row 上挂着 LifeNode:硬塞就得造假节点,删除会去删一个不存在的 id)');

  // CHORE_RE 只准用在日历项那条路上。提醒那一段落进它的射程 = 用户设的「交房租」
  // 被自己的过滤器静默删掉。
  const choreUses = [...panel.matchAll(/CHORE_RE\.test\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.equal(choreUses.join(' | '), 'n.name',
    'CHORE_RE 只准过滤从日历同步进来的节点(n.name)。' +
    '一旦它碰到用户手写的提醒,「交房租」「倒垃圾」会被静默吃掉 —— ' +
    '而这两个正是用户点名要加进来的例子');

  const section = panel.slice(panel.indexOf('function RemindersSection'));
  const body = section.slice(0, section.indexOf('\n}\n'));
  assert.doesNotMatch(body, /CHORE_RE/, '提醒那一段里不许出现 CHORE_RE');
  assert.match(body, /matchesSearch\(/,
    '搜索要管到提醒 —— 用户搜「房租」时不会在意这条是提醒还是日历项');
  // 写入失败要说出来(全仓红线:不许静默吞掉存储失败)
  assert.match(body, /listReminders\(\)/, '存完要从存储回读,不信返回值');
  assert.match(body, /role="alert"/, '存不下来必须有看得见的失败态,不能默默回到空表单');
}

/* ── ② 墙上时钟:存的是本地钟面,不是 UTC ────────────────────────── */
{
  const d = parseWallClock('2026-08-15T09:00');
  assert.ok(d, '标准格式要解析得出来');
  assert.equal(d.getHours(), 9, '9 点就是本地的 9 点 —— 不许在这里折 UTC');
  assert.equal(d.getMonth(), 7);
  assert.equal(formatWallClock(d), '2026-08-15T09:00', '来回一趟不许变形');
  assert.equal(parseWallClock('2026-08-15T09:00:00Z'), null, '带时区的写法不是这个字段该收的东西');
  assert.equal(parseWallClock('明天早上'), null, '认不出来就是 null,不许猜一个时间出来');

  const src = read('lib/portal/schedule-reminders.ts');
  assert.doesNotMatch(src, /toISOString\(\)[^;]*at\b/, '提醒时刻不许走 toISOString');
}

/* ── ③ 「做好了」推到真的在未来 ──────────────────────────────────── */
{
  const now = new Date(2026, 6, 30, 12, 0);   // 2026-07-30 12:00

  // 一张 4 月就该交的月账单,落下三个月才点「做好了」。
  const next = nextOccurrence('2026-04-15T09:00', undefined, 1, now);
  const nd = parseWallClock(next);
  assert.ok(nd.getTime() > now.getTime(),
    '下一次必须真的在未来。只 +1 个周期的话,落下三个月的账单点一次还是过去的时刻 —— ' +
    '那条提醒立刻又显示成没做,得连点好几次才追得上');
  assert.equal(next, '2026-08-15T09:00', '追到刚过 now 的那一期就停,不是跳到明年');

  // 每周的同理
  assert.equal(
    parseWallClock(nextOccurrence('2026-06-01T20:00', 7, undefined, now)).getTime() > now.getTime(),
    true, '每周的也要追到未来');

  // 不重复的没有下一次 —— 它该被打勾,不是被凭空续一期
  assert.equal(nextOccurrence('2026-04-15T09:00', undefined, undefined, now), null,
    '只此一次的提醒不许自己长出下一次');
}

/* ── ④ 月推月末对齐 ─────────────────────────────────────────────── */
{
  // 1/31 + 1 月:2 月没有 31 号。滑到 3/3 的话,「每月月底交」会变成「每月月初交」。
  const n = nextOccurrence('2026-01-31T09:00', undefined, 1, new Date(2026, 0, 31, 10, 0));
  assert.equal(n, '2026-02-28T09:00',
    '1/31 + 1 月 = 2/28,不是 3/3。溢出到下个月会让「每月月底」慢慢漂成「每月月初」');
  assert.equal(parseWallClock(n).getHours(), 9, '推日期不许把时刻也推没了');
}

/* ── ⑤ 存储类别登记 ─────────────────────────────────────────────── */
{
  const reg = read('scripts/storage-key-registry.test.mjs');
  assert.match(reg, /\["nesio-schedule-reminders-v1", "durable"\]/,
    '用户亲手写下的提醒必须是 durable —— 换台设备后从头开始是不对的');
}

console.log('schedule-reminders: OK(不经过 CHORE_RE / 墙上时钟 / 推到未来 / 月末对齐 / 已登记)');
