/**
 * 跨区偏好层接线(cross-region-reasoning.md §2.3 P3)——把跨区候选特征化,用 LinUCB
 * 排序(学「你在乎哪类跨区」),反馈闭环更新。纯 LinUCB 数学在 bandit-core.mjs。
 *
 * 时序:投递时 rank 顺带 recordShown 存该关系的特征向量;卡片反馈到达时按关系 id
 * 取回特征做一次 bandit 更新(useful/done→reward 1,dismiss/wrong/too_much→0;
 * snooze/未反馈=不更新)。状态(A,b)+ 待反馈特征都落 IDB blob。
 */

import { createBlobStore } from '@/lib/portal/idb-blob-store';
import { reportStorageDropped } from '@/lib/portal/storage-health';
import { getMirrorProfile } from '@/lib/portal/mirror-profile';
import { onFeedback } from '@/lib/platform/personalization';
import { createBanditState, banditUpdate, rankByBandit, BANDIT_DEFAULTS } from './bandit-core.mjs';

// 特征顺序(d=15):bias · 三类型 one-hot · strength · confidence · hourFit · 8 域标志
const DOMAINS = ['location', 'finance', 'mood', 'fitness', 'feedback', 'health', 'weather', 'calendar'];
const D = 1 + 3 + 1 + 1 + 1 + DOMAINS.length;

// 冷启动先验:强度主导 + 置信/时段轻权 + 先后线索稍加 → 第一天≈按强度排(不更差)
function priorTheta(): number[] {
  const t = new Array(D).fill(0);
  t[4] = 1.0;   // strength
  t[5] = 0.4;   // confidence
  t[6] = 0.3;   // hourFit
  t[3] = 0.1;   // type_leadlag(先后线索新颖,轻微加成)
  return t;
}

interface Rel { id: string; kind: string; strength: number; pValue: number; domainA: string; domainB: string }
interface BanditState { d: number; lambda: number; A: number[][]; b: number[] }

function featureVector(r: Rel, hourFit: number): number[] {
  const x = new Array(D).fill(0);
  x[0] = 1; // bias
  x[1] = r.kind === 'corr' ? 1 : 0;
  x[2] = r.kind === 'cooccur' ? 1 : 0;
  x[3] = r.kind === 'leadlag' ? 1 : 0;
  x[4] = Math.min(1, Math.abs(r.strength));
  x[5] = Math.max(0, 1 - (typeof r.pValue === 'number' ? r.pValue : 0.05) * 10); // p→confidence
  x[6] = hourFit;
  for (const d of [r.domainA, r.domainB]) {
    const idx = DOMAINS.indexOf(d);
    if (idx >= 0) x[7 + idx] = 1;
  }
  return x;
}

const stateBlob = createBlobStore<BanditState>({
  key: 'nesio-cross-region-bandit-v1',
  updateEvent: 'nesio-cross-region-bandit-v1-updated',
  validate: (v) => Boolean(v && typeof v === 'object' && Array.isArray((v as BanditState).A)),
  onWriteError: reportStorageDropped,
});
const shownBlob = createBlobStore<Record<string, number[]>>({
  key: 'nesio-cross-region-bandit-shown-v1',
  updateEvent: 'nesio-cross-region-bandit-shown-v1-updated',
  validate: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  onWriteError: reportStorageDropped,
});

function loadState(): BanditState {
  const v = stateBlob.load();
  if (v && Array.isArray(v.A) && v.A.length === D) return v;
  return createBanditState(priorTheta(), { lambda: BANDIT_DEFAULTS.lambda }) as BanditState;
}

/** 供 deliver.ts 当 rankFn:按 LinUCB UCB 分排序,并存下每条的特征(待反馈)。 */
export function rankCrossRegionByBandit(rels: Rel[], now: Date = new Date()): Rel[] {
  const hourFit = getMirrorProfile().hourEngagement[now.getHours()] ?? 0.5;
  const state = loadState();
  const cands = rels.map((r) => ({ r, x: featureVector(r, hourFit) }));
  const ranked = rankByBandit(cands, state, { alpha: BANDIT_DEFAULTS.alpha }) as Array<{ r: Rel; x: number[] }>;
  // 存下将投递项的特征(封顶后由 deliver 决定;这里全存,反馈到才用)
  const shown = shownBlob.load() || {};
  for (const c of ranked) shown[c.r.id] = c.x;
  shownBlob.save(shown);
  return ranked.map((c) => c.r);
}

const ACCEPT = new Set(['useful', 'done']);
const REJECT = new Set(['dismiss', 'wrong', 'too_much']);

/** 反馈闭环:cross_region 卡的反馈 → 取回特征做一次 bandit 更新。 */
export function applyCrossRegionBanditFeedback(cardId: string, reaction: string): boolean {
  if (!cardId.startsWith('cross_region-')) return false;
  const relId = cardId.slice('cross_region-'.length);
  const shown = shownBlob.load() || {};
  const x = shown[relId];
  if (!x) return false;
  let reward: number;
  if (ACCEPT.has(reaction)) reward = 1;
  else if (REJECT.has(reaction)) reward = 0;
  else return false; // snooze / 未知 → 不更新
  const next = banditUpdate(x, reward, loadState());
  stateBlob.save(next as BanditState);
  delete shown[relId];
  shownBlob.save(shown);
  return true;
}

// 2026-07-27 激进审计:停用 bandit 反馈更新路径(detection/冷启动排序可留)。
// 不再订反馈总线 —— 避免「学了 N 次」伪智能;投递仍可用冷启动 θ₀≈按强度排。
const BANDIT_LEARNING_ENABLED = false;

const BANDIT_RETIRED_PURGE_KEY = 'nesio-cross-region-bandit-retired-purge-v1';
/** 学习退役后重置 LinUCB 状态,旧 θ 不再影响跨区排序。 */
function purgeRetiredBanditStateIfNeeded(): void {
  if (BANDIT_LEARNING_ENABLED || typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(BANDIT_RETIRED_PURGE_KEY)) return;
    stateBlob.save(createBanditState(priorTheta(), { lambda: BANDIT_DEFAULTS.lambda }) as BanditState);
    shownBlob.save({});
    localStorage.setItem(BANDIT_RETIRED_PURGE_KEY, '1');
  } catch { /* best-effort */ }
}
purgeRetiredBanditStateIfNeeded();

if (BANDIT_LEARNING_ENABLED && typeof window !== 'undefined') {
  onFeedback((e) => {
    if (e.dimension === 'card' && e.key) applyCrossRegionBanditFeedback(e.key, e.reaction);
  });
}

/** 透明面板用:当前偏好权重(θ = A⁻¹b)近似 —— 直接读 b 的相对量级即可示意。 */
export function getCrossRegionBanditStats(): { updates: number; typeWeights: Record<string, number> } {
  const s = loadState();
  // b 相对先验的增量,示意各类型累计奖励倾向
  const base = priorTheta();
  const delta = (i: number) => (s.b[i] ?? 0) - base[i] * s.lambda;
  return {
    updates: Math.round(((s.A[0]?.[0] ?? s.lambda) - s.lambda)),
    typeWeights: { 相关: delta(1), 共现: delta(2), 先后: delta(3) },
  };
}
