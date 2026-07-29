/**
 * forecast-backtest —— 离线回测:候选预测器到底能不能赢过笨办法?
 *
 * 用法:
 *   node scripts/forecast-backtest.mjs                      # 跑内置合成样例(自检用)
 *   node scripts/forecast-backtest.mjs --data ~/nesio-backup-2026-07-29.json
 *   node scripts/forecast-backtest.mjs --data <备份> --cutoff-day 10
 *
 * 备份文件来自 App 内「设置 → 数据与隐私 → 导出」,形状 { entries: { key: jsonString } },
 * 本脚本只读 nesio-bank-tx-v1。**全程离线,不发任何网络请求,不写回任何文件。**
 *
 * 口径说明(重要,别看漏):
 *   这里用 `amount > 0` 近似「支出」,并剔除明显的转账/还款描述,没有跑完整的 txFlow
 *   (那条链要 localStorage 和学习到的规则)。所以**绝对误差**会比真实口径略糙;
 *   但模型和笨基线吃的是同一份过滤结果,**技能分(相对好坏)依然可信** —— 而技能分
 *   才是「这个预测器要不要做」的判据。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function loadTs(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN });
  return mod.exports;
}

const F = loadTs('../lib/portal/forecast-core.ts');

// ── 参数 ──
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const dataPath = arg('--data', null);
const cutoffDay = Number(arg('--cutoff-day', 15));

// ── 取数 ──
// 转账/还款/内部划账:不是消费,进来会把两边基线一起搅浑
const TRANSFER_RE = /transfer|payment thank|autopay|online payment|credit card payment|直接借记|还款|转账|信用卡还款|内部转账/i;

function parseEntry(entries, key) {
  const v = entries?.[key];
  if (v == null) return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
}

/**
 * 备份清单体检:先把文件里到底有什么摊开。
 * 「App 里 3000+ 笔,导出只有 127 笔」时,这一步直接分辨是**导出漏了**
 * 还是**导出的那台设备本来就没拉全**(流水走云同步,新设备要等拉完)。
 */
function inventory(entries) {
  const KEYS = [
    ['nesio-bank-tx-v1', '银行流水'],
    ['nesio-bank-accounts-v1', '银行账户'],
    ['nesio-expenses-v1', '手动记账/域内支出'],
    ['nesio-fin-assets-v1', '手动资产'],
    ['nesio-fin-networth-series-v1', '净值快照'],
    ['nesio-life-graph-v1', '生命图谱节点'],
  ];
  const out = [];
  for (const [k, label] of KEYS) {
    const v = parseEntry(entries, k);
    const n = Array.isArray(v) ? v.length : v == null ? null : '(非数组)';
    out.push({ key: k, label, n });
  }
  return out;
}

function rowsFromBackup(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = raw?.entries || raw;
  const inv = inventory(entries);
  const totalKeys = Object.keys(entries || {}).length;

  const txs = parseEntry(entries, 'nesio-bank-tx-v1');
  if (!Array.isArray(txs)) throw new Error('备份里没有 nesio-bank-tx-v1 数组(还没连银行,或这台设备没拉到流水)');

  const bankRows = txs
    .filter((t) => t && typeof t.date === 'string' && Number.isFinite(t.amount))
    .filter((t) => t.amount > 0)
    .filter((t) => !TRANSFER_RE.test(`${t.name || ''} ${t.category || ''}`))
    .map((t) => ({ date: t.date.slice(0, 10), amount: t.amount, key: t.merchantId || t.name || '' }));

  // 手动记账(现金/红包渠道等)—— App 的财务口径含它,回测此前漏读了
  const exps = parseEntry(entries, 'nesio-expenses-v1');
  const manualRows = Array.isArray(exps)
    ? exps
      .filter((e) => e && typeof e.occurredAt === 'string' && Number.isFinite(e.amount))
      .filter((e) => e.includeInFinance !== false && e.kind !== 'income')
      .map((e) => ({ date: e.occurredAt.slice(0, 10), amount: Math.abs(e.amount), key: e.merchant || e.category || 'manual' }))
    : [];

  const rows = [...bankRows, ...manualRows].sort((a, b) => (a.date < b.date ? -1 : 1));
  return { rows, total: txs.length, bankRows: bankRows.length, manualRows: manualRows.length, inv, totalKeys };
}

