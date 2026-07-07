/**
 * guidance-ranker — 本地在线学习排序器(批次 52)。
 *
 * 把引导卡的排序从"设计者写死的加权和"升级成"从你的反馈里学出来的线性模型"。
 * 完全本地、无外部 ML、无依赖:一个在线逻辑回归(logistic SGD),权重存 localStorage。
 *
 * 关键设计:
 *   1) 冷启动 = 现有公式。初始权重就是批次 47 那套 [.30,.25,.20,.15,.10],两个新特征
 *      (hourFit/domainFit)起步 0。所以第一天的排序和旧公式一模一样、绝不更差,之后才
 *      从反馈里慢慢偏移。这正是把批次 47 里那个"Layer 7 学习信号"占位符补上。
 *   2) 只学"排序",不学"该不该出"。是否出卡仍由规则闸门(worthInterrupting/时段门)决定,
 *      学习器只在预算内决定谁排前面 —— 学坏了也不会漏掉重要卡或狂刷。
 *   3) 在线更新有界:小学习率 + L2 收缩 + 权重夹紧,防跑飞。
 *
 * 标签:'useful' → 1(采纳);'wrong'/'too_much'/'not_now' → 0(没采纳)。
 * 时序:出卡时 recordShown 把特征暂存;反馈到达时 applyFeedback 取回特征做一次 SGD。
 *
 * 顺带:反馈时也回喂 mirror-profile 的 learnFromFeedback —— 该函数此前全仓零调用(死回路),
 * 于是 hourFit/domainFit 一直停在种子默认;接上后这两个特征也真正随反馈变化。
 *
 * 2b·回放重训(A 计划):此前 learnInto 折进权重后 delete pending —— 原始训练样本用完即弃,
 * 权重"不可重训/易碎/不可迁移/不可审计"(system-layers L2 审计原话)。现在每次学习把
 * (特征, 标签) 追加进**训练样本日志**(IDB,自动进备份/删除收口):权重降级为日志的
 * 可回放投影 —— localStorage 蒸发时 load() 自愈重建;SGD 确定性,同一日志必得同一权重。
 * 注:反馈动词日志(personalization/feedback-log)不含特征向量,重训必须靠这份样本日志。
 */

import { learnFromFeedback } from '@/lib/portal/mirror-profile';
import { onFeedback, type FeedbackEvent, type Reaction } from '@/lib/platform/personalization';
import { createBlobStore } from '@/lib/portal/idb-blob-store';
import { reportStorageDropped } from '@/lib/portal/storage-health';

export interface GuidanceFeatures {
  risk: number;       // 风险严重度 severity/3      [0,1]
  time: number;       // 时效 urgency/100           [0,1]
  prep: number;       // 提前价值 prepValue/100     [0,1]
  confidence: number; // 数据置信 /100             [0,1]
  relevance: number;  // 来源相关 /100             [0,1]
  hourFit: number;    // 该时段你的互动度(mirror)  [0,1]
  domainFit: number;  // 该类卡你的采纳度(mirror)   [0,1]
}

const FEATURE_KEYS: (keyof GuidanceFeatures)[] = ['risk', 'time', 'prep', 'confidence', 'relevance', 'hourFit', 'domainFit'];
// 冷启动先验 = 现有静态公式(特征已归一到 [0,1],故 dot 与旧 raw/100 同序)。
const PRIOR_WEIGHTS: number[] = [0.30, 0.25, 0.20, 0.15, 0.10, 0.0, 0.0];

const LR = 0.08;     // 学习率:每次反馈只挪一点点
const L2 = 0.002;    // 权重收缩:防止某个特征权重无限增长
const W_CLAMP = 4;   // 权重夹紧范围 [-4,4]
const PENDING_CAP = 60;
const PENDING_TTL_MS = 14 * 86_400_000;

const KEY = 'nesio-guidance-ranker-v1';
const TRAIN_LOG_CAP = 500; // 训练样本日志上限(500 × 7 维,回放毫秒级;超出弃最旧)

interface PendingExample { f: number[]; type: string; at: string }
interface RankerState {
  w: number[];
  b: number;
  n: number; // 已学习的样本数(可观测"学了多少")
  pending: Record<string, PendingExample>;
}

/** 一条训练样本(特征 + 标签 + 时间):权重的事实来源,可回放/可审计。 */
export interface TrainExample { f: number[]; type: string; y: 0 | 1; at: string }

