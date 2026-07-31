/**
 * 行为契约:提醒收成一处(2026-07-31)。
 *
 * 用户的四条指令里,这一条是地基:「如果输入框可以设置提醒,智能提醒,我可以语言设置
 * 时间,频率然后进入记忆。就不需要例行提醒和日程里的提醒项目了。」
 *
 * 在这之前提醒散在两处、能力互补但互不相通:
 *   · 例行提醒(nesio-routines-v1)—— 会「每周一三五」,但做完不留痕、只在今天页出卡;
 *   · 我设的提醒(schedule-reminders)—— 会「某个具体时刻 + 每 N 天/月」,但不会每周几。
 * 合并的前提是**后者先长出前者的能力**,否则搬过去就是丢功能。这份契约压的就是这件事,
 * 外加两条用户点名的缺口:
 *   ①「应该有已完成提醒查询地方」—— 重复提醒做完是往后滚,在这之前**不留任何痕迹**,
 *     所以「这个月到底交没交房租」根本没有数据能回答;
 *   ②「设好的提醒进入时间线」—— 提醒要在记忆里留一条身影,不然它只活在日程页那一屏。
 *
 * (用户后来确认那台设备上的例行提醒是测试数据,所以不做迁移,直接删。)
 *
 * 还有一条贯穿的自律:**没说频率就不是重复的**。把一次性的事默认成天天响,
 * 是最快让人把整个提醒功能关掉的做法。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function loadTs(rel, extraGlobals = {}) {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  // schedule-reminders 在模块顶层就 createBlobStore —— 给它一个空壳,
  // 这份契约要验的是**纯时间计算**,不碰存储。
  const req = (id) => (String(id).includes('idb-blob-store')
    ? { createBlobStore: () => ({ load: () => [], save: () => {}, ready: () => Promise.resolve([]) }) }
    : {});
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: req,
    console, Object, Array, String, Number, Math, JSON, Date, RegExp, Boolean, Set, Map,
    ...extraGlobals,
  });
  return mod.exports;
}

const when = loadTs('lib/portal/when-parse.ts');
const rem = loadTs('lib/portal/schedule-reminders.ts');

const NOW = new Date(2026, 6, 31, 22, 12); // 2026-07-31 周五

/* ── ① 每周几:例行提醒那半边的能力搬过来了 ─────────────────────────────── */

{
  // 周五 8/31?不,2026-07-31 是周五。每周一三五 → 下一次是 8/3(周一)。
  const next = rem.nextOccurrence('2026-07-31T18:00', undefined, undefined, NOW, [1, 3, 5]);
  assert.equal(next, '2026-08-03T18:00', `每周一三五的下一次应是周一 8/3,得到 ${next}`);
}
{
  // 「今天就是周三、每周三」必须往前走一格,不能原地打转 ——
  // 否则点一次「做好了」还停在今天,用户会以为按钮坏了。
  const wed = new Date(2026, 7, 5, 20, 0); // 2026-08-05 周三
  const next = rem.nextOccurrence('2026-08-05T09:00', undefined, undefined, wed, [3]);
  assert.equal(next, '2026-08-12T09:00', `同一天不能原地打转,得到 ${next}`);
}
{
  // 等间隔的老能力不能被碰坏。
  assert.equal(rem.nextOccurrence('2026-07-01T09:00', undefined, 1, NOW), '2026-08-01T09:00');
  assert.equal(rem.nextOccurrence('2026-07-30T09:00', 1, undefined, NOW), '2026-08-01T09:00');
}

/* ── ② 重复提醒做完要留痕 ───────────────────────────────────────────────── */

