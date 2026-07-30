/**
 * 行为契约:每日日报横跨所有面 + 早上 8 点定稿(2026-07-30 用户定案)。
 *
 * 原话:「我也想有 nesio 的每日日报文字版,但是要横跨 nesio 的所有面」
 *       「几点定稿 —— 早上 8 点」「默认开」。
 *
 * 钉五件事:
 *   ① **定稿是把 now 钉在当天 08:00**,不是「打开就现算」。
 *      这是「早上看到的和中午看到的是同一份」的全部机制:buildDailyReport 是纯函数,
 *      同样输入必然同样输出,钉死 now 就等于定稿。跟着实时时钟走 = 每次刷新都变。
 *   ② 日程窗口是**当天整天**,不是「从现在起」。定稿口径在 08:00 而人可能中午才打开,
 *      用「从现在起」的话早上那场会就从日报里消失了 —— 可它明明是这份日报的一部分。
 *   ③ **配额**:每域封顶、每段封顶。14 个面 × 3 条 = 42 条流水账,没人读第二天。
 *   ④ **正向准入**:没有要你动的事,「先处理这几件」整段不出现;
 *      empty 的判定不能靠 sections.length —— 日程段永远会渲染(哪怕只写「今天没安排」),
 *      那样就永远不空,自动预生成会天天往记忆里存一条空日报。
 *   ⑤ **默认开**,但**亲手关过的人保持关**(判据必须是 !== '0',不是 === '1')。
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

const { buildDailyReport } = loadTs('lib/portal/daily-report.ts');

const iso = (h, m = 0) => new Date(2026, 6, 30, h, m).toISOString();
const NOON = new Date(2026, 6, 30, 12, 0);
const EIGHT = new Date(2026, 6, 30, 8, 0);

/* ── ① 定稿 = 锚点 + **冻结件**,不是「打开就现算」 ──────────────────── */
{
  const input = {
    now: EIGHT,
    events: [{ title: '晨会', start: iso(9, 0) }, { title: '下午评审', start: iso(15, 0) }],
    weather: { tempMinC: 20, tempMaxC: 30, condition: '晴' },
  };
  const morning = buildDailyReport(input);
  assert.equal(buildDailyReport({ ...input, now: EIGHT }).markdown, morning.markdown,
    '纯函数:同样输入必然同样输出 —— 这是定稿能成立的前提');
  assert.match(morning.sections.find((s) => s.id === 'calendar').lines.join('|'), /晨会/);

  const persist = strip(read('lib/portal/daily-report-persist.ts'));
  assert.match(persist, /REPORT_HOUR = 8/, '定稿时刻是 8 点');
  assert.match(persist, /buildDailyReport\(\{ \.\.\.input, now: reportAnchor\(now\) \}\)/,
    '落库必须用 reportAnchor(now)(当天 08:00),不是 now');
  assert.match(persist, /due: reportDue\(now\)/, '早于 08:00 不出今天这份');

  /*
   * 光钉 now **不够**,这一条是本契约最要紧的部分:
   * 日历窗口本来就是整天,所以锚点几乎不影响输出 —— 真正会在白天变的是**输入**
   * (新邮件到了、某个域的判定翻了、提醒被打勾)。不把成品冻下来的话,同一天刷新两次
   * 还是两份不同的日报,而那正是用户要治的毛病。
   *
   * (这条断言是被自己的第一版逼出来的:那版拿「中午现算 ≠ 早上那份」来反证锚点有效,
   *  结果两者逐字相同 —— 断言当场自证为空,顺带暴露了冻结压根没做。)
   */
  assert.match(persist, /snapshot: JSON\.stringify/,
    '落库必须连 sections 一起存下来 —— 只存 markdown 的话 UI 渲染不了,只能拿新数据重排');
  assert.match(persist, /export function readTodayReport/, '要有「读今天冻结的那份」');

  const hook = strip(read('components/portal/today/useTodayData.ts'));
  assert.match(hook, /const frozen = readTodayReport\(/, '显示前先读冻结件');
  assert.match(hook, /frozen \?\? buildDailyReport\(/,
    '有冻结件就用冻结件,**现算只是兜底** —— 反过来写(先算、算不出才读)等于没冻');
}

/* ── ② 日程窗口 = 当天整天,不是「从现在起」 ────────────────────────── */
{
  const r = buildDailyReport({
    now: EIGHT,
    events: [{ title: '早八已经开完的会', start: iso(7, 30) }, { title: '晚上的饭局', start: iso(19, 0) }],
  });
  const cal = r.sections.find((s) => s.id === 'calendar').lines.join('|');
  assert.match(cal, /早八已经开完的会/,
    '锚点之前的当天日程也要在 —— 人可能中午才打开这份「早上八点的日报」,' +
    '把早上那场会摘掉的话,这份日报就跟他早上看到的对不上了');
  assert.match(cal, /晚上的饭局/);
}

/* ── ③ 跨面 + 配额 ────────────────────────────────────────────────── */
{
  // 七个域各塞 5 条,看它会不会把 35 条全倒出来
  const domains = ['health', 'finance', 'location', 'inventory', 'mood', 'relationship', 'reading'];
  const insights = [];
  for (const d of domains) {
    for (let i = 0; i < 5; i += 1) {
      insights.push({ domain: d, severity: i < 2 ? 'flag' : 'attention', title: `${d}-${i}`, detail: 'x' });
    }
  }
  const r = buildDailyReport({
    now: EIGHT,
    domainInsights: insights,
    reminders: [{ title: '交房租', at: '2026-07-30T09:00', kind: 'bill' }],
    events: Array.from({ length: 12 }, (_, i) => ({ title: `会 ${i}`, start: iso(9 + (i % 10)) })),
    fitnessSession: '下肢 A',
    outfitNote: '灰卫衣 + 黑长裤',
    meals: ['番茄炒蛋'],
    orders: [{ title: '耳机', status: '已发货', eta: '8月3日' }],
  });

  const action = r.sections.find((s) => s.id === 'action');
  assert.ok(action.lines.length <= 5, `「先处理这几件」封顶 5 条,实际 ${action.lines.length} —— 超过 5 件就不叫 top of mind 了`);
  assert.match(action.lines[0], /交房租/, '我自己设的提醒排最前(那是我亲手写下的时间)');

  // **每一类来源都得有位置** —— 这一条是被实锤逼出来的:
  // 原来写成先到先得,4 条 flag + 1 条提醒直接吃满 5 个位置,在途订单永远进不来,
  // 而且用户根本不知道它被挤掉了。这和「每域封顶」是同一族:一类饿死另一类。
  assert.match(action.lines.join('|'), /耳机/,
    '在途订单必须有自己的位置 —— 判定一多就把它挤没了的话,这一路就等于没做');
  const flagCount = action.lines.filter((l) => /^(健康|财务|地点|物品|心情|关系|阅读) ·/.test(l)).length;
  assert.ok(flagCount <= 2, `域判定在「要你动」里最多占 2 条,实际 ${flagCount} —— 否则它会把提醒和订单一起挤掉`);

  const domain = r.sections.find((s) => s.id === 'domain');
  assert.ok(domain.lines.length <= 4, `「这几面有变化」封顶 4 条,实际 ${domain.lines.length}`);
  // 每域封顶:不许某一个域把整段刷满
  const counts = new Map();
  for (const line of [...action.lines, ...domain.lines]) {
    for (const d of ['健康', '财务', '地点', '物品', '心情', '关系', '阅读']) {
      if (line.startsWith(`${d} ·`)) counts.set(d, (counts.get(d) || 0) + 1);
    }
  }
  for (const [d, n] of counts) {
    assert.ok(n <= 2, `「${d}」占了 ${n} 条 —— 每域封顶 2,否则健康一家就能把整份日报刷满`);
  }

  const cal = r.sections.find((s) => s.id === 'calendar');
  assert.ok(cal.lines.length <= 7, '日程最多列 6 条 + 一行「还有 N 件」');
  assert.match(cal.lines[cal.lines.length - 1], /还有 \d+ 件/, '被折叠掉的要如实说有几件,不能静默截断');

  // 只有 Nesio 知道的那几面确实进来了
  const today = r.sections.find((s) => s.id === 'today').lines.join('|');
  assert.match(today, /下肢 A/, '今天该练哪个');
  assert.match(today, /灰卫衣/, '今天穿什么');
  assert.match(today, /番茄炒蛋/, '今天吃什么');
}

/* ── ④ 正向准入:没事就不出那一段;empty 不能靠 sections.length ──────── */
{
  const quiet = buildDailyReport({ now: EIGHT, events: [{ title: '午饭', start: iso(12) }] });
  assert.equal(quiet.sections.find((s) => s.id === 'action'), undefined,
    '没有要你动的事,「先处理这几件」整段不出现 —— 不许拿「一切正常」凑一条');
  assert.equal(quiet.sections.find((s) => s.id === 'domain'), undefined,
    '没有变化就不出「这几面有变化」');

  const nothing = buildDailyReport({ now: EIGHT });
  assert.equal(nothing.empty, true,
    '什么都没有必须判成 empty。日程那一段**永远**会渲染(哪怕只写「今天没安排」),' +
    '所以 empty 绝不能靠 sections.length 判 —— 那样永远不空,' +
    '自动预生成会天天往记忆里存一条只写着「今天没安排」的空日报');
  assert.ok(nothing.sections.length > 0, '(而它的 sections 确实非空 —— 上面那条断言不是空的)');

  assert.equal(buildDailyReport({ now: EIGHT, meals: ['粥'] }).empty, false, '任何一面有东西就不算空');
}

/* ── ⑤ 邮件只给一行汇总,不复述内容 ────────────────────────────────── */
{
  const r = buildDailyReport({
    now: EIGHT,
    emailHighlights: ['WakeMed 新消息', 'Oak City Sound Chorus 邀请', '订单已发货'],
  });
  const mail = r.sections.find((s) => s.id === 'email');
  assert.equal(mail.lines.length, 1, '邮件只给一行');
  assert.doesNotMatch(mail.lines[0], /WakeMed|Chorus/,
    '不复述邮件内容 —— 用户已经收到一份从邮件总结的日报了,' +
    '在这儿再抄一遍就是更差的重复品,还会把真正只有 Nesio 知道的那几段挤下去');
  assert.match(mail.lines[0], /3 封/, '但要如实说有几封 + 去哪儿看');
}

/* ── ⑥ 默认开,亲手关过的保持关 ────────────────────────────────────── */
{
  const profile = strip(read('lib/portal/profile.ts'));
  assert.match(profile, /KEYS\.dailyReportEnabled\) !== '0'/,
    "默认开必须写成 !== '0':=== '1' 会让所有老用户都是关的(默认开等于没生效);" +
    '而任何比 !== \'0\' 更宽松的写法都会把「用户亲手关掉」这个决定抹掉');
  const card = strip(read('components/portal/today/DailyReportCard.tsx'));
  assert.match(card, /pending/, '还没到 08:00 时要说清它几点来,不能空着一块地方');
}

console.log('daily-report-crossface: OK(8 点定稿 / 整天窗口 / 跨面配额 / 正向准入 / 邮件不复述 / 默认开)');
