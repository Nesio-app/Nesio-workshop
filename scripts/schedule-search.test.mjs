/**
 * 行为契约:日程页的搜索(2026-07-30 用户要求
 *「日历和邮件增加搜索,模糊搜索,包括全文和 title」)。
 *
 * 搜索是最不能「聪明」的地方。用户搜不到东西时,他要么认为自己记错了、要么认为
 * 软件坏了 —— 取决于规则他能不能在脑子里复现。所以「模糊」在这里只准是
 * **可预测的宽松**(子串 / 忽略大小写 / 全角折半角),不准是语义联想。
 * 这个仓库在「猜用户的意思」上已经翻过车(邮件标题里的「健身」被认成健康打卡)。
 *
 * 钉五件事:
 *   ① 空查询 = 不筛(返回全部),不是返回空;
 *   ② 多个词是 AND,不是 OR —— 「学校 通知」是两个条件;
 *   ③ 命中面必须**包含正文**,不只是标题(用户点名要「全文和 title」);
 *   ④ 本机全文那一层查不到时,**不许当成命中** —— 索引没水合好时宁可少给结果,
 *      也不能显示一条其实不匹配的行;
 *   ⑤ UI 上搜索排在筛选**之前**,标签上的数字必须等于点下去真能看到的条数。
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
    require: () => ({}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean,
  });
  return mod.exports;
}

const { searchTokens, matchesSearch, normalizeForSearch } = loadTs('lib/portal/schedule-search.ts');

const t = (title, meta = '', body = '') => ({ title, meta, body });

/* ── ① 空查询不筛 ─────────────────────────────────────────────────── */
{
  assert.equal(searchTokens('').length, 0);
  assert.equal(searchTokens('   ').length, 0, '只打了空格也算没搜');
  assert.ok(matchesSearch(t('随便什么'), searchTokens('')),
    '空查询必须返回全部 —— 返回空的话,清空搜索框那一瞬间列表会闪成「没有数据」');
}

/* ── ② 多词是 AND,不是 OR ────────────────────────────────────────── */
{
  const row = t('Church camp pickup', 'Janice <janice@example.com>');
  assert.ok(matchesSearch(row, searchTokens('camp janice')), '两个词都在,命中');
  assert.ok(
    !matchesSearch(row, searchTokens('camp 报税')),
    '多个词必须**都**命中。做成 OR 的话,多打一个词结果反而变多 —— ' +
    '用户加词是为了缩小范围,这与直觉相反',
  );
}

/* ── ③ 命中面:标题 + 副行 + 正文,且是子串、不区分大小写、全角折半角 ── */
{
  assert.ok(matchesSearch(t('ADE PROD Install'), searchTokens('prod')), '大小写不敏感');
  assert.ok(matchesSearch(t('会议'), searchTokens('janice'), undefined) === false);
  assert.ok(matchesSearch(t('会议', 'Janice'), searchTokens('janice')), '副行(发件人/地点)算命中面');
  assert.ok(
    matchesSearch(t('周三例会', '', '这次主要聊一下报销流程和新的差旅标准'), searchTokens('差旅')),
    '正文必须算命中面 —— 用户点名要的是「全文和 title」,只搜标题等于没做这件事',
  );
  assert.ok(matchesSearch(t('Amazon 订单'), searchTokens('mazo')), '子串命中,不要求整词对齐(这就是「模糊」)');
  assert.ok(
    matchesSearch(t('Amazon 订单'), searchTokens('Ａmazon')),
    '中文输入法下打出的全角字母要能命中 —— 折半角是可预测的宽松,不是猜',
  );
  assert.equal(normalizeForSearch('ＡＢ１２'), 'ab12');

  // 不做同义/语义:这是红线,不是遗憾。
  assert.ok(
    !matchesSearch(t('健身房年卡'), searchTokens('运动')),
    '不许做同义词联想 —— 「健身」被认成健康打卡就是这么来的',
  );
}

/* ── ④ 本机全文查不到时不许当命中 ─────────────────────────────────── */
{
  const row = t('账单', 'bank@example.com', '');
  assert.ok(!matchesSearch(row, searchTokens('尾号8821')), '没有全文可查时就是不命中');
  assert.ok(
    matchesSearch(row, searchTokens('尾号8821'), (tk) => tk === '尾号8821'),
    '调用方注入的本机全文命中要算数(邮件全文只存本机 IndexedDB,不在节点上)',
  );
  assert.ok(
    !matchesSearch(row, searchTokens('尾号8821'), () => false),
    '全文里没有就是没有 —— 不许因为「索引还没好」就放行,那会显示一条其实不匹配的行',
  );
}

/* ── ⑤ 面板接线:先搜后筛,标签数字跟着搜索结果走 ─────────────────── */
{
  const src = strip(read('components/portal/insights/SchedulePanel.tsx'));

  assert.match(src, /matchesSearch\(/, '面板要真的用上这个搜索,而不是自己另写一套');
  assert.match(src, /emailFulltextScore\(/,
    '邮件那两格必须接上本机全文索引 —— 只搜节点上的 ≤1500 预览,等于没做「全文」');

  // buildChips 的输入必须是**搜过之后**的行。反过来(用未搜索的全量算标签)会出现
  // 「工作 12」点进去只剩 3 条 —— 这个数字比没有更糟。
  const chipsCall = src.slice(src.indexOf('buildChips('), src.indexOf('buildChips(') + 40);
  assert.match(chipsCall, /buildChips\(baseRows/, '标签从 baseRows 长出来');
  const baseDef = src.slice(src.indexOf('const baseRows ='), src.indexOf('\n', src.indexOf('const baseRows =')));
  assert.match(baseDef, /searched/,
    'baseRows 必须是**搜索之后**的那批行 —— 否则标签上的数字和点下去看到的条数对不上');

  // 全文索引没水合好时必须显式说出来。搜不到而不解释,用户会认定「这封信不在里面」。
  assert.match(src, /ftReady/, '要知道本机全文索引好了没');
  assert.match(src, /!ftReady/, '没好的时候要走一条显式提示分支,不能默不作声');

  // 搜出 0 条要和「标签筛出 0 条」分开说 —— 两种情况的出口不一样。
  const empty = src.slice(src.indexOf('nesio-insights-empty'), src.indexOf('nesio-insights-empty') + 1200);
  assert.match(empty, /tokens\.length > 0/,
    '搜出 0 条时的空态要单独一句(带上搜的词 + 清空的出口),不能复用「这个标签下没有」');
}

console.log('schedule-search: OK(空不筛 / 多词 AND / 搜正文 / 全文不瞎放行 / 先搜后筛)');
