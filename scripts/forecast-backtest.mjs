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

function rowsFromBackup(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = raw?.entries || raw;
  const txRaw = entries?.['nesio-bank-tx-v1'];
  if (!txRaw) throw new Error('备份里没有 nesio-bank-tx-v1(还没连银行,或导出时被过滤掉了)');
  const txs = typeof txRaw === 'string' ? JSON.parse(txRaw) : txRaw;
  if (!Array.isArray(txs)) throw new Error('nesio-bank-tx-v1 不是数组');
  const rows = txs
    .filter((t) => t && typeof t.date === 'string' && Number.isFinite(t.amount))
    .filter((t) => t.amount > 0)
    .filter((t) => !TRANSFER_RE.test(`${t.name || ''} ${t.category || ''}`))
    .map((t) => ({ date: t.date.slice(0, 10), amount: t.amount, key: t.merchantId || t.name || '' }));
  return { rows, total: txs.length };
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

// ── 候选清单 ──
const CANDIDATES = [
  { name: '月底支出 · 日均外推', predict: F.predictMonthEndRunRate },
  { name: '月底支出 · 已发生+同期尾段中位数', predict: F.predictMonthEndTailMedian },
];
const NAIVES = [
  { name: '上月即本月', fn: F.naiveLastMonth },
  { name: '近3月中位数', fn: F.naiveMedian3 },
];

// ── 跑 ──
let src;
try {
  src = dataPath ? rowsFromBackup(path.resolve(dataPath)) : fixtureRows();
} catch (e) {
  console.error(`✗ 读数据失败:${e.message}`);
  process.exit(1);
}
const { rows, total } = src;
const months = F.monthsPresent(rows);

console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log(`  预测回测 · ${dataPath ? path.basename(dataPath) : '内置合成样例(非真实数据)'}`);
console.log('══════════════════════════════════════════════════════════════');
console.log(`  原始流水 ${total} 笔 → 计入支出 ${rows.length} 笔`);
console.log(`  覆盖月份 ${months.length} 个:${months[0] || '—'} … ${months[months.length - 1] || '—'}`);
console.log(`  预测时点:每月 ${cutoffDay} 号(只看当天及以前的流水)`);
console.log('');

if (months.length < 3) {
  console.log('  数据不足 3 个月,回测没有意义 —— 先攒几个月再来。');
  process.exit(0);
}

const reports = [];
for (const c of CANDIDATES) {
  for (const nv of NAIVES) {
    const samples = F.backtest(rows, { cutoffDay, predict: c.predict, naive: nv.fn });
    reports.push({ ...F.scoreSamples(`${c.name}  vs  ${nv.name}`, samples), samples });
  }
}

const VERDICT_ZH = { adopt: '✅ 采纳', reject: '❌ 否决', unproven: '⚠️  存疑' };
for (const r of reports) {
  console.log(`── ${r.name}`);
  if (r.n === 0) { console.log('   无有效样本(数据不足)\n'); continue; }
  console.log(`   样本 ${r.n} 次 · 平均误差 ${r.mae} · 平均偏差率 ${r.mape}%`);
  console.log(`   笨基线误差 ${r.naiveMae} · 技能分 ${r.skill >= 0 ? '+' : ''}${(r.skill * 100).toFixed(1)}%`);
  console.log(`   系统性倾向 ${r.bias > 0 ? `高估 ${r.bias}` : r.bias < 0 ? `低估 ${Math.abs(r.bias)}` : '无'}`);
  console.log(`   区间(p80):±${r.p80Pct}%  ← 若采纳,这就是该给用户看的带宽`);
  console.log(`   ${VERDICT_ZH[r.verdict]} — ${r.note}`);
  console.log('');
}

const adopted = reports.filter((r) => r.verdict === 'adopt');
console.log('══════════════════════════════════════════════════════════════');
if (adopted.length === 0) {
  console.log('  结论:没有候选赢过笨办法 —— 按约定,这一批不上线。');
  console.log('  (要么换预测方法,要么承认这件事就该用「上月即本月」)');
} else {
  const best = adopted.sort((a, b) => b.skill - a.skill)[0];
  console.log(`  结论:${adopted.length} 个候选达标,最佳 = ${best.name}`);
  console.log(`  上线时应呈现:点估计 ± ${best.p80Pct}%(依据:过去 ${best.n} 次回测的 p80 残差)`);
}
console.log('══════════════════════════════════════════════════════════════');
console.log('');