/** 内置合成样例:12 个月,月基线 3000 + 噪声 + 月初房租 —— 只为自检管线,不代表真实数据。 */
function fixtureRows() {
  const rows = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let m = 1; m <= 12; m++) {
    const ym = `2025-${String(m).padStart(2, '0')}`;
    rows.push({ date: `${ym}-02`, amount: 1200, key: 'rent' });          // 月初固定
    for (let d = 3; d <= 28; d++) {
      if (rnd() < 0.55) rows.push({ date: `${ym}-${String(d).padStart(2, '0')}`, amount: Math.round(40 + rnd() * 120), key: 'daily' });
    }
    rows.push({ date: `${ym}-26`, amount: Math.round(300 + rnd() * 200), key: 'card' }); // 月末刷卡
  }
  return { rows, total: rows.length };
}

// ── 候选清单(候选与笨基线一起跑,才能算共同可比月份)──
const CAND_NAMES = ['日均外推', '已发生+同期尾段中位数'];
const NAIVE_NAMES = ['上月即本月', '近3月中位数'];
const PREDICTORS = {
  '日均外推': F.predictMonthEndRunRate,
  '已发生+同期尾段中位数': F.predictMonthEndTailMedian,
  '上月即本月': F.naiveLastMonth,
  '近3月中位数': F.naiveMedian3,
};

// ── 跑 ──
let src;
try {
  src = dataPath ? rowsFromBackup(path.resolve(dataPath)) : fixtureRows();
} catch (e) {
  console.error(`✗ 读数据失败:${e.message}`);
  process.exit(1);
}
const { rows, total, inv, totalKeys, bankRows, manualRows } = src;
const months = F.monthsPresent(rows);

console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log(`  预测回测 · ${dataPath ? path.basename(dataPath) : '内置合成样例(非真实数据)'}`);
console.log('══════════════════════════════════════════════════════════════');

if (inv) {
  console.log('── 备份清单(先确认这份文件到底装了什么)');
  console.log(`   备份共 ${totalKeys} 个键`);
  for (const it of inv) {
    const shown = it.n == null ? '缺失' : `${it.n}`;
    console.log(`   ${it.label.padEnd(16, ' ')} ${shown}`);
  }
  console.log('');
  console.log(`   银行流水计入支出 ${bankRows} 笔 · 手动记账计入 ${manualRows} 笔`);
  console.log('');
}
console.log(`  原始流水 ${total} 笔 → 计入支出 ${rows.length} 笔`);
console.log(`  覆盖月份 ${months.length} 个:${months[0] || '—'} … ${months[months.length - 1] || '—'}`);
console.log(`  预测时点:每月 ${cutoffDay} 号(只看当天及以前的流水)`);
console.log('');

if (months.length < 3) {
  console.log('  数据不足 3 个月,回测没有意义 —— 先攒几个月再来。');
  process.exit(0);
}

// ── 数据体检:先判断这份数据配不配下结论 ────────────────────────────
// 首轮教训:MAE 只有 85 但偏差率 82%,反推月度总额仅百余元 —— 那不是真实开销,
// 是某张很少用的卡。在这种数据上比「谁更准」,比的是谁更会拟合噪音。
const perMonth = months.map((m) => rows.filter((r) => F.ymOf(r.date) === m).length);
const monthTotals = months.map((m) => F.monthTotal(rows, m));
const medCount = F.median(perMonth);
const medTotal = F.median(monthTotals);
const emptyish = perMonth.filter((c) => c < 3).length;

