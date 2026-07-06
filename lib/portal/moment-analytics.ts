/**
 * Moment Capture — 信号分析算法库（P0，零依赖）
 *
 * 算法来源（见 lib/portal/moment-capture.md §三）：
 * - EWMA α=0.15: 工业界 wellbeing 系统标准
 * - 个人基线比较: Kinnunen et al. 2020, Oura Ring
 * - CUSUM: Page (1954)，现用于 biosignal 监测
 * - Russell 坐标: Russell 1980 + Posner 2005
 * - Barnes 下午规则: Barnes et al. 2012
 */

import { LifeNode } from './life-graph';

// ── Russell 2D 情绪坐标（效价 × 唤醒度）────────────────────────────────────────
export const EMOTION_COORDS: Record<string, [number, number]> = {
  joy:         [ 0.9,  0.4],
  excited:     [ 0.8,  0.9],
  moved:       [ 0.6,  0.5],
  calm:        [ 0.4, -0.6],
  content:     [ 0.7, -0.3],
  grateful:    [ 0.6, -0.2],
  tired:       [-0.6, -0.8],
  empty:       [-0.8, -0.5],
  sad:         [-0.7, -0.4],
  anxious:     [-0.5,  0.8],
  frustrated:  [-0.6,  0.6],
  angry:       [-0.7,  0.8],
};

export function emotionDistance(a: string, b: string): number {
  const [v1, a1] = EMOTION_COORDS[a] ?? [0, 0];
  const [v2, a2] = EMOTION_COORDS[b] ?? [0, 0];
  return Math.sqrt((v1 - v2) ** 2 + (a1 - a2) ** 2);
}

export function emotionValence(id: string): number {
  return EMOTION_COORDS[id]?.[0] ?? 0;
}

// ── EWMA 精力基线（α=0.15）───────────────────────────────────────────────────
// 约需 20 次更新达稳态，适合每天 1-3 次自报频率
const EWMA_ALPHA = 0.15;

export interface EnergyBaseline {
  mean: number;       // EWMA 均值（初始 50）
  variance: number;   // 指数加权方差
  sampleCount: number;
}

export function defaultEnergyBaseline(): EnergyBaseline {
  return { mean: 50, variance: 100, sampleCount: 0 };
}

export function updateEnergyBaseline(prev: EnergyBaseline, newVal: number): EnergyBaseline {
  const newMean = EWMA_ALPHA * newVal + (1 - EWMA_ALPHA) * prev.mean;
  const diff = newVal - prev.mean;
  const newVariance = (1 - EWMA_ALPHA) * (prev.variance + EWMA_ALPHA * diff * diff);
  return { mean: newMean, variance: newVariance, sampleCount: prev.sampleCount + 1 };
}

export function energyStd(b: EnergyBaseline): number {
  return Math.sqrt(Math.max(b.variance, 4)); // 最小标准差 2，防止除零
}

/**
 * 🟠#6 反解 EWMA:去掉最近一次折入的样本后的均值。
 * 「当前读数 vs 基线」时,基线不能含当前读数本身(否则 α=0.15 把均值拉向最新值,delta
 * 被系统性缩小、偏向 'normal')。latestVal 必须是最后一次 updateEnergyBaseline 折入的值。
 */
export function meanExcludingLatest(b: EnergyBaseline, latestVal: number): number {
  if (b.sampleCount <= 1) return b.mean;
  return (b.mean - EWMA_ALPHA * latestVal) / (1 - EWMA_ALPHA);
}

// ── 两样本显著性:Welch t 检验(方差不等)────────────────────────────────────
// 判"布尔干预 on 组 vs off 组"的均值差异是否真实(取代粗略的效应量阈值)。

/** t 分布 α=0.05 双尾临界值近似(判显著性够用)。 */
function tCritical95(df: number): number {
  const table: Array<[number, number]> = [
    [1, 12.71], [2, 4.30], [3, 3.18], [4, 2.78], [5, 2.57], [6, 2.45], [8, 2.31],
    [10, 2.23], [15, 2.13], [20, 2.09], [30, 2.04], [50, 2.01], [100, 1.984],
  ];
  if (df <= 1) return 12.71;
  if (df >= 100) return 1.984;
  for (let i = 1; i < table.length; i++) {
    const [d1, t1] = table[i - 1];
    const [d2, t2] = table[i];
    if (df <= d2) return t1 + (t2 - t1) * (df - d1) / (d2 - d1);
  }
  return 1.984;
}

