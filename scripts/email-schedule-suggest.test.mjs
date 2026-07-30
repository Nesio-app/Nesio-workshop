/**
 * 行为契约:邮件里认出的「安排」要**问一句**才进日程(2026-07-30 用户要求
 *「邮件里可以识别明确带有时间的安排,直接放入日程,或者弹出一个提示框,让我确认」)。
 *
 * 用户给了两条路。这条契约钉死走**确认**那条,理由是代价不对称:
 * 自动写进去错了,用户不会知道 —— 他只会发现日程里多了不认识的东西,还不知道去哪儿改;
 * 弹一次确认错了,代价是他按一下「不用了」。
 *
 * 识别本身钉三条正向要件(缺一不可):
 *   ① 明确的**日历日期**。相对词(明天/下周/tomorrow)一概不认 ——
 *      这个仓库已经因为「文本里出现『明天』就当明天」长出过假日期
 *      (scripts/timeline-admission.test.mjs 钉的就是同一件事);
 *   ② 明确的**钟点**;
 *   ③ 两者**挨得近**。否则页眉的日期会和页脚的营业时间凑成一场约会。
 *
 * 外加两条「不许说谎」:认出来的原文片段要摆给用户看(不是让他相信一个看不见依据的
 * 结论);加进日程失败要有看得见的失败态。
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
    module: mod, exports: mod.exports, console, require: () => ({}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean,
  });
  return mod.exports;
}

const { suggestScheduleFromEmail, alreadyScheduled } = loadTs('lib/portal/email-schedule-suggest.ts');
const SENT = '2026-07-30T10:00:00Z';

/* ── ① 日期 + 钟点齐全才认 ────────────────────────────────────────── */
{
  const en = suggestScheduleFromEmail('Parent-teacher conference Aug 3 at 2pm', '', SENT);
  assert.ok(en, '「Aug 3 at 2pm」是明确的日期 + 钟点,该认出来');
  assert.equal(en.at, '2026-08-03T14:00', '2pm = 14:00,年份从邮件时间补');

  const zh = suggestScheduleFromEmail('复诊提醒:8月3日 下午2点半', '', SENT);
  assert.ok(zh, '中文的日期 + 钟点同样要认');
  assert.equal(zh.at, '2026-08-03T14:30', '下午两点半 = 14:30');

  const iso = suggestScheduleFromEmail('Install window 2026-08-03 09:00', '', SENT);
  assert.equal(iso.at, '2026-08-03T09:00');

  // 真机踩到:一场晚餐订位被排到了清晨。`7:30` 同时能被 24 小时制那条正则认走,
  // 两条命中起点相同、后来的挤不掉先来的,于是 7:30 PM 成了早上 7:30。
  const dinner = suggestScheduleFromEmail(
    'Your reservation is confirmed', 'Sat, Aug 3 at 7:30 PM · 2 guests', SENT);
  assert.equal(dinner.at, '2026-08-03T19:30',
    '带 PM 的写法信息量严格更大,必须盖过同一位置上的裸 7:30 —— ' +
    '否则晚上七点半的订位会被排到早上七点半');
}

/* ── ② 缺一条就不认(这是正向判据的全部意义)────────────────────── */
{
  assert.equal(suggestScheduleFromEmail('包裹预计 8月3日 送达', '', SENT), null,
    '只有日期没有钟点 —— 那是到货日,不是一场约会。不许自己补一个时刻');
  assert.equal(suggestScheduleFromEmail('客服热线 9:00-18:00', '', SENT), null,
    '只有钟点没有日期,不认');
  assert.equal(suggestScheduleFromEmail('明天下午两点见', '', SENT), null,
    '「明天」不是明确的日历日期。这个仓库已经因为「文本里出现『明天』就当明天」' +
    '长出过假日期 —— 相对词一概不认');
  assert.equal(suggestScheduleFromEmail('See you tomorrow at 2pm', '', SENT), null,
    'tomorrow 同理');
  assert.equal(suggestScheduleFromEmail('Re: 周末那家店', '午饭还是晚饭都行', SENT), null,
    '什么都没有就是 null,不许猜');
}

/* ── ③ 日期和钟点隔太远 = 说的是两件事 ──────────────────────────── */
{
  const far = suggestScheduleFromEmail(
    '订单确认',
    `下单日期 2026-08-03。${'感谢您的惠顾。'.repeat(30)}客服工作时间 09:00 至 18:00。`,
    SENT,
  );
  assert.equal(far, null,
    '页眉的日期和页脚的营业时间隔着几百个字 —— 把它们凑成一场约会是最典型的误报');
}

/* ── ④ 算不出真日子的不许四舍五入 ──────────────────────────────── */
{
  assert.equal(suggestScheduleFromEmail('2月30日 上午10点', '', SENT), null,
    '2月30日不存在。滑到 3 月 2 日等于凭空造了一个日子');
}

/* ── ⑤ 片段要摆出来 ────────────────────────────────────────────── */
{
  const hit = suggestScheduleFromEmail('Parent-teacher conference Aug 3 at 2pm', '', SENT);
  assert.ok(hit.snippet && hit.snippet.length > 0,
    '必须带上原文里认出来的那一小段 —— 确认框要让用户自己判断我认得对不对,' +
    '而不是让他相信一个看不见依据的结论');
  assert.match(hit.snippet, /Aug 3/, '片段要真的包含认出来的那部分');
}

