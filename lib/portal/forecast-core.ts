/**
 * forecast-core — 预测的纯核:候选预测器 + 笨基线 + 技能分评分。
 *
 * 设计立场(2026-07-29 用户拍板「先离线回测,再决定做不做」):
 *  ① **先赢过笨办法,再谈上线**。技能分 = 1 − MAE/笨基线MAE;≤0 的预测器直接删,不进产品。
 *  ② **区间来自回测残差,不许拍脑袋**。p80 带宽是「过去 N 次里 80% 落在这个范围」的事实。
 *  ③ **绝不看未来**。所有预测器只接受 `visibleAt()` 过滤后的行 —— 泄漏一次,整份回测报废。
 *
 * 本文件不 import 任何东西(vm 测试壳与回测脚本都要能直接跑),也不碰存储。
 * 口径:`amount > 0 = 流出(支出)`,与 Plaid/bank-tx 一致;调用方负责先做 txFlow 过滤,
 * 只把「算作支出」的行喂进来。
 */

export interface FlowRow {
  date: string;   // 'YYYY-MM-DD'
  amount: number; // >0 流出
  key?: string;   // 商户归并键(定期账单类预测用)
}

export function ymOf(date: string): string {
  return date.slice(0, 7);
}

export function dayOf(date: string): number {
  return Number(date.slice(8, 10)) || 0;
}

export function daysInMonth(ym: string): number {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return new Date(y, m, 0).getDate();
}

// ── 泄漏防线 ────────────────────────────────────────────────────────────

/**
 * 回测的第一道也是最重要的一道闸:只保留 cutoff 当天及以前的行。
 * 预测器只能拿到这个函数的输出 —— 任何绕过它直接读全量数据的预测器,分数都是假的。
 */
export function visibleAt(rows: readonly FlowRow[], cutoff: string): FlowRow[] {
  return rows.filter((r) => r.date <= cutoff);
}

// ── 真值 ────────────────────────────────────────────────────────────────

/** 某月实际总支出(回测的 actual)。 */
export function monthTotal(rows: readonly FlowRow[], ym: string): number {
  let s = 0;
  for (const r of rows) if (ymOf(r.date) === ym && r.amount > 0) s += r.amount;
  return Math.round(s * 100) / 100;
}

/** 数据里出现过的月份(升序)。 */
export function monthsPresent(rows: readonly FlowRow[]): string[] {
  return [...new Set(rows.map((r) => ymOf(r.date)))].sort();
}

// ── 候选预测器(输入必须是 visibleAt 之后的行)────────────────────────

/**
 * 候选 A「日均外推」:本月已发生支出 ÷ 已过天数 × 当月天数。
 * 最朴素的跑动率,也是最容易被月初/月末结构性差异打败的那个 —— 正好用来试。
 */
export function predictMonthEndRunRate(visible: readonly FlowRow[], cutoff: string): number | null {
  const ym = ymOf(cutoff);
  const d = dayOf(cutoff);
  if (d <= 0) return null;
  const soFar = monthTotal(visible, ym);
  if (soFar <= 0) return null;
  return Math.round((soFar / d) * daysInMonth(ym) * 100) / 100;
}

/**
 * 候选 B「已发生 + 历史同期尾段」:本月已花的照实算,剩下的天数用**过去几个月同期尾段
 * 的中位数**补。比日均外推更认月内节律(房租月初、信用卡月末)。
 */
export function predictMonthEndTailMedian(
  visible: readonly FlowRow[], cutoff: string, lookback = 6,
): number | null {
  const ym = ymOf(cutoff);
  const d = dayOf(cutoff);
  if (d <= 0) return null;
  const soFar = monthTotal(visible, ym);

  const prevMonths = monthsPresent(visible).filter((m) => m < ym).slice(-lookback);
  const tails: number[] = [];
  for (const m of prevMonths) {
    let tail = 0;
    let full = 0;
    for (const r of visible) {
      if (ymOf(r.date) !== m || r.amount <= 0) continue;
      full += r.amount;
      if (dayOf(r.date) > d) tail += r.amount;
    }
    if (full > 0) tails.push(tail); // 只用有数据的月份,空月不拉低中位数
  }
  if (!tails.length) return null;
  const tail = median(tails);
  return Math.round((soFar + tail) * 100) / 100;
}

/**
 * 笨基线「上一个完整月」:上个月花了多少,这个月就是多少。
 * 预测器打不过它,就没有存在价值。
 */
export function naiveLastMonth(visible: readonly FlowRow[], cutoff: string): number | null {
  const ym = ymOf(cutoff);
  const prev = monthsPresent(visible).filter((m) => m < ym).pop();
  if (!prev) return null;
  const v = monthTotal(visible, prev);
  return v > 0 ? v : null;
}

