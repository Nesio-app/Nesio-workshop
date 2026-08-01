/**
 * 行为契约:我自己设的提醒,问得到、看得见时间(2026-08-01,用户三张截图)。
 *
 *   ① 「关于提醒这条系统在日程里,不进记忆,是不是问问就搜不到」——
 *      实测正是如此:他问「下午有什么安排」,念念列了四条 Zoom 会议,
 *      唯独漏掉他自己设在 14:00 的「去看牙医」。
 *
 *      根因不在记忆:提醒的身影节点(reminder-shadow)一直在建,type 也确实是
 *      commitment(这个仓里 task 就归一到 commitment,见 create-signal.ts)。
 *      断在**上下文**:buildCalendarContext 只读 Google 日历缓存,
 *      schedule-reminders 里的东西从来没进过喂给 AI 的那段字。
 *      而语义检索那条路也救不了 —— 「下午有什么安排」和「去看牙医」
 *      字面上一个字都不重合。时间型问题要按时间窗取,不是按相似度取。
 *
 *   ② 「日程里预览除了显示日期还应该显示时间如果有的话」——
 *      一条设在 14:00 的提醒,列表右侧只写「8月1日」。而这一列本来就有钟点。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ══ ① 提醒必须进「问一问」的日程上下文 ═══════════════════════════════════ */
{
  const chat = stripComments(read('components/portal/NesioChatSheet.tsx'));
  const fn = chat.slice(chat.indexOf('function buildCalendarContext'), chat.indexOf('const MAX_STORED'));
  assert.ok(fn.length > 300, '找不到 buildCalendarContext —— 判据挂在这一段上,比错块就会假绿');

  assert.match(fn, /listReminders\(\)/,
    '喂给 AI 的日程上下文必须把 schedule-reminders 一起带上 —— ' +
    '只读 Google 日历的话,用户自己设的提醒 AI 手上压根没有,答得再好也答不出来');
  // 光调到还不够:取回来的东西得真的拼进返回的那段字
  assert.match(fn, /parts\.push\([^)]*\.map\(fmtRem\)/,
    '提醒取回来了却没拼进上下文 —— 那和没取一样');
  // 时间窗要和日历事件同一套(问「下午」就该拿下午那几条),不是无差别全塞
  assert.match(fn, /isInSpan\(d, temporal\)/,
    '提醒也要过同一个时间窗 —— 无差别全塞进去,「下午有什么安排」会连下周的一起念');
  // 分开标注来源:一条是别人排给我的,一条是我自己定的
  assert.match(fn, /我设的提醒/, '提醒要和日历事件分开标注,AI 说的时候才能说清楚是哪一种');
  // 早退不能把提醒一起挡掉:原来是「日历为空就 return ''」
  assert.match(fn, /events\.length === 0 && reminders\.length === 0/,
    '没有日历但有提醒时不许早退 —— 只连了提醒、没连 Google 日历的人会一条都问不到');

  // 调用点还在(函数改对了但没人调 = 白改)
  assert.match(chat, /calendarContext:\s*canUsePrivateData \? buildCalendarContext\(/,
    'buildCalendarContext 的调用点没了');
}

/* ══ ② 提醒的身影确实在建,而且带着钟点 ═══════════════════════════════════ */
{
  // 真跑。**不用源码判据** —— 第一版写的是 assert.match(src, /dueDate: r\.at/),
  // 注入回归当场抓出来:改成 `dueDate: r.at.slice(0, 10)` 之后,
  // 那个正则照样匹配得到子串、照样绿,而钟点已经丢了。
  const js = ts.transpileModule(read('lib/portal/reminder-shadow.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const seen = [];
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, Date, String, Object, JSON,
    require: (spec) => {
      if (String(spec).includes('today-commands')) {
        return { addCommitmentNode: (name, attrs) => { seen.push({ name, attrs }); return { id: 'n1' }; } };
      }
      if (String(spec).includes('schedule-reminders')) return { repeatLabel: () => '' };
      return { getLifeGraph: () => [], deleteLifeNode: () => {} };
    },
  });

  const id = mod.exports.createReminderShadow({ id: 'r1', title: '去看牙医', at: '2026-08-01T14:00', kind: 'other' });
  assert.equal(id, 'n1', '身影没建出来 —— 提醒就只活在日程页那一屏');
  assert.equal(seen.length, 1, `应当只建一条身影,实际 ${seen.length}`);
  const { attrs } = seen[0];
  // 钟点不能丢:只存 YYYY-MM-DD 的话,时间线/今日焦点上会变成「明天(某个时候)」,
  // 而用户明明说了三点。
  assert.equal(attrs.dueDate, '2026-08-01T14:00',
    `dueDate 要存完整墙上时钟(拿到 ${JSON.stringify(attrs.dueDate)}) —— ` +
    'node-dates 里 dueDate 排在 remindAt 前面,firstNodeDate 会先命中它');
  assert.equal(attrs.remindAt, '2026-08-01T14:00',
    `remindAt 是语义最准的那个键(拿到 ${JSON.stringify(attrs.remindAt)}),下游按它找的时候别扑空`);
  assert.equal(attrs.dueTime, '14:00', `dueTime 给只读时分的地方(拿到 ${JSON.stringify(attrs.dueTime)})`);
  assert.equal(attrs.reminderId, 'r1', '身影要标着它属于哪条提醒 —— 删提醒时靠它找回来');
  assert.equal(seen[0].name, '去看牙医', '标题不许被改写');

  // 身影的类型:这个仓里 task 归一到 commitment,不是两个类型
  const sig = stripComments(read('lib/life-domain/create-signal.ts'));
  assert.match(sig, /input\.type === 'task'.*=> 'commitment'|input\.type === 'task'/,
    "task 必须归一到 commitment —— 两个并存的话,按 type 找任务的地方会漏掉一半");
}

/* ══ ③ 日程列表的时间:有钟点就显示 ═══════════════════════════════════════ */
{
  // 真跑 fmtDay 的判据本体。把它从组件里抠出来跑 —— 源码判据在这里压不住:
  // 断言「源码里有 getHours」的话,一句 `return day;` 插在前面照样绿。
  const panel = read('components/portal/insights/SchedulePanel.tsx');
  const body = panel.slice(panel.indexOf('const fmtDay = (iso: string)'));
  const end = body.indexOf('\n  };');
  assert.ok(end > 0, '找不到 fmtDay —— 比错块就会假绿');
  const src = body.slice(0, end + 5);

  const js = ts.transpileModule(`const dict = 'zh'; ${src} module.exports = { fmtDay };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Date, Number, String, RegExp, console });
  const { fmtDay } = mod.exports;

  // 有钟点的:日期 + 时间都要在
  const withTime = fmtDay('2026-08-01T14:00');
  assert.match(withTime, /8月1日/, `有钟点的也得带日期,拿到 ${JSON.stringify(withTime)}`);
  assert.match(withTime, /14:00/,
    `设在 14:00 的提醒在列表上只写日期(拿到 ${JSON.stringify(withTime)}) —— ` +
    '得点进去才知道几点,而这一列本来就有钟点');
  // 午夜是真的午夜,不许因为「看起来像全天」被吞掉
  assert.match(fmtDay('2026-08-01T00:00'), /00:00/,
    '判据必须钉在「原串有没有时分」上,不是「小时是不是 0」—— ' +
    '后者会把用户真的设在午夜的那条也吞掉');
  // 只有日期的:不许凭空造一个 0:00 出来
  const dayOnly = fmtDay('2026-08-01');
  assert.match(dayOnly, /8月1日/);
  assert.doesNotMatch(dayOnly, /\d{2}:\d{2}/,
    `只有日期的串不许凭空补一个钟点(拿到 ${JSON.stringify(dayOnly)})`);
  // 垃圾输入不炸
  assert.equal(fmtDay('not-a-date'), '');
}

/* ══ ④ 每日简报要有首页入口(不是只藏在设置里)═══════════════════════════ */
{
  const row = read('components/portal/today/DailyBriefRow.tsx');
  const feed = stripComments(read('components/portal/TodayFeed.tsx'));
  assert.match(feed, /<DailyBriefRow \/>/,
    '简报入口要挂在今天页上 —— 一个叫「每日简报」的东西只在设置第二屏里有个 demo 入口,等于没有');
  // 不许在这儿再实现一份简报:点开的必须是同一张 sheet
  assert.match(row, /nesio-open-brief/, '首页入口要派同一个事件,复用同一张 sheet');
  assert.doesNotMatch(row, /api\/portal\/(brief|chat)/,
    '首页入口不许自己去生成一份简报 —— 两份实现会立刻开始漂移');
  // 权益门不许旁路(设置里那个入口有 ai_routine 门)
  assert.match(row, /canUse\('ai_routine'\)/, '首页入口要过同一道 Pro 门');
  // 看过之后不许消失 —— 消失的话他明天又要问一次「在哪里」
  assert.match(row, /is-seen/, '读过之后应当收成安静的一行,而不是整条不见');
  assert.doesNotMatch(row, /if \(seenToday\) return null/,
    '读过就整条藏起来 = 明天又找不到,而「找不到」正是这条 bug 的由来');
}

console.log('reminder-visible: OK(提醒进问一问上下文 / 身影带钟点 / 列表显示时间 / 简报有首页入口)');