// 训练样本日志:IDB blob(createBlobStore 登记 → 自动进云备份/彻底删除收口)。
// 丢了它 = 丢可重训性(用户反馈的蒸馏),写失败必须可见(设计红线)。
const trainLog = createBlobStore<TrainExample[]>({
  key: 'nesio-ranker-trainlog-v1',
  updateEvent: 'nesio-ranker-trainlog-updated',
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

function appendTrainExample(ex: TrainExample): void {
  const cur = trainLog.load();
  const arr = Array.isArray(cur) ? cur.slice() : [];
  arr.push(ex);
  if (arr.length > TRAIN_LOG_CAP) arr.splice(0, arr.length - TRAIN_LOG_CAP);
  trainLog.save(arr);
}

function fresh(): RankerState {
  return { w: PRIOR_WEIGHTS.slice(), b: 0, n: 0, pending: {} };
}

// ranker 权重自存(proposal §3:ranker 是特征组合器,无需迁数据,只把接线改走统一反馈总线)。
function rawLoad(): RankerState {
  if (typeof window === 'undefined') return fresh();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as RankerState | null;
    if (raw && Array.isArray(raw.w) && raw.w.length === FEATURE_KEYS.length) {
      return { w: raw.w, b: raw.b ?? 0, n: raw.n ?? 0, pending: raw.pending ?? {} };
    }
  } catch { /* ignore */ }
  return fresh();
}

function load(): RankerState {
  const s = rawLoad();
  // 自愈:权重态是空白(localStorage 蒸发/换机恢复)而训练日志有样本 → 回放重建。
  // SGD 确定性 + 日志保序 → 重建权重与蒸发前逐位一致(截断日志则为最近 500 条的投影)。
  if (s.n === 0 && (trainLog.load()?.length ?? 0) > 0) {
    const healed = retrainRankerFromLog();
    if (healed) return rawLoad();
  }
  return s;
}

/**
 * 从训练样本日志回放重建权重(2b:权重=可回放投影)。
 * 用途:localStorage 蒸发自愈 / 云备份恢复到新机 / 审计验证。保留现有 pending(出卡暂存与权重独立)。
 */
export function retrainRankerFromLog(): { replayed: number } | null {
  const log = trainLog.load();
  if (!Array.isArray(log) || !log.length) return null;
  const s = fresh();
  for (const ex of log) {
    if (Array.isArray(ex.f) && ex.f.length === FEATURE_KEYS.length && (ex.y === 0 || ex.y === 1)) {
      learnInto(s, ex.f, ex.y);
    }
  }
  s.pending = rawLoad().pending;
  save(s);
  return { replayed: s.n };
}
function save(s: RankerState): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota */ }
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const vec = (f: GuidanceFeatures): number[] => FEATURE_KEYS.map((k) => f[k]);
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** 排序分:线性打分 w·x + b(单调于 sigmoid,直接拿来排序)。 */
export function rankerScore(f: GuidanceFeatures, state: RankerState = load()): number {
  return dot(state.w, vec(f)) + state.b;
}

/** 一次在线逻辑回归更新(就地改 s):w += LR·(err·x − L2·w),b += LR·err。 */
function learnInto(s: RankerState, x: number[], y: 0 | 1): void {
  const z = dot(s.w, x) + s.b;
  const p = 1 / (1 + Math.exp(-z));
  const err = y - p;
  for (let i = 0; i < s.w.length; i++) {
    s.w[i] = clamp(s.w[i] + LR * (err * x[i] - L2 * s.w[i]), -W_CLAMP, W_CLAMP);
  }
  s.b = clamp(s.b + LR * err, -W_CLAMP, W_CLAMP);
  s.n += 1;
}

/** 出卡时暂存特征(key 归一,见 normKey)。带 type 以便反馈时也回喂 mirror。 */
export function recordShownFeatures(cardId: string, f: GuidanceFeatures, type: string): void {
  const s = load();
  s.pending[normKey(cardId)] = { f: vec(f), type, at: new Date().toISOString() };
  prunePending(s);
  save(s);
}

function prunePending(s: RankerState): void {
  const now = Date.now();
  const entries = Object.entries(s.pending)
    .filter(([, e]) => now - new Date(e.at).getTime() < PENDING_TTL_MS)
    .sort((a, b) => b[1].at.localeCompare(a[1].at))
    .slice(0, PENDING_CAP);
  s.pending = Object.fromEntries(entries);
}

export type GuidanceFeedback = 'useful' | 'wrong' | 'not_now' | 'too_much' | undefined;

