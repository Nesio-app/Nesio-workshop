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

const { buildDailyReport, diffInsights } = loadTs('lib/portal/daily-report.ts');

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

  /*
   * 显示端**只读冻结件,一行 build 都不许有**(2026-07-30 用户把入口从 Today 挪到洞察
   * 之后收紧的)。此前的写法是「有冻结件就用,没有就现算兜底」——那个兜底就是个后门:
   * 冻结件因为任何原因读不到(老节点 / 存坏了 / 还没落库),界面就悄悄回到「每次刷新
   * 都重排」,而用户看不出区别。现在唯一的显示处是洞察页的 DailyReportPanel,
   * 它只 readTodayReport / listDailyReports,不 import buildDailyReport ——
   * 「当天不再变」因此是硬的,没有任何一处会拿新数据现算一份出来。
   */
  const panel = strip(read('components/portal/insights/DailyReportPanel.tsx'));
  assert.match(panel, /readTodayReport\(/, '今天那份从冻结件读');
  assert.match(panel, /listDailyReports\(/, '往日那几份也从冻结件读,不回溯生成');
  assert.doesNotMatch(panel, /buildDailyReport/,
    '显示端不许 build —— 现算的兜底是个后门:冻结件一读不到就悄悄回到「每次刷新都重排」,' +
    '而用户看不出区别');

  const hook = strip(read('components/portal/today/useTodayData.ts'));
  assert.match(hook, /autoPersistTodayReport\(/, '定稿落库仍然只有 Today 这一处');
  assert.doesNotMatch(hook, /setTodayReport/,
    'Today 不再持有日报 state —— 入口已挪到洞察(用户定案:「今天不要入口,用弹出卡片」)');
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

/* ── ③' 新进展 = 和昨天的**差分**,不是快照 ───────────────────────────
   快照说「血糖 6.4」,那不是进展;「从 6.7 降到 6.4」才是。天天推同一句快照,
   读第三天就会被当成噪音跳过 —— 而这本该是整份日报里最有价值的一段。 */
{
  const ins = (domain, title) => ({ domain, severity: 'attention', title, detail: 'x' });
  const yest = [ins('health', '空腹血糖 7 天均值 6.7'), ins('inventory', '牛奶到期'), ins('reading', '还剩 45 页')];
  const today = [ins('health', '空腹血糖 7 天均值 6.4'), ins('reading', '还剩 40 页'), ins('finance', 'Netflix 涨价')];

  const d = diffInsights(today, yest);
  assert.equal(d.fresh.map((x) => x.title).join(','), 'Netflix 涨价', '今天新冒出来的');
  assert.equal(d.gone.map((x) => x.title).join(','), '牛奶到期', '昨天有、今天不再提示的');
  assert.equal(d.changed.length, 2, '还在但数值变了的');
  assert.equal(d.changed[0].before, '空腹血糖 7 天均值 6.7', '要带上昨天那个值,不然「变了」是句空话');

  // **稳定 key**:数值变了不算「昨天那条没了 + 今天新出一条」。这是最典型的假差分,
  // 而且一次错两条。
  assert.ok(!d.fresh.some((x) => x.domain === 'health'), '血糖那条不是「新出现」—— 它昨天就在');
  assert.ok(!d.gone.some((x) => x.domain === 'health'), '血糖那条也不是「不再提示」');

  const r = buildDailyReport({ now: EIGHT, domainInsights: today, yesterdayInsights: yest });
  const sec = r.sections.find((s) => s.id === 'domain');
  assert.equal(sec.title, '新进展', '有昨天可比时叫「新进展」');
  // 顺序:真事件(新出现/不再提示)在前,渐变垫底 —— 否则每天必然动一格的那些指标
  // (「上次通话 11 天前 → 12 天前」)会把真事件挤到看不见。
  assert.match(sec.lines[0], /新$/, '新出现的排最前');
  assert.match(sec.lines[1], /不再提示了$/, '不再提示的次之(真事件)');
  assert.match(sec.lines[2], /昨天是/, '渐变垫底');

  // 没有昨天可比时:退回快照,**标题跟着换** —— 不装作有进展
  const first = buildDailyReport({ now: EIGHT, domainInsights: today });
  assert.equal(first.sections.find((s) => s.id === 'domain').title, '这几面',
    '第一天没有基线,只能出快照 —— 那就别叫「新进展」,那是在说谎');

  /*
   * 差分的**基线链路**必须真的接上,这三条缺一条整个功能就静默退化:
   * 不存原始判定集 → 明天读不到基线 → 永远出快照、永远叫「这几面」。
   * 而那条退化路径**本身是合法的**(第一天就该那样),所以不会报错、不会有人发现。
   * 这是最该钉的那种洞。(第一版漏了,注入回归时当场发现契约抓不住。)
   */
  const persist2 = strip(read('lib/portal/daily-report-persist.ts'));
  assert.match(persist2, /insights: JSON\.stringify\(/,
    '落库要存**原始判定集**(不是格式化后的 sections)—— sections 已经是拼好的句子,' +
    '反解析既脆又会把「6.4」这种数值弄丢');
  assert.match(persist2, /export function readYesterdayInsights/, '要能读回昨天那份基线');
  const hook2 = strip(read('components/portal/today/useTodayData.ts'));
  assert.match(hook2, /yesterdayInsights: readYesterdayInsights\(/,
    '基线要真的喂进日报 —— 不喂的话前面两条都白做,日报还是天天出快照');
  assert.match(hook2, /ahead: \[/, '「往前看」也要真的接上');
}

/* ── ③'' 往前看:窗口 14 天,纯函数**自己**过滤 ─────────────────────── */
{
  const day = (off) => {
    const x = new Date(2026, 6, 30); x.setDate(x.getDate() + off);
    const p = (n) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  };
  const r = buildDailyReport({
    now: EIGHT,
    ahead: [
      { date: day(0), title: '今天的', kind: 'event' },
      { date: day(1), title: '明天的', kind: 'event' },
      { date: day(14), title: '第 14 天', kind: 'event' },
      { date: day(15), title: '第 15 天', kind: 'event' },
    ],
  });
  const lines = r.sections.find((s) => s.id === 'ahead').lines.join('|');
  assert.match(lines, /明天的/);
  assert.match(lines, /第 14 天/, '窗口含第 14 天(用户拍板:看两周)');
  assert.doesNotMatch(lines, /第 15 天/,
    '超窗的不许进 —— 采集端已经过滤过,但那是好意不是保证:' +
    '调用方多传一条进来,纯函数照单全收的话「两周」这个标题就在说谎,' +
    '而且契约在纯函数这一侧根本测不到。自己的输出自己负责');
  assert.doesNotMatch(lines, /今天的/, '今天不算 —— 今天有它自己那几段');
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
  const panel = strip(read('components/portal/insights/DailyReportPanel.tsx'));
  assert.match(panel, /reportDue\(new Date\(\)\)/,
    '还没到 08:00 时要说清它几点来,不能空着一块地方');
  // 关掉日报的人,洞察页也不该立着一块空地
  assert.match(panel, /if \(!enabled\) return null/, '关掉了就整段不出现');
  // 老节点没有冻结件 → 点开是空壳。要么禁用要么说明,不做「点了没反应」的假按钮。
  assert.match(panel, /disabled=\{!r\.report\}/,
    '没有冻结件的往日不许做成能点的按钮 —— 点开一个空壳比不给这个入口更糟');

  const today = strip(read('components/portal/TodayFeed.tsx'));
  assert.doesNotMatch(today, /DailyReportCard/,
    'Today 不再有日报卡(用户定案:「今天不要入口,用弹出卡片,在洞察开入口」)');
}

console.log('daily-report-crossface: OK(8 点定稿 / 整天窗口 / 跨面配额 / 正向准入 / 邮件不复述 / 默认开)');