/** Welch 两样本 t 检验:返回 t、Welch–Satterthwaite 自由度、是否 α=0.05 双尾显著。 */
export function welchTTest(a: number[], b: number[]): { t: number; df: number; significant: boolean } {
  if (a.length < 2 || b.length < 2) return { t: 0, df: 0, significant: false };
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const varc = (x: number[], m: number) => x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1);
  const m1 = mean(a), m2 = mean(b);
  const v1 = varc(a, m1), v2 = varc(b, m2);
  const se = Math.sqrt(v1 / a.length + v2 / b.length);
  if (se === 0) return { t: 0, df: 0, significant: false };
  const t = (m1 - m2) / se;
  const df = (v1 / a.length + v2 / b.length) ** 2 /
    ((v1 / a.length) ** 2 / (a.length - 1) + (v2 / b.length) ** 2 / (b.length - 1));
  return { t, df, significant: Math.abs(t) >= tCritical95(df) };
}

/**
 * Oura 式疲劳评分：偏离个人基线的标准差数
 * > 1.5 → 轻度疲劳预警
 * > 2.5 → 中度疲劳（触发 GuidanceCard）
 */
export function fatigueScore(currentEWMA: number, baseline: EnergyBaseline): number {
  return (baseline.mean - currentEWMA) / energyStd(baseline);
}

// ── CUSUM 情绪突变检测（Page 1954）───────────────────────────────────────────
// 检测持续负向情绪趋势（区别于随机波动）
const CUSUM_THRESHOLD = 4;
const CUSUM_SLACK = 0.5;

export interface CusumState {
  sum: number;
  lastAlert: string | null; // ISO date，每天最多触发一次
}

export function defaultCusumState(): CusumState {
  return { sum: 0, lastAlert: null };
}

export function cusumUpdate(
  state: CusumState,
  emotionId: string,
  today = new Date().toISOString().slice(0, 10),
): { state: CusumState; alert: boolean } {
  const valence = emotionValence(emotionId);
  const newSum = Math.max(0, state.sum + (0 - valence) - CUSUM_SLACK);
  const alert = newSum > CUSUM_THRESHOLD && state.lastAlert !== today;
  return {
    state: { sum: alert ? 0 : newSum, lastAlert: alert ? today : state.lastAlert },
    alert,
  };
}

// ── 情绪跳变检测（Russell 2D 欧氏距离）──────────────────────────────────────
// 距离 > 1.5 = 大幅情绪跳变，标记为 notable event
export const MOOD_JUMP_THRESHOLD = 1.5;

export function isMoodJump(prevEmotion: string, currEmotion: string): boolean {
  return emotionDistance(prevEmotion, currEmotion) > MOOD_JUMP_THRESHOLD;
}

// ── Barnes 下午决策窗口（Barnes et al. 2012）─────────────────────────────────
// 睡眠剥夺后决策质量在 14:00-16:00 最差，建议避免重大决策
export function isAfternoonSlump(now = new Date()): boolean {
  const h = now.getHours(), d = now.getDay();
  return h >= 14 && h < 16 && d >= 1 && d <= 5;
}

// ── 最近 N 条 Moment 节点提取 ─────────────────────────────────────────────────
export function getRecentMoments(nodes: LifeNode[], n = 30): LifeNode[] {
  return nodes
    .filter((nd) => nd.tags?.includes('moment') && nd.tags?.includes('feeling'))
    .sort((a, b) => {
      const at = (a.attributes?.recordedAt as string) ?? a.createdAt ?? '';
      const bt = (b.attributes?.recordedAt as string) ?? b.createdAt ?? '';
      return bt.localeCompare(at);
    })
    .slice(0, n);
}

/**
 * 生成 Living Model API 用的情绪摘要（压缩，控制 token 数）
 * 格式: [{e:'joy', v:72, h:14, d:3}, ...]
 */
export function buildMomentSummary(
  moments: LifeNode[],
): Array<{ e: string; v: number; h: number; d: number }> {
  return moments
    // 只保留至少标了情绪或精力的 moment —— 纯文字、没标情绪/精力的不该被当成"中性/精力50"
    // 的真实样本,否则会拉平情绪趋势、稀释疲劳信号。
    .filter((nd) => nd.attributes?.emotion !== undefined || nd.attributes?.energyValue !== undefined)
    .map((nd) => {
      // 时段/星期缺失时从真实时间戳推,而不是魔法值 12点/周日。
      const created = new Date(nd.createdAt);
      const validTs = !Number.isNaN(created.getTime());
      return {
        e: (nd.attributes?.emotion as string) ?? 'unknown',
        v: typeof nd.attributes?.energyValue === 'number' ? nd.attributes.energyValue : 50,
        h: typeof nd.attributes?.hourOfDay === 'number' ? nd.attributes.hourOfDay : (validTs ? created.getHours() : 12),
        d: typeof nd.attributes?.dayOfWeek === 'number' ? nd.attributes.dayOfWeek : (validTs ? created.getDay() : 0),
      };
    });
}
