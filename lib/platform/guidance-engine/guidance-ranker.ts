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
 */

import { learnFromFeedback } from '@/lib/portal/mirror-profile';
import { createLearnerStore, registerLearner, type FeedbackEvent } from '@/lib/portal/learning/learner';

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

interface PendingExample { f: number[]; type: string; at: string }
interface RankerState {
  w: number[];
  b: number;
  n: number; // 已学习的样本数(可观测"学了多少")
  pending: Record<string, PendingExample>;
}

function fresh(): RankerState {
  return { w: PRIOR_WEIGHTS.slice(), b: 0, n: 0, pending: {} };
}

// 存取走 learner 底座的共享模板(替代此前自写的 load→JSON→save 样板)。更新律仍是本文件的 SGD。
const store = createLearnerStore<RankerState>({
  key: KEY,
  fresh,
  revive: (raw) => {
    const r = raw as RankerState;
    return r && Array.isArray(r.w) && r.w.length === FEATURE_KEYS.length
      ? { w: r.w, b: r.b ?? 0, n: r.n ?? 0, pending: r.pending ?? {} }
      : null;
  },
});
function load(): RankerState { return store.load(); }
function save(s: RankerState): void { store.save(s); }

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
  // 同步回喂 mirror(按卡类型当 domain 键),让 hourFit/domainFit 这两个特征也持续更新。
  try { learnFromFeedback(rec.type, feedback); } catch { /* best-effort */ }
  return true;
}

/** 卡 id 归一:ProactiveGuidanceCard 会剥 `guidance-dec-` 前缀,这里两边都双剥,保证 key 对得上。 */
export function normKey(id: string): string {
  return id.replace(/^guidance-dec-/, '').replace(/^guidance-/, '');
}

// 注册到反馈总线(learner 底座 pilot):一次 emitFeedback 直达这里,替代 useTodayData 手工直调
// applyGuidanceFeedback。cardId 反馈才作用于 ranker;更新律不变。
registerLearner((e: FeedbackEvent) => {
  if (e.cardId) applyGuidanceFeedback(e.cardId, e.verdict);
});

/** 供调试/透明展示:学了多少、当前权重(相对先验偏移多少)。 */
export function getRankerStats(): { n: number; weights: Record<string, number>; bias: number } {
  const s = load();
  const weights: Record<string, number> = {};
  FEATURE_KEYS.forEach((k, i) => { weights[k] = Math.round(s.w[i] * 1000) / 1000; });
  return { n: s.n, weights, bias: Math.round(s.b * 1000) / 1000 };
}