{
  const src = code(read('lib/portal/schedule-reminders.ts'));
  assert.ok(
    /doneLog: \[\.\.\.\(hit\.doneLog \|\| \[\]\), hit\.at\]\.slice\(-DONE_LOG_CAP\)/.test(src),
    '重复提醒滚到下一次时要把**这一次**记下来 —— 不记的话「这个月交没交」永远查不到',
  );
  assert.ok(
    /export function listCompleted\(\)[\s\S]{0,600}r\.doneAt[\s\S]{0,300}r\.doneLog/.test(src),
    '「已完成」要同时收一次性的(doneAt)和重复的(doneLog)—— 只收一种等于半个功能',
  );
  assert.ok(/DONE_LOG_CAP = 60/.test(src), '完成记录要封顶,不能让这个键无限长');
}
{
  // 界面上要真的有这个入口 —— 数据存下来了没人看得到,等于没做。
  const panel = code(read('components/portal/insights/SchedulePanel.tsx'));
  assert.ok(/setShowDone\(\(v\) => !v\)/.test(panel), '日程页要有「已完成」的切换入口');
  assert.ok(
    /showDone && <CompletedReminders dict=\{dict\} tokens=\{tokens\} \/>/.test(panel),
    '已完成那一段要真的渲染出来',
  );
  assert.ok(
    /还没有做完的 —— 点一条提醒上的「做好了」/.test(panel),
    '一条都没有时要说清楚怎么才会有,而不是空着',
  );
  // 展开已完成时主列表要让位 —— 同屏两份提醒,分不清哪份是待办。
  assert.ok(
    /\{sub === 'calendar' && showDone \? null : rows\.length === 0 \?/.test(panel),
    '看已完成时主列表要让位,不能两份同屏',
  );
}

/* ── ③ 重复方式的人话,认得全 ───────────────────────────────────────────── */

assert.equal(rem.repeatLabel({ weekdays: [1, 2, 3, 4, 5] }), '工作日', '五天连排要说「工作日」,不是列五个数字');
assert.equal(rem.repeatLabel({ weekdays: [0, 1, 2, 3, 4, 5, 6] }), '每天');
assert.equal(rem.repeatLabel({ weekdays: [1, 3, 5] }), '每周一、三、五');
assert.equal(rem.repeatLabel({ everyDays: 1 }), '每天');
assert.equal(rem.repeatLabel({ everyMonths: 1 }), '每月');
assert.equal(rem.repeatLabel({ everyDays: 2 }, 'en'), 'Every 2 days');
assert.equal(rem.repeatLabel({}), '', '只此一次的不该有重复标签');
{
  // 日程页原来那行只认「每月」和 everyDays===7,「每周一三五」会显示成空白 ——
  // 看着像只此一次。必须走统一的 repeatLabel。
  const panel = code(read('components/portal/insights/SchedulePanel.tsx'));
  assert.ok(
    /const rep = repeatLabel\(r, dict\);/.test(panel),
    '日程页的重复标签要走 repeatLabel,不许各写各的',
  );
}

/* ── ③b 提醒和日历项同级排在一张列表里 ─────────────────────────────────── */

{
  const panel = code(read('components/portal/insights/SchedulePanel.tsx'));
  // 用户原话:「提醒项目混入日程列表,和日历同级别」。
  // **只看那个循环体本身**:在整份文件里搜片段会撞上别处长得一样的写法
  // (`if (r.doneAt) continue;` 在查重那段也有一份),门槛改坏了照样绿。
  const loop = panel.match(/for \(const r of reminders\) \{[\s\S]*?\n {4}\}/);
  assert.ok(loop, '提醒要作为普通行推进 calendarRows —— 那个循环不见了');
  const body = loop[0];
  assert.ok(/out\.push\(\{[\s\S]{0,400}reminder: r,/.test(body), '循环里要真的把提醒推成一行');
  assert.ok(
    /^\s*if \(r\.doneAt\) continue;/m.test(body) && !/^\s*continue;/m.test(body),
    '做完的不进待办列表(而且不能是「一律 continue」把整段架空)',
  );
  // Row.node 松绑是这件事的前提:提醒不是 life-graph 节点。
  assert.ok(/node\?: LifeNode;/.test(panel), 'Row.node 要可选,提醒行没有节点');
  assert.ok(
    /onOpen=\{r\.node \? \(\) => setOpenNode\(r\.node!\) : undefined\}/.test(panel),
    '提醒行没有记忆可开 —— 不画一个点了没反应的行',
  );
  // 删提醒行删的是提醒本身,不是某个节点 id。
  assert.ok(
    /if \(id\.startsWith\('rem:'\)\) \{[\s\S]{0,240}removeReminder\(rid\);[\s\S]{0,120}removeReminderShadow\(rid\);/.test(panel),
    '删提醒行要删提醒(连同身影),按 life-graph 的 id 去删只会一无所获',
  );
  // 「做好了」是提醒在这份列表里唯一要紧的动作 —— 没有它,「已完成」永远是空的。
  assert.ok(
    /if \(r\.reminder\) \{[\s\S]{0,240}completeReminder\(r\.reminder\.id\);/.test(panel),
    '提醒行右滑要落到 completeReminder,不是打星',
  );
  assert.ok(
    /const isReminder = !!row\.reminder;/.test(panel)
    && /const Mark = isReminder \? IconCheck :/.test(panel),
    '提醒行的那个动作图标要是「勾」,不是星 —— 给提醒打星没有意义',
  );
  // 日程页不再有新建提醒的表单:那件事整个交给首页输入框。
  assert.ok(!/RemindersSection/.test(panel), '日程页那套新建/管理提醒的 UI 该删了');
  assert.ok(
    !/type="datetime-local"/.test(panel),
    '日程页不该再有手填时刻的新建表单 —— 用户定案:首页输入框应该可以完成',
  );
}

/* ── ③c 语音那一侧也能设,而且一样进记忆 ───────────────────────────────── */

{
  const sheet = code(read('components/portal/VoiceInputSheet.tsx'));
  // 用户原话:「首页输入框和问问设置的提醒是要进记忆的」。
  assert.ok(
    /addReminder\(\{ title: voiceWhen\.title, at: voiceWhen\.at, \.\.\.\(voiceWhen\.repeat \|\| \{\}\) \}\)/.test(sheet),
    '说一句里认出时间也要能设成提醒',
  );
  assert.ok(
    /createReminderShadow\(r\);/.test(sheet),
    '这条提醒同样要进记忆 —— 这正是用户说的「要进记忆」',
  );
  assert.ok(
    /\{!isAskMode && voiceWhen && sendState !== 'saved' && \(/.test(sheet),
    'ask 那一侧不给这个按钮:那边是问问题,不是安排事情',
  );
  assert.ok(
    /if \(!r\) \{[\s\S]{0,200}没能设上/.test(sheet),
    '设不上要说 —— 红线:失败必须可见',
  );
  assert.ok(
    /useEffect\(\(\) => \{ setRemindMsg\(''\); \}, \[text\]\);/.test(sheet),
    '换了一句话要把上一条回执收起来,否则会让人以为新打的这句也设上了',
  );
  assert.ok(
    /!voiceWhen\.hasExplicitTime && \([\s\S]{0,300}你没说几点/.test(sheet),
    '默认钟点在这一侧也要自己说出来',
  );
}

/* ── ④ 频率能从一句话里认出来,而且没说就不是重复的 ─────────────────────── */

{
  const cases = [
    ['每天早上8点吃药', { everyDays: 1 }, '2026-08-01T08:00'],
    ['每周三下午3点开会', { weekdays: [3] }, '2026-08-05T15:00'],
    ['工作日 9:00 站会', { weekdays: [1, 2, 3, 4, 5] }, '2026-08-03T09:00'],
    ['每月15号交房租', { everyMonths: 1 }, '2026-08-15T09:00'],
    ['每两天浇花', { everyDays: 2 }, '2026-08-01T09:00'],
    ['每周一三五健身', { weekdays: [1, 3, 5] }, '2026-08-03T09:00'],
  ];
  for (const [text, repeat, at] of cases) {
    const g = when.parseWhen(text, NOW);
    assert.ok(g, `「${text}」该认得出来`);
    // 用 JSON 比,不用 deepEqual:vm 里造出来的对象跟这边的原型不是同一个,
    // 值一模一样也会判不等(这个坑在本仓踩过)。
    assert.equal(JSON.stringify(g.repeat), JSON.stringify(repeat),
      `「${text}」的频率应是 ${JSON.stringify(repeat)},得到 ${JSON.stringify(g.repeat)}`);
    assert.equal(g.at, at, `「${text}」的首次应是 ${at},得到 ${g.at}`);
  }
}
{
  // 没说频率就**没有** repeat。默认成每天是最快让人关掉整个功能的做法。
  const g = when.parseWhen('明天下午3点医生', NOW);
  assert.equal(g.repeat, undefined, '没说频率时不许默认成重复');
}
{
  // 首次落点绝不能一建就过期 —— 现在是 22:12,只说「每两天」会落到今天早九点。
  const g = when.parseWhen('每两天浇花', NOW);
  assert.ok(g.at > '2026-07-31T22:12', `首次落点不能已经过去,得到 ${g.at}`);
}

/* ── ⑥ 设好的提醒进时间线 ───────────────────────────────────────────────── */

{
  const shadow = code(read('lib/portal/reminder-shadow.ts'));
  assert.ok(
    /dueDate: r\.at\.slice\(0, 10\)[\s\S]{0,120}dueTime: r\.at\.slice\(11\)/.test(shadow),
    '身影要带时刻 —— 不带 dueDate/dueTime 它排不进时间线',
  );
  assert.ok(
    /\[SHADOW_ATTR\]: r\.id/.test(shadow),
    '身影要标明属于哪条提醒,否则删提醒时找不回来',
  );
  assert.ok(
    /export function removeReminderShadow[\s\S]{0,400}\[SHADOW_ATTR\] === reminderId\) deleteLifeNode/.test(shadow),
    '删提醒要能把身影一起收走 —— 只删一边会在时间线上留下指向不存在提醒的记录',
  );
  // 身影不是第二份真源:带上完成状态/下一次是什么时候,两处立刻开始漂移。
  assert.ok(
    !/doneAt|doneLog|nextOccurrence/.test(shadow),
    '身影不许存完成状态或下一次时刻 —— 那些只看 schedule-reminders',
  );

  // **两个**建提醒的入口都要建身影。只在一处建的话,「设好的提醒进入时间线」
  // 就只对首页那条输入生效,从日程页加的看不见 —— 同一个功能两种表现最难查。
  const feed = code(read('components/portal/TodayFeed.tsx'));
  const panel = code(read('components/portal/insights/SchedulePanel.tsx'));
  assert.ok(/createReminderShadow\(r\);/.test(feed), '首页设的提醒要建身影');
  assert.ok(/createReminderShadow\(created\)/.test(panel), '邮件确认过来的提醒也要建身影');

  // 最结实的那条:**凡是建提醒的地方,都得跟一条身影**。
  // 逐个入口点名的写法挡不住「明天有人加了第四个入口、忘了建身影」——
  // 那时候「设好的提醒进入时间线」就只对一部分提醒成立,而症状是随机的。
  const callers = ['components/portal/TodayFeed.tsx',
                   'components/portal/insights/SchedulePanel.tsx',
                   'components/portal/VoiceInputSheet.tsx'];
  let adds = 0;
  let shadows = 0;
  for (const f of callers) {
    const src = code(read(f));
    adds += (src.match(/addReminder\(\{/g) || []).length;
    shadows += (src.match(/createReminderShadow\(/g) || []).length;
  }
  assert.ok(adds > 0, '至少得有一个建提醒的入口');
  assert.equal(shadows, adds,
    `建了 ${adds} 处提醒但只建了 ${shadows} 处身影 —— 每个入口都要跟一条,否则「进时间线」只对一部分成立`);
  // 删除那一侧同理:removeReminder 出现的地方必须跟一条 removeReminderShadow。
  // (日程页现在只有 commitDelete 一处删提醒 —— 「加一条」那套 UI 已经删了。)
  assert.ok(
    /removeReminder\(rid\);\s*\n\s*removeReminderShadow\(rid\);/.test(panel),
    '日程页删提醒要一并收走身影',
  );
  assert.ok(
    /onUndo: \(\) => \{ removeReminder\(r\.id\); removeReminderShadow\(r\.id\); setRemindReceipt\(null\); \}/.test(feed),
    '撤销要把提醒和它的身影一起收走',
  );

  const cmd = code(read('lib/platform/view-models/today-commands.ts'));
  assert.ok(
    /export function addCommitmentNode\(name: string, attrs: Record<string, string> = \{\}\)[\s\S]{0,300}attributes: attrs/.test(cmd),
    'addCommitmentNode 要能带属性进去,否则时刻根本存不下来',
  );
}

/* ── ⑨ 例行提醒真的删干净了 ─────────────────────────────────────────────── */

{
  for (const gone of [
    'lib/portal/routines.ts',
    'components/portal/RoutineSheet.tsx',
    'components/portal/today/RoutineDueCards.tsx',
  ]) {
    assert.ok(!fs.existsSync(path.join(ROOT, gone)), `${gone} 该删掉了`);
  }
  const feed = code(read('components/portal/TodayFeed.tsx'));
  assert.ok(!/RoutineDueCards/.test(feed), '今天页不该再挂例行提醒卡');
  const card = code(read('components/portal/NesioProfileCard.tsx'));
  assert.ok(!/RoutineSheet|'routine'/.test(card), '个人页不该再有例行提醒入口');
  // 老设备上那个键还躺着 —— 不留在 CACHE_KEYS 里,keyKind() 会默认判它 durable,
  // 于是这堆废数据开始进备份、上云同步。
  const manifest = read('lib/portal/storage-manifest.ts');
  assert.ok(
    /'nesio-routines-v1',/.test(manifest),
    "删了模块也要把 'nesio-routines-v1' 留在 CACHE_KEYS —— 否则老设备上的遗留值会开始上云",
  );
}

/* ── ⑦ 频率要摆在按钮上给人看见 ─────────────────────────────────────────── */

{
  const bar = code(read('components/portal/today/CaptureBar.tsx'));
  assert.ok(
    /const whenRepeat = when\?\.repeat \? repeatLabel\(when\.repeat, dict\) : '';/.test(bar),
    '认出来的频率要算成人话',
  );
  assert.ok(
    /设成提醒 · \$\{formatWhen\(when\.at\)\}\$\{whenRepeat \? ` · \$\{whenRepeat\}` : ''\}/.test(bar),
    '频率要写在按钮上 —— 看不见系统读成了什么,就只能等明天发现它天天响才知道',
  );
  assert.ok(
    /capture\.onRemind\?\.\(when\.at, when\.title, when\.repeat\)/.test(bar),
    '频率要真的传下去,不能只显示不用',
  );
}

/* ── ⑧ 「问」是一步到位的,而且只发一次 ─────────────────────────────────── */

{
  const sheet = code(read('components/portal/VoiceInputSheet.tsx'));
  assert.ok(
    /autoAskedRef\.current = seed;\s*\n\s*void handleSend\(\);/.test(sheet),
    '从首页带过来的问题要直接开始回答,不停在一个填好了还等着再点一次发送的框上',
  );
  assert.ok(
    /if \(!open \|\| !isAskMode\) \{ autoAskedRef\.current = ''; return; \}/.test(sheet),
    '只有「问」这一侧自动跑 —— 「说一句」是往记忆里写东西,自动提交等于替人按下保存键',
  );
  assert.ok(
    /if \(!seed \|\| autoAskedRef\.current === seed\) return;/.test(sheet),
    '一次打开只自动发一次 —— 不挡的话会连发两遍,白花一次 AI 的钱',
  );
  assert.ok(
    /if \(text\.trim\(\) !== seed\) return;/.test(sheet),
    '要等文字真的填进去再发,否则发出去的是空的',
  );
}

console.log('reminder-unify: OK(每周几搬过来了 / 做完留痕可查 / 重复说得出人话 / 频率认得出且不默认重复 / 提醒进时间线(每个入口都建) / 提醒与日历同级 / 语音也能设 / 例行提醒已删净 / 频率看得见 / 问一步到位)');