/** 反馈到达 → 取回该卡特征 → 一次 SGD。返回是否学到(有暂存特征才算)。 */
export function applyGuidanceFeedback(cardId: string, feedback: GuidanceFeedback): boolean {
  if (!feedback) return false;
  const s = load();
  const key = normKey(cardId);
  const rec = s.pending[key];
  if (!rec) return false;
  const y: 0 | 1 = feedback === 'useful' ? 1 : 0;
  learnInto(s, rec.f, y);
  delete s.pending[key];
  save(s);
  // 训练样本落日志(collect first):权重从此是它的可回放投影,不再"折进即弃"。
  appendTrainExample({ f: rec.f, type: rec.type, y, at: new Date().toISOString() });
  // 同步回喂 mirror(按卡类型当 domain 键),让 hourFit/domainFit 这两个特征也持续更新。
  try { learnFromFeedback(rec.type, feedback); } catch { /* best-effort */ }
  return true;
}

/** 卡 id 归一:ProactiveGuidanceCard 会剥 `guidance-dec-` 前缀,这里两边都双剥,保证 key 对得上。 */
export function normKey(id: string): string {
  return id.replace(/^guidance-dec-/, '').replace(/^guidance-/, '');
}

/** 统一 reaction → ranker 的采纳标签(useful/done=采纳;其余按语义映射,仅 useful 记 1)。 */
function reactionToGuidanceFeedback(r: Reaction): GuidanceFeedback {
  if (r === 'useful' || r === 'done') return 'useful';
  if (r === 'wrong') return 'wrong';
  if (r === 'too_much') return 'too_much';
  return 'not_now'; // snooze | dismiss
}

// 订阅统一反馈总线:card 维度的反馈 → ranker 更新(替代 useTodayData 手工直调)。更新律不变。
onFeedback((e: FeedbackEvent) => {
  if (e.dimension === 'card' && e.key) applyGuidanceFeedback(e.key, reactionToGuidanceFeedback(e.reaction));
});

// ── 2b③:情境分化测量仪(mirror 情境化的前置证据门)────────────────────────────
// 评估结论:反馈是全 app 最稀缺的数据,现在按 (domain×时段) 分桶会把稀缺样本劈碎、让所有
// 估计变差(proposal §5:证据驱动的后期可选进化)。先造测量仪不造模型:回放训练日志,
// 按 (卡类型 × 工作日/周末) 统计采纳率;两桶各 ≥5 样本且采纳率差 ≥0.25 才算"分化成立"。
// 灯亮了(diverges)才轮到真正的情境化分桶;透明面板(收尾块)将展示这份证据。

const CTX_MIN_N = 5;        // 每桶最少样本(少于这个不敢下结论)
const CTX_DIVERGE_GAP = 0.25; // 采纳率差阈值

export interface ContextEvidence {
  type: string;
  weekday: { n: number; acceptRate: number };
  weekend: { n: number; acceptRate: number };
  ready: boolean;    // 两桶证据都够
  diverges: boolean; // 证据够且分化明显 → 该类型值得情境化
}

/** 回放训练日志,产出每个卡类型的「工作日 vs 周末」采纳分化证据。 */
export function rankerContextEvidence(log: TrainExample[] | null = trainLog.load()): ContextEvidence[] {
  if (!Array.isArray(log) || !log.length) return [];
  const buckets = new Map<string, { wd: [number, number]; we: [number, number] }>(); // [n, accepted]
  for (const ex of log) {
    const t = Date.parse(ex.at);
    if (Number.isNaN(t) || (ex.y !== 0 && ex.y !== 1)) continue;
    const day = new Date(t).getDay();
    const b = buckets.get(ex.type) ?? { wd: [0, 0], we: [0, 0] };
    const slot = day === 0 || day === 6 ? b.we : b.wd;
    slot[0] += 1;
    slot[1] += ex.y;
    buckets.set(ex.type, b);
  }
  return [...buckets.entries()].map(([type, b]) => {
    const weekday = { n: b.wd[0], acceptRate: b.wd[0] ? Math.round((b.wd[1] / b.wd[0]) * 100) / 100 : 0 };
    const weekend = { n: b.we[0], acceptRate: b.we[0] ? Math.round((b.we[1] / b.we[0]) * 100) / 100 : 0 };
    const ready = weekday.n >= CTX_MIN_N && weekend.n >= CTX_MIN_N;
    return { type, weekday, weekend, ready, diverges: ready && Math.abs(weekday.acceptRate - weekend.acceptRate) >= CTX_DIVERGE_GAP };
  });
}

/** 供调试/透明展示:学了多少、当前权重(相对先验偏移多少)。 */
export function getRankerStats(): { n: number; weights: Record<string, number>; bias: number } {
  const s = load();
  const weights: Record<string, number> = {};
  FEATURE_KEYS.forEach((k, i) => { weights[k] = Math.round(s.w[i] * 1000) / 1000; });
  return { n: s.n, weights, bias: Math.round(s.b * 1000) / 1000 };
}