/** 笨基线之二「近 3 个完整月中位数」——比上月更稳,是更难打的基线。 */
export function naiveMedian3(visible: readonly FlowRow[], cutoff: string): number | null {
  const ym = ymOf(cutoff);
  const prev = monthsPresent(visible).filter((m) => m < ym).slice(-3);
  const vals = prev.map((m) => monthTotal(visible, m)).filter((v) => v > 0);
  if (!vals.length) return null;
  return Math.round(median(vals) * 100) / 100;
}

// ── 定期账单:稀疏数据里唯一有结构的部分 ────────────────────────────
//
// 首轮真实回测的教训:每月仅约 5 笔时,「月底总支出」被单笔消费落在月末还是月初
// 主宰,任何方法的区间都会宽到没法看 —— 那是**预测目标本身不可预测**,不是方法不好。
// 但同一份数据里,订阅/账单是周期性的:它该来的时候就会来。把预测目标换成
// 「下一笔定期账单何时扣、扣多少」,信噪比完全不同,而且真的改变决策(提前知道要扣钱)。

export interface RecurringGuess {
  key: string;
  nextDate: string;
  amount: number;
}

/** 同一商户的历史扣款日期(升序)。 */
function chargesOf(visible: readonly FlowRow[], key: string): FlowRow[] {
  return visible.filter((r) => r.key === key && r.amount > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** 日期字符串加天数(UTC 锚点,避开 DST)。 */
export function addDaysStr(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * 候选:下一笔扣款日 = 最近一次扣款 + 历史间隔中位数。
 * 用中位数而非均值 —— 一次补扣/跳票不该把整个节奏带偏。
 * 少于 3 次扣款 → 返回 null(两点连线不算规律,不硬猜)。
 */
export function predictNextChargeDate(visible: readonly FlowRow[], key: string): string | null {
  const list = chargesOf(visible, key);
  if (list.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < list.length; i++) gaps.push(daysBetween(list[i - 1].date, list[i].date));
  const cadence = Math.round(median(gaps));
  if (cadence < 5 || cadence > 400) return null; // 太密(同日多笔)或太疏(年费以上)不做
  return addDaysStr(list[list.length - 1].date, cadence);
}

/** 笨基线:下一笔就在「上次 + 30 天」(当所有账单都是月付)。 */
export function naiveNextChargeDate(visible: readonly FlowRow[], key: string): string | null {
  const list = chargesOf(visible, key);
  if (list.length < 3) return null;
  return addDaysStr(list[list.length - 1].date, 30);
}

/** 候选:下一笔金额 = 历史金额中位数(抗一次性涨价/促销)。 */
export function predictNextChargeAmount(visible: readonly FlowRow[], key: string): number | null {
  const list = chargesOf(visible, key);
  if (list.length < 3) return null;
  return Math.round(median(list.map((r) => r.amount)) * 100) / 100;
}

/** 笨基线:下一笔金额 = 上一笔金额。 */
export function naiveNextChargeAmount(visible: readonly FlowRow[], key: string): number | null {
  const list = chargesOf(visible, key);
  if (list.length < 3) return null;
  return list[list.length - 1].amount;
}

/** 出现 ≥minCount 次的商户键 —— 只有这些才谈得上「定期」。 */
export function recurringKeys(rows: readonly FlowRow[], minCount = 4): string[] {
  const c = new Map<string, number>();
  for (const r of rows) if (r.amount > 0 && r.key) c.set(r.key, (c.get(r.key) || 0) + 1);
  return [...c.entries()].filter(([, n]) => n >= minCount).map(([k]) => k).sort();
}

/**
 * 定期账单回测:对每个商户的每一次扣款(第 4 次起),站在**前一次扣款当天**预测
 * 下一次的日期与金额,再与真实值对账。
 * 日期误差单位是「天」,金额误差单位是钱 —— 两者分开评分,不混为一谈。
 */
export function backtestRecurring(
  rows: readonly FlowRow[],
  mode: 'date' | 'amount',
): { samples: Sample[]; naiveSamples: Sample[] } {
  const samples: Sample[] = [];
  const naiveSamples: Sample[] = [];
  for (const key of recurringKeys(rows)) {
    const list = chargesOf(rows, key);
    for (let i = 3; i < list.length; i++) {
      const cutoff = list[i - 1].date;              // 站在上一次扣款当天
      const visible = visibleAt(rows, cutoff);      // ← 同一道防泄漏闸
      const truth = list[i];
      if (mode === 'date') {
        const p = predictNextChargeDate(visible, key);
        const nv = naiveNextChargeDate(visible, key);
        if (!p || !nv) continue;
        // 用「距 cutoff 的天数」当数值,误差即天数差
        samples.push({ cutoff, ym: ymOf(truth.date), pred: daysBetween(cutoff, p), actual: daysBetween(cutoff, truth.date), naive: daysBetween(cutoff, nv) });
        naiveSamples.push(samples[samples.length - 1]);
      } else {
        const p = predictNextChargeAmount(visible, key);
        const nv = naiveNextChargeAmount(visible, key);
        if (p == null || nv == null) continue;
        samples.push({ cutoff, ym: ymOf(truth.date), pred: p, actual: truth.amount, naive: nv });
        naiveSamples.push(samples[samples.length - 1]);
      }
    }
  }
  return { samples, naiveSamples };
}

// ── 统计工具 ────────────────────────────────────────────────────────────

export function median(vals: readonly number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 分位数(线性插值,输入需升序)。 */
export function quantile(sortedAsc: readonly number[], q: number): number {
  if (!sortedAsc.length) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

// ── 评分 ────────────────────────────────────────────────────────────────

export interface Sample {
  cutoff: string;
  ym: string;
  pred: number;
  actual: number;
  naive: number;
}

export type Verdict = 'adopt' | 'reject' | 'unproven' | 'unusable' | 'sparse';

export interface SkillReport {
  name: string;
  n: number;
  mae: number;          // 平均绝对误差
  mape: number;         // 平均绝对百分比误差(%)
  naiveMae: number;
  skill: number;        // 1 − mae/naiveMae;>0 才叫「有本事」
  bias: number;         // 平均带符号误差:>0 系统性高估,<0 系统性低估
  p80Pct: number;       // |百分比误差| 的 p80 → 区间带宽的真实出处
  coverage: number;     // 能开口的月份占比(0–1):三分之二时候说不出话的预测器不能上线
  verdict: Verdict;
  note: string;
}

/**
 * 三道门槛,缺一不可(2026-07-29 首轮真实数据回测后补齐后两道):
 *  ① MIN_SAMPLES  —— 样本太少不下结论
 *  ② MIN_SKILL    —— 必须明确赢过笨基线(相对好坏)
 *  ③ MAX_P80_PCT  —— **绝对可用性**:赢了笨基线但区间 ±107%,等于说
 *     「月底大概花 1000,上下浮动一千」—— 对用户零信息量,一样不能上线。
 *     首轮就是栽在这里:四个候选全「采纳」,其中三个的带宽根本没法给人看。
 *  ④ MIN_COVERAGE —— 开不了口的月份太多,再准也不是个功能。
 */
export const MIN_SAMPLES = 8;
export const MIN_SKILL = 0.05;
export const MAX_P80_PCT = 25;
export const MIN_COVERAGE = 0.8;

export function scoreSamples(name: string, samples: readonly Sample[], coverage = 1): SkillReport {
  const n = samples.length;
  if (n === 0) {
    return { name, n: 0, mae: 0, mape: 0, naiveMae: 0, skill: 0, bias: 0, p80Pct: 0, coverage, verdict: 'unproven', note: '无样本' };
  }
  let absSum = 0, pctSum = 0, naiveAbsSum = 0, signedSum = 0;
  const absPcts: number[] = [];
  for (const s of samples) {
    const err = s.pred - s.actual;
    absSum += Math.abs(err);
    signedSum += err;
    naiveAbsSum += Math.abs(s.naive - s.actual);
    const pct = s.actual !== 0 ? Math.abs(err / s.actual) * 100 : 0;
    pctSum += pct;
    absPcts.push(pct);
  }
  const mae = absSum / n;
  const naiveMae = naiveAbsSum / n;
  const skill = naiveMae > 0 ? 1 - mae / naiveMae : 0;
  absPcts.sort((a, b) => a - b);

  const p80 = quantile(absPcts, 0.8);

  // 门槛按「先看能不能用,再看比谁强」的顺序判 —— 相对优势不能替代绝对可用性。
  let verdict: Verdict;
  let note: string;
  if (n < MIN_SAMPLES) { verdict = 'unproven'; note = `样本只有 ${n} 个(需 ≥${MIN_SAMPLES}),不下结论`; }
  else if (coverage < MIN_COVERAGE) { verdict = 'sparse'; note = `${Math.round(coverage * 100)}% 的月份才开得了口(需 ≥${MIN_COVERAGE * 100}%)—— 说不出话的时候比说错更常见`; }
  else if (skill <= 0) { verdict = 'reject'; note = '打不过笨基线 —— 不该做'; }
  else if (skill < MIN_SKILL) { verdict = 'unproven'; note = `只比笨基线好 ${(skill * 100).toFixed(1)}%,不值得复杂化`; }
  else if (p80 > MAX_P80_PCT) { verdict = 'unusable'; note = `赢了笨基线 ${(skill * 100).toFixed(1)}%,但区间 ±${p80.toFixed(1)}% 没法给人看(上限 ±${MAX_P80_PCT}%)`; }
  else { verdict = 'adopt'; note = `比笨基线好 ${(skill * 100).toFixed(1)}%,区间 ±${p80.toFixed(1)}% 可呈现`; }

  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    name, n,
    mae: r2(mae), mape: r2(pctSum / n), naiveMae: r2(naiveMae),
    skill: Math.round(skill * 1000) / 1000,
    bias: r2(signedSum / n),
    p80Pct: r2(p80),
    coverage: Math.round(coverage * 1000) / 1000,
    verdict, note,
  };
}

// ── 回测走查 ────────────────────────────────────────────────────────────

export interface BacktestOpts {
  /** 每月在第几天做预测(默认 15 号:半个月信息量,留半个月可错) */
  cutoffDay?: number;
  /** 预测器:拿 visible 行 + cutoff,给出月底总支出估计 */
  predict: (visible: FlowRow[], cutoff: string) => number | null;
  /** 笨基线 */
  naive: (visible: FlowRow[], cutoff: string) => number | null;
}

/**
 * 在历史上逐月走查:第 M 月的 cutoffDay 日做预测 → 拿该月真实总额对账。
 * 只取「数据完整」的月份(该月之后仍有数据,说明这个月已经走完并同步过)。
 */
export function backtest(rows: readonly FlowRow[], opts: BacktestOpts): Sample[] {
  const cutoffDay = opts.cutoffDay ?? 15;
  const months = monthsPresent(rows);
  if (months.length < 2) return [];
  const lastMonth = months[months.length - 1]; // 最后一个月大概率是残月,不当真值
  const out: Sample[] = [];

  for (const ym of months) {
    if (ym >= lastMonth) continue;
    const cutoff = `${ym}-${String(cutoffDay).padStart(2, '0')}`;
    const visible = visibleAt(rows, cutoff);   // ← 唯一入口,防泄漏
    const pred = opts.predict(visible, cutoff);
    const naive = opts.naive(visible, cutoff);
    if (pred == null || naive == null) continue;
    const actual = monthTotal(rows, ym);        // 真值可以看全量 —— 它是对账用的答案
    if (actual <= 0) continue;
    out.push({ cutoff, ym, pred, actual, naive });
  }
  return out;
}

// ── 配对回测(唯一合法的横向比较方式)────────────────────────────────

export interface PairedRun {
  /** 走查到的全部月份(已排除残月与无真值月) */
  months: string[];
  /** ym → 真实总额 */
  actual: Record<string, number>;
  /** 预测器名 → (ym → 预测值);给不出值的月份不出现在里面 */
  values: Record<string, Record<string, number>>;
  /** 所有预测器都给得出值的月份 —— 唯一能横向比较的集合 */
  common: string[];
  /** 预测器名 → 能开口的月份占比 */
  coverage: Record<string, number>;
}

/**
 * 一次性跑完全部预测器,并算出「共同可比月份」。
 *
 * 为什么必须这样:首轮回测里,日均外推只在 6 个月开得了口、尾段中位数在 16 个月开口,
 * 两者的 MAE(315 vs 124)算的**根本不是同一批月份**,并排排序等于拿不同的考卷比分数。
 * 横向比较一律只在 common 上做;能开口多少,单独用 coverage 说。
 */
export function backtestPaired(
  rows: readonly FlowRow[],
  cutoffDay: number,
  predictors: Record<string, (visible: FlowRow[], cutoff: string) => number | null>,
): PairedRun {
  const all = monthsPresent(rows);
  const lastMonth = all[all.length - 1]; // 残月不当真值
  const names = Object.keys(predictors);
  const months: string[] = [];
  const actual: Record<string, number> = {};
  const values: Record<string, Record<string, number>> = {};
  for (const n of names) values[n] = {};

  for (const ym of all) {
    if (ym >= lastMonth) continue;
    const a = monthTotal(rows, ym);
    if (a <= 0) continue;
    months.push(ym);
    actual[ym] = a;
    const cutoff = `${ym}-${String(cutoffDay).padStart(2, '0')}`;
    const visible = visibleAt(rows, cutoff); // ← 同一道防泄漏闸,全体共用
    for (const n of names) {
      const v = predictors[n](visible, cutoff);
      if (v != null && Number.isFinite(v)) values[n][ym] = v;
    }
  }

  const common = months.filter((ym) => names.every((n) => values[n][ym] != null));
  const coverage: Record<string, number> = {};
  for (const n of names) {
    coverage[n] = months.length ? Object.keys(values[n]).length / months.length : 0;
  }
  return { months, actual, values, common, coverage };
}

/** 从配对结果里取某「候选 vs 笨基线」的样本 —— 只在 common 上,保证可比。 */
export function pairedSamples(run: PairedRun, candidate: string, naive: string): Sample[] {
  return run.common.map((ym) => ({
    cutoff: ym,
    ym,
    pred: run.values[candidate][ym],
    actual: run.actual[ym],
    naive: run.values[naive][ym],
  }));
}
