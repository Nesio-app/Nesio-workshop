/**
 * 行为契约:「今日精选」里的每张卡都得**自己报日期**(2026-07-30,bug #27)。
 *
 * 现场:概览页标题写「今日精选」,里面躺着一条 07/05 的步数 —— 三周前的数,
 * 跟同屏的活动三环 / 睡眠 / 血糖(都是这两天的)对不上。日期只以小字印在角上,
 * 看上去就像今天走了 554 步。
 *
 * 病根还是那句「凡是没被拦住的都算数」:
 *   data.metrics.find(m => m.key === 'steps' || m.group === 'activity')
 * 拿到最新一条就往「今日」里放,**从不问它有多新**。
 *
 * 这条契约钉三件事:
 *   ① 不是今天的数,卡片上必须**明说**多旧(「7/5 · 3 周前」),不许只印个 07/05;
 *   ② 只要有一张不是今天的,整段标题就从「今日精选」退成「近期精选」——
 *      标题是对整组卡的承诺,一条不成立整句就不成立;
 *   ③ 报不出日期的,一律不算今天(而不是「没被拦住 → 当今天」)。
 * 外加:三周前的步数**仍然显示**。它是真读数,错的只是把它叫「今日」——
 *   不能拿删数据当修 bug。
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

const { asOfNote, picksAreToday, dayKeyOf } = loadTs('lib/portal/health-picks.ts');

const TODAY = '2026-07-30';

/* ── ① 今天的数不用解释;不是今天的必须明说多旧 ──────────────────── */
{
  const fresh = asOfNote(TODAY, TODAY);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.zh, '', '今天的数不用在卡上补一句,那是噪音');

  const bug = asOfNote('2026-07-05', TODAY);
  assert.equal(bug.fresh, false, '07/05 距 07/30 三周半,不是今天');
  assert.match(bug.zh, /7\/5/, '日期要留着 —— 用户得能对上是哪天');
  assert.match(bug.zh, /周前|个月前/,
    '光印个「7/5」就是原来的 bug:太安静了,读者只会看见「今日精选 · 554 步」。' +
    '必须把「多久以前」说出口');

  assert.match(asOfNote('2026-07-29', TODAY).zh, /昨天/);
  assert.match(asOfNote('2026-07-27', TODAY).zh, /3 天前/);
  assert.match(asOfNote('2026-04-30', TODAY).zh, /个月前/);
}

/* ── ② 一条不新,整段标题就不许叫「今日」 ────────────────────────── */
{
  const rings = asOfNote(TODAY, TODAY);
  const sleep = asOfNote(TODAY, TODAY);
  const steps = asOfNote('2026-07-05', TODAY);

  assert.equal(picksAreToday([rings, sleep]), true, '全是今天的 → 可以叫「今日精选」');
  assert.equal(picksAreToday([rings, sleep, steps]), false,
    '这正是截图里的组合:两张今天的 + 一张三周前的。' +
    '标题是对**整组**卡的承诺,不是对最新那张的承诺 —— 一条不成立整句就不成立');
  assert.equal(picksAreToday([]), false, '一张卡都没有时,「今日精选」这句话没有任何东西支撑');
}

/* ── ③ 报不出日期 = 不算今天(不是「没被拦住就算数」)─────────────── */
{
  for (const bad of [null, undefined, '', '不是日期', '2026-13-99']) {
    const n = asOfNote(bad, TODAY);
    assert.equal(n.fresh, false, `${JSON.stringify(bad)} 报不出日期 → 不许当今天`);
    assert.ok(n.zh.length > 0, '也要在卡上说明白,而不是沉默地挂在「今日」下面');
  }
  // 未来日期是脏数据:不当今天,也不编一句「-3 天前」
  const future = asOfNote('2026-08-10', TODAY);
  assert.equal(future.fresh, false);
  assert.doesNotMatch(future.zh, /-\d/, '不许出现「-11 天前」这种话');
}

/* ── ④ 汇总卡(血糖 TIR / 情绪均值)说的是一段时间,口径不一样 ────── */
{
  const spanFresh = asOfNote(TODAY, TODAY, 'span');
  assert.equal(spanFresh.fresh, true, '数据一直更新到今天的汇总卡,不用补话');
  const spanOld = asOfNote('2026-07-05', TODAY, 'span');
  assert.match(spanOld.zh, /截至/,
    'TIR 是一段时间的汇总,说「7/5 的数据」是错的 —— 它不是某一天的数,只能说「截至 7/5」');
}

/* ── ⑤ 接线:概览页真的用了这套,且旧的「只印个小日期」已经拆掉 ──── */
{
  const dash = strip(read('components/portal/health/HealthDashboard.tsx'));
  const picks = dash.slice(dash.indexOf('function TodayPicks'), dash.indexOf('const SEV_ORDER'));
  assert.ok(picks.length > 200, 'TodayPicks 还在');

  assert.match(picks, /asOfNote\(/, '概览页要真的用这套判据,不能写了个 lib 没接上');
  assert.match(picks, /picksAreToday\(/, '标题也要跟着退让');
  assert.doesNotMatch(picks, /steps\.latestDate\.slice\(/,
    '旧写法(把 latestDate 切成 07/05 当副标小字印上)必须删掉 —— 那就是 #27 本身');
  assert.match(picks, /allToday \?/,
    '标题必须是条件的。写死「今日精选」的话,前面所有判据都白算');
  // 2026-07-30 自查(变异测试抓到的):上面几条只证明「算过了」,
  // 不证明「印出来了」。把副标改回 {p.sub} 一样绿 —— 那正是 #27 本身。
  assert.match(picks, /nesio-health-pick-sub">\{subOf\(p, i\)\}/,
    '算出来的那句话必须真的落在卡片副标上。只算不印 = 什么都没修');
  assert.match(picks, /const subOf = \(p: Pick, i: number\)/, 'subOf 还在');
  assert.match(picks, /enabled\.map\(\(p, i\) =>/,
    'notes 是按 enabled 的顺序算的,渲染也必须按同一个下标取 —— 错位就会把别人的日期安在这张卡上');

  // 数据没被删:步数依然进 all
  assert.match(picks, /metric-\$\{steps\.key\}/,
    '三周前的步数**仍然要显示** —— 它是真读数,错的只是把它叫「今日」。' +
    '拿删数据当修 bug 是另一种骗人');
}

/* ── ⑥ dayKeyOf 用本地日历日(用户看的是墙上的今天)────────────── */
{
  const d = new Date(2026, 6, 30, 23, 30);
  assert.equal(dayKeyOf(d), '2026-07-30',
    '晚上 11 点半在东八区之外用 UTC 会跳到 31 号 —— 用户看的是墙上的今天');
}

console.log('health-picks-asof: OK(旧数必须明说 / 一条不新整句退让 / 无日期不算今天 / 汇总卡说截至 / 已接线 / 本地日)');