console.log('── 数据体检');
console.log(`   每月笔数中位数 ${medCount} 笔 · 月度总额中位数 ${medTotal}`);
console.log(`   笔数 <3 的月份:${emptyish}/${months.length}`);
const thin = medCount < 10;
if (thin) {
  console.log('   ⚠️  这份数据偏薄(每月中位数 <10 笔)。真实生活的月消费很难只有这么几笔 ——');
  console.log('      更可能是只连了一张少用的卡,或 Plaid 只拉到很浅的历史。');
  console.log('      **薄数据上的技能分主要在比拟合噪音的能力,下面的结论只能当管线自检看。**');
}
console.log('');

// ── 配对回测:所有预测器同跑,只在共同可比月份上比分 ────────────────
const run = F.backtestPaired(rows, cutoffDay, PREDICTORS);
console.log('── 可比性');
console.log(`   走查月份 ${run.months.length} 个 · 全体都开得了口的 ${run.common.length} 个(横向比较只在这些月上做)`);
for (const n of Object.keys(PREDICTORS)) {
  const cov = run.coverage[n];
  const flag = cov < F.MIN_COVERAGE ? '  ← 开口率过低' : '';
  console.log(`   ${n}:能开口 ${Math.round(cov * 100)}%${flag}`);
}
console.log('');

const reports = [];
for (const c of CAND_NAMES) {
  for (const nv of NAIVE_NAMES) {
    const samples = F.pairedSamples(run, c, nv);
    reports.push(F.scoreSamples(`${c}  vs  ${nv}`, samples, run.coverage[c]));
  }
}

const VERDICT_ZH = {
  adopt: '✅ 采纳', reject: '❌ 否决', unproven: '⚠️  存疑',
  unusable: '🚫 不可用', sparse: '🕳️  开口太少',
};
for (const r of reports) {
  console.log(`── ${r.name}`);
  if (r.n === 0) { console.log('   无共同可比样本\n'); continue; }
  console.log(`   样本 ${r.n} 次(共同月份) · 平均误差 ${r.mae} · 平均偏差率 ${r.mape}%`);
  console.log(`   笨基线误差 ${r.naiveMae} · 技能分 ${r.skill >= 0 ? '+' : ''}${(r.skill * 100).toFixed(1)}%`);
  console.log(`   系统性倾向 ${r.bias > 0 ? `高估 ${r.bias}` : r.bias < 0 ? `低估 ${Math.abs(r.bias)}` : '无'}`);
  console.log(`   区间(p80):±${r.p80Pct}%${r.p80Pct > F.MAX_P80_PCT ? `  ← 超出可呈现上限 ±${F.MAX_P80_PCT}%` : ''}`);
  console.log(`   ${VERDICT_ZH[r.verdict]} — ${r.note}`);
  console.log('');
}

const adopted = reports.filter((r) => r.verdict === 'adopt');
console.log('══════════════════════════════════════════════════════════════');
if (thin) {
  console.log('  ⚠️  数据偏薄,下面的裁决不作数 —— 先把真实流水补全再跑一次。');
}
if (adopted.length === 0) {
  console.log('  结论:没有候选同时满足「赢过笨基线 + 区间能给人看 + 开得了口」。');
  console.log('  按约定,这一批不上线。');
  const nearMiss = reports.filter((r) => r.verdict === 'unusable');
  if (nearMiss.length) {
    console.log(`  (${nearMiss.length} 个赢了笨基线但区间太宽 —— 赢过笨办法 ≠ 能用)`);
  }
} else {
  const best = adopted.sort((a, b) => a.p80Pct - b.p80Pct)[0]; // 按可用性排,不按技能分
  console.log(`  结论:${adopted.length} 个候选全部达标,最佳 = ${best.name}`);
  console.log(`  上线时应呈现:点估计 ± ${best.p80Pct}%(依据:${best.n} 次共同月份回测的 p80 残差)`);
  console.log(`  注意 ${best.bias > 0 ? `系统性高估 ${best.bias}` : `系统性低估 ${Math.abs(best.bias)}`},呈现时应先做偏差校正。`);
}
console.log('══════════════════════════════════════════════════════════════');
console.log('');
