/**
 * 行为契约:健康镜头 A/C 屏(2026-07-29)。
 *
 * 锁四件坏了没人看得见的事:
 *   ① 曲线纵轴没把参考区间包进去 —— 全部正常的序列会把绿带挤出画外,
 *      用户看到一条上下起伏的线却没有参照物,比不画更吓人。
 *   ② 用药竖线依赖 startedAt。录入那一步一旦「猜」一个日期,C 屏最值钱的
 *      那根线就是假的。
 *   ③ 打卡(今天吃过了)写失败被吞 —— 打个勾,数据没存上,下次打开又是待服。
 *   ④ 健康镜头被 Apple Health 的空态早退挡住 —— 化验/用药是另一套数据源,
 *      没导过 Apple Health 的人本该照样能用。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// 注释里的承诺不是承诺。
const code = (p) => stripComments(read(p));

// ── ① 纵轴必须包住参考区间 ────────────────────────────────────────────────────
{
  const src = code('components/portal/health/LabCurve.tsx');
  assert.match(
    src, /Math\.min\(\s*\.\.\.vals\s*,\s*low\s*\?\?\s*Infinity\s*\)/,
    '纵轴下界没把参考下限算进去 —— 全正常的序列会把绿带挤出画外',
  );
  assert.match(
    src, /Math\.max\(\s*\.\.\.vals\s*,\s*high\s*\?\?\s*-Infinity\s*\)/,
    '纵轴上界没把参考上限算进去',
  );
  // 没有参考区间时**不许**画一条假的参照带
  assert.match(src, /bandY\s*!=\s*null\s*&&\s*bandH\s*>\s*0/, '没有参考区间时不许画绿带(画了就是编一个参照物)');
  // 绿带在夜间必须还看得见。--status-go-soft 夜间是 #7fb39f2e(18% 透明),
  // 铺在暖色深底上就是一条灰印子 —— 实测过。用 --status-go + fillOpacity。
  assert.ok(
    !/fill="var\(--status-go-soft\)"/.test(src),
    '绿带别用 --status-go-soft:夜间几乎看不见,而绿带的全部意义就是一眼看出正常范围',
  );
  assert.match(src, /fill="var\(--status-go\)"\s+fillOpacity/, '绿带用 --status-go + fillOpacity,两个主题下都看得见');
}

// ── ② 用药竖线来自 startedAt,且只画时间窗内的 ────────────────────────────────
{
  const src = code('components/portal/health/LabCurve.tsx');
  assert.match(src, /Date\.parse\(m\.startedAt\)/, '用药竖线必须用 startedAt');
  assert.match(src, /m\.ms\s*>=\s*t0\s*&&\s*m\.ms\s*<=\s*t1/, '窗外的用药竖线会贴在边上误导人,必须滤掉');

  // 录入表单里,用药的 startedAt 必须是用户选的日期,不许默认「今天」蒙混
  const sheet = code('components/portal/health/HealthRecordSheet.tsx');
  assert.match(sheet, /recordMed\(\{[^}]*startedAt:\s*date/s, '录用药时 startedAt 必须取用户选的日期');
}

// ── ③ 打卡写失败必须看得见 ────────────────────────────────────────────────────
{
  const log = code('lib/health/med-log.ts');
  assert.match(log, /reportStorageDropped\(\)/, '打卡写失败必须 reportStorageDropped(红线:不许静默丢用户数据)');
  assert.match(log, /return false;/, 'save 失败要回传 false,好让 UI 显示失败');

  const cards = code('components/portal/health/HealthLensCards.tsx');
  assert.match(
    cards, /if\s*\(setMedTaken\([^)]*\)\)\s*setLogErr\(null\);\s*else\s*setLogErr\(/,
    '打卡按钮没判返回值 —— 写失败也会显示成打上了勾',
  );
  assert.match(cards, /role="alert"/, '打卡失败要有 role=alert 的可见提示');
}

// ── ④ 空态早退不许把健康镜头一起挡掉 ──────────────────────────────────────────
{
  const dash = read('components/portal/health/HealthDashboard.tsx');
  const earlyReturn = dash.indexOf('if (!data || data.metrics.length === 0)');
  const mainReturn = dash.indexOf('const importedLabel');
  assert.ok(earlyReturn > 0 && mainReturn > earlyReturn, 'HealthDashboard 的空态早退分支找不到了');
  const emptyBranch = dash.slice(earlyReturn, mainReturn);
  assert.match(
    emptyBranch, /<HealthLensCards/,
    '没导过 Apple Health 的人走的是这条早退分支 —— 健康镜头必须也在这里渲染,'
    + '否则「化验/用药/就诊」被一个不相干的数据源挡住了',
  );
  assert.match(emptyBranch, /<HealthRecordSheet/, '空态分支也要能记一条,否则第一条数据永远录不进来');
}

// ── 纯函数:med-log 的日期与归一 ───────────────────────────────────────────────
{
  const src = read('lib/health/med-log.ts');
  const start = src.indexOf('export function todayYmd');
  const end = src.indexOf('function save(');
  // KEEP_DAYS 必须从源码里读,不能在测试里写死一个 —— 写死的话源码改成 7 天,
  // 测试拿着自己的 60 照样绿(测的是测试自己,不是代码)。
  const keep = src.match(/const KEEP_DAYS\s*=\s*(\d+)/);
  assert.ok(keep, 'med-log 里找不到 KEEP_DAYS');
  const js = ts.transpileModule(`const KEEP_DAYS = ${keep[1]};\n${src.slice(start, end)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Date, JSON, Object, Array, window: undefined, localStorage: undefined });
  const M = mod.exports;

  // 日期用本地日,不是 UTC —— 用 toISOString 的话晚上八点后「今天」会跳到明天
  assert.equal(M.todayYmd(new Date(2026, 6, 29, 23, 30)), '2026-07-29', '「今天」必须按本地日算,不许用 UTC');

  // 只留最近 60 天
  const pruned = M.prune({ '2026-07-29': ['a'], '2026-07-01': ['b'], '2020-01-01': ['c'] }, '2026-07-29');
  assert.ok(pruned['2026-07-29'] && pruned['2026-07-01'], '60 天内的要留住');
  assert.equal(pruned['2020-01-01'], undefined, '太老的打卡该清掉(只占配额)');
  // 空数组不留(否则清完药还留一堆空壳日期)
  assert.equal(M.prune({ '2026-07-29': [] }, '2026-07-29')['2026-07-29'], undefined);
}

console.log('health-lens: OK(纵轴含参考区间 · 竖线来自 startedAt · 打卡失败可见 · 空态不挡镜头)');