/* ── ⑥ 面板:确认才写,写失败要说话,处理过不再问 ──────────────── */
{
  const panel = strip(read('components/portal/insights/SchedulePanel.tsx'));
  const start = panel.indexOf('function MailSuggestions');
  assert.ok(start > 0, '要有这一段');
  const body = panel.slice(start, panel.indexOf('\n}\n', start));

  // 「加进来」必须挂在用户的点击上,不能在渲染/effect 里自动落库。
  //
  // 钉法是**正向**的:整段里 addReminder 只准出现一次,且必须落在 decide()
  // (用户点击的处理器)体内。用 doesNotMatch 去描述「不许写在 effect 里」是钉不住的 ——
  // 自动落库有无数种写法,而且那种反向正则写错了自己也不会响(这条第一版就写错过:
  // `useEffect\([^)]*=>` 根本匹配不上 `useEffect(() => {`,永远为真)。
  assert.match(body, /decide\(c, 'added'\)/, '加进日程只能来自用户点的那一下');
  assert.equal(
    (body.match(/addReminder\(/g) || []).length, 1,
    '这一段里只准有**一处** addReminder —— 就是用户点「加进来」的那一处。' +
    '多出来的那处不管写在 effect 还是渲染里,都等于「直接放入日程」:' +
    '错了用户不会知道,只会发现日程里多了不认识的东西,还不知道去哪儿改',
  );
  const decideStart = body.indexOf('const decide =');
  assert.ok(decideStart > 0, 'decide() 是那个「用户点击才写」的处理器,不许没有');
  const decideBlock = body.slice(decideStart, body.indexOf('\n  };', decideStart));
  assert.match(decideBlock, /addReminder\(/,
    'addReminder 必须在 decide() 体内 —— 挪到别处就不再是「确认后才写」了');
  assert.match(body, /listReminders\(\)\.some/, '写完从存储回读,不信返回值');
  assert.match(body, /role="alert"/, '加不进去要有看得见的失败态,不能「按了没反应」');
  assert.match(body, /markSuggest\(c\.eid, verdict\)/,
    '处理过的要记下来 —— 一个反复弹的确认框,弹三次用户就再也不看了');
  assert.match(body, /state\[eid\]/, '记过的不再问第二遍');
  assert.match(body, /snippet/, '把认出来的原文片段摆给用户看');

  const reg = read('scripts/storage-key-registry.test.mjs');
  assert.match(reg, /\["nesio-mail-suggest-v1", "durable"\]/,
    '「不用了」是一个决定 —— 在手机上按掉的建议换台设备又冒出来,等于没记住');
}

/* ── ⑦ 查重:日程里已经有了就不再问一遍 ─────────────────────────────
   2026-07-30 真机实锤(用户:「如果日程已经有了,就不重复。要自动检查」):
   一封 "THIS SATURDAY — Virtual Orientation" 被确认加成了提醒,而同一场活动
   "Sea Cadets Virtual Orientation" 本来就在 Google 日历里 —— 同一件事在同一页
   出现两遍,名字还不一样,看着像两个约。 */
{
  const at = (h, m = 0) => new Date(2026, 7, 1, h, m).getTime();
  const cal = [{ ms: at(9, 0), title: 'Sea Cadets Virtual Orientation' }];

  assert.ok(
    alreadyScheduled(at(9, 0), 'THIS SATURDAY — Virtual Orientation', cal),
    '同一个钟点上已经有事了 —— 不管两边名字写得多不一样,那就是同一件事。' +
    '时间才是一个约的身份',
  );
  assert.ok(alreadyScheduled(at(9, 45), 'x', cal), '±60 分钟内算同一件');
  assert.ok(!alreadyScheduled(at(14, 0), '完全不同的下午会', cal), '差了 5 小时就是两件事,别误杀');

  // 标题一模一样也算(哪怕时间被改过)
  assert.ok(
    alreadyScheduled(at(20, 0), '  sea cadets   VIRTUAL orientation ', cal),
    '标题去空格、忽略大小写后相同 → 同一件事',
  );

  // **不做模糊/语义相似** —— 那既会把两场真不同的会判成一件,也认不出改了名的同一件。
  assert.ok(
    !alreadyScheduled(at(14, 0), 'Virtual Orientation 第二场', cal),
    '不许靠公共子串认 —— "Virtual Orientation" 这种词组两场不同的活动都会有',
  );

  assert.ok(!alreadyScheduled(NaN, 'x', cal), '算不出时刻就不下判断(宁可多问一次)');
}

/* ── ⑧ 从邮件确认过来的是「日程」,不是「其它」 ───────────────────── */
{
  const panel = strip(read('components/portal/insights/SchedulePanel.tsx'));
  assert.match(panel, /kind: 'event', sourceEmailId/,
    "从邮件加进来的要标成 'event' —— 用户原话:「邮件里添加过来的称谓正常日程," +
    '不是我的提醒」。和倒垃圾、交房租并列成「其它」是分错了类');
  assert.match(panel, /alreadyScheduled\(ms, r\.title, taken\)/,
    '建议之前必须先查重 —— 日历里已经有的事不该再问一遍');
  const rem = strip(read('lib/portal/schedule-reminders.ts'));
  assert.match(rem, /'chore' \| 'bill' \| 'event' \| 'other'/, "ReminderKind 要有 'event'");
}

console.log('email-schedule-suggest: OK(日期+钟点齐全才认 / 不认相对词 / 不凑远处 / 确认才写)');
