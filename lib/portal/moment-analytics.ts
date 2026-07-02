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
  return moments.map((nd) => ({
    e: (nd.attributes?.emotion as string) ?? 'unknown',
    v: (nd.attributes?.energyValue as number) ?? 50,
    h: (nd.attributes?.hourOfDay as number) ?? 12,
    d: (nd.attributes?.dayOfWeek as number) ?? 0,
  }));
}
