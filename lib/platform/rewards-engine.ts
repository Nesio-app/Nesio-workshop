/**
 * rewards-engine — 积分 + 奖品仓库(批次 42)。
 *
 * 把「冷冻仓(冲动购物防护)」和「奖品仓库(愿望清单)」用一套积分经济串起来:
 *   - 冷冻仓里一个东西,冷静后决定「不买了」→ 攒下自律积分 + 这件东西落进奖品仓库当愿望
 *   - 积分主要靠「做成事」赚:健身完成目标、项目做得好、呼吸练习…(成就 → 积分)
 *   - 攒够积分 → 到奖品仓库把当初忍住没买的东西「兑换」出来,奖励自己
 *
 * 复用来源:
 *   - storage-ios「大后方」积分系统(igDecline +price PTS / redeemReward / breath +20)
 *   - adhd-flow-ios 褒奖兑换(reward shop:pts 成本 + redeemed + streak combo)
 *
 * 存 localStorage `nesio-rewards-v1`,不调 AI。
 *
 * ⚠️ 别信下面这句的旧版本:它原来写着「不上传」——**那是过时的**。
 * 这个 key 是 durable、非 dedicated,早就走通用 cloud-module-sync 上云了
 * (见 scripts/sync-ownership.test.mjs:「普通 durable 数据 → 默认走通用同步」)。
 * 2026-08-01 用户以为愿望清单还在本机,正是被这句注释误导的。
 * 通用同步是「加功能零同步代码」的默认路 —— 新模块什么都不写就已经在同步了。
 */

import { reportStorageDropped } from '@/lib/portal/storage-health';

export type PointsSource = 'freeze_decline' | 'fitness' | 'project' | 'breath' | 'healing' | 'manual' | 'redeem' | 'chore';

export interface PointsEntry {
  id: string;
  ts: string;       // ISO
  delta: number;    // + 赚 / - 花
  label: string;    // 已本地化的一句说明(存时就定好语言)
  source: PointsSource;
  /**
   * 这一笔是**哪一件事**挣的(2026-08-01,家务接进积分)。
   * 用来去重:同一条家务反复刷新/两个页面各点一次,不能给两次分。
   * 只有需要幂等的来源才填 —— 训练打卡那类每次都是新的一次,不需要。
   */
  sourceId?: string;
}

export interface RewardItem {
  id: string;
  title: string;
  cost: number;             // 兑换所需积分
  price?: string;           // 原价字符串(展示)
  image?: string;
  store?: string;
  url?: string;
  origin: 'freeze' | 'manual';
  addedAt: string;          // ISO
  redeemedAt?: string;      // ISO,已兑换
}

export interface RewardsState {
  points: number;
  ledger: PointsEntry[];    // 最近在前,capped
  rewards: RewardItem[];
}

// ── 可调经济参数(集中在此,调平衡改这里)──
/** 忍住一次冲动购买给的自律奖励(固定,不给全价——否则能自己买单)。 */
export const DISCIPLINE_BONUS = 10;
/** 完成一次训练打卡。 */
export const POINTS_PER_FITNESS_SESSION = 20;
/** 完成一个项目/任务(手动记)。 */
export const POINTS_PER_PROJECT = 50;
/** 一次呼吸/冷静练习。 */
export const POINTS_PER_BREATH = 15;

export const POINTS_PER_HEALING = 15;   // 深度疗愈(阴影整合 / 接地)完成一次
/** 忍住购买时,愿望在仓库里的兑换成本 = 原价 × 此系数(默认 1:1,1 积分≈1 元)。 */
const WISH_COST_RATIO = 1;
/** 解析不出价格时,愿望的兜底成本。 */
const DEFAULT_WISH_COST = 100;
const LEDGER_CAP = 200;

const STORE_KEY = 'nesio-rewards-v1';
const EVENT = 'nesio-rewards-updated';

function empty(): RewardsState {
  return { points: 0, ledger: [], rewards: [] };
}

export function loadRewards(): RewardsState {
  if (typeof window === 'undefined') return empty();
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as RewardsState | null;
    if (raw && typeof raw === 'object' && typeof raw.points === 'number' && Array.isArray(raw.ledger) && Array.isArray(raw.rewards)) {
      return raw;
    }
  } catch { /* ignore */ }
  return empty();
}

function save(state: RewardsState): RewardsState {
  if (typeof window === 'undefined') return state;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { reportStorageDropped(); }
  window.dispatchEvent(new CustomEvent(EVENT));
  return state;
}

export function getPoints(): number {
  return loadRewards().points;
}

/** 从价格串里抠出数字:支持 "$1,299.00" / "¥399" / "US $50" / "50" / "2 for $50"。
 *  优先取货币符号后的数字 —— 否则 "2 for $50" 会被抠成数量 2 而非价格 50。
 *  没有货币符号时取串里最大的数字(数量词通常小于价格)。 */
export function parsePriceNumber(price?: string): number {
  if (!price) return 0;
  const s = price.replace(/,/g, '');
  const cur = s.match(/[$¥€£]\s*(\d+(?:\.\d+)?)/);
  if (cur) return Math.round(parseFloat(cur[1]));
  const nums = s.match(/\d+(?:\.\d+)?/g);
  return nums ? Math.round(Math.max(...nums.map(parseFloat))) : 0;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 记一笔积分变动(delta 正为赚、负为花)。
 *
 * `sourceId` 给的话就**幂等**:同一个 (source, sourceId) 已经记过就原样返回,
 * 不再加第二次。家务这条路上必须有它 —— 同一件家务在今天页和家庭板上
 * 各有一个「完成」按钮,而刷新之后 board 还会把它带回来。
 * 没有 sourceId 的来源(训练打卡、呼吸练习)每次都是新的一次,照旧累加。
 */
export function earnPoints(delta: number, source: PointsSource, label: string, sourceId?: string): RewardsState {
  const s = loadRewards();
  if (sourceId && s.ledger.some((e) => e.source === source && e.sourceId === sourceId)) {
    return s;   // 这一件已经给过分了
  }
  s.points = Math.max(0, s.points + delta);
  s.ledger.unshift({
    id: newId('pe'), ts: new Date().toISOString(), delta, label, source,
    ...(sourceId ? { sourceId } : {}),
  });
  s.ledger = s.ledger.slice(0, LEDGER_CAP);
  return save(s);
}

/**
 * 一件家务挣多少积分(2026-08-01 用户:「这两个合并,家务也挣积分」)。
 *
 * 家务本身带的是**金额**(ChoreInstance.value,家庭板按钱记账)。
 * 1 元 = 1 积分 —— 和愿望的定价口径一致(WISH_COST_RATIO 那句「1 积分 ≈ 1 元」),
 * 所以「做够这些家务就能换那个东西」在心里是直接对得上的。
 *
 * 金额是 0 的家务(不带钱、纯分工的那种)仍然给一份底分 ——
 * 做完一件事却什么都没发生,下次就不会有人点那个「完成」了。
 */
export const POINTS_PER_UNPAID_CHORE = 5;

export function chorePointValue(value: number): number {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return POINTS_PER_UNPAID_CHORE;
  return Math.max(1, Math.round(v));
}

/**
 * 家务完成 → 记积分。**幂等**(同一条 instance 只给一次)。
 *
 * 什么时候算「挣到」:
 *   · 要审核的 → 批准之后(state 'approved'/'paid')。做完还没批就给分,
 *     等于绕开了审核这件事本身;
 *   · 不要审核的 → 点完成就给(state 'done' 起)。
 * 判据放在这儿一处 —— 两个调用点(今天页的家务条、家庭板)各写一份必然漂移。
 */
export function earnChorePoints(
  chore: { id: string; title?: string; value: number; state: string; needsApproval?: boolean },
  locale: 'zh' | 'en' = 'zh',
): RewardsState | null {
  const st = String(chore.state || '');
  const settled = chore.needsApproval
    ? (st === 'approved' || st === 'paid')
    : (st === 'done' || st === 'approved' || st === 'paid');
  if (!settled) return null;
  const pts = chorePointValue(chore.value);
  const name = (chore.title || '').trim() || (locale === 'en' ? 'a chore' : '一件家务');
  const label = locale === 'en' ? `Chore done: ${name}` : `家务完成:${name}`;
  return earnPoints(pts, 'chore', label, chore.id);
}

/** 忍住没买的东西 → 落进奖品仓库当愿望(成本 = 原价)。返回新愿望;重复 url 不重复加。 */
export function addWishFromFreeze(item: { title: string; price?: string; image?: string; store?: string; url?: string }): RewardItem | null {
  const s = loadRewards();
  if (item.url && s.rewards.some((r) => r.origin === 'freeze' && r.url === item.url && !r.redeemedAt)) {
    return null; // 已在仓库,别重复
  }
  const num = parsePriceNumber(item.price);
  const cost = num > 0 ? Math.round(num * WISH_COST_RATIO) : DEFAULT_WISH_COST;
  const reward: RewardItem = {
    id: newId('rw'), title: item.title, cost, price: item.price,
    image: item.image, store: item.store, url: item.url,
    origin: 'freeze', addedAt: new Date().toISOString(),
  };
  s.rewards.unshift(reward);
  save(s);
  return reward;
}

/** 手动加一个愿望/奖励。 */
export function addManualReward(input: { title: string; cost: number; price?: string; image?: string; store?: string; url?: string }): RewardItem {
  const s = loadRewards();
  const reward: RewardItem = {
    id: newId('rw'), title: input.title.trim(), cost: Math.max(1, Math.round(input.cost)),
    price: input.price, image: input.image, store: input.store, url: input.url,
    origin: 'manual', addedAt: new Date().toISOString(),
  };
  s.rewards.unshift(reward);
  save(s);
  return reward;
}

export function removeReward(id: string): RewardsState {
  const s = loadRewards();
  s.rewards = s.rewards.filter((r) => r.id !== id);
  return save(s);
}

export type RedeemResult = { ok: true; state: RewardsState } | { ok: false; reason: 'insufficient' | 'not_found' | 'already' };

/** 兑换奖励:积分够就扣分 + 标记已兑换。 */
export function redeemReward(id: string, label: string): RedeemResult {
  const s = loadRewards();
  const r = s.rewards.find((x) => x.id === id);
  if (!r) return { ok: false, reason: 'not_found' };
  if (r.redeemedAt) return { ok: false, reason: 'already' };
  if (s.points < r.cost) return { ok: false, reason: 'insufficient' };
  s.points -= r.cost;
  r.redeemedAt = new Date().toISOString();
  s.ledger.unshift({ id: newId('pe'), ts: r.redeemedAt, delta: -r.cost, label, source: 'redeem' });
  s.ledger = s.ledger.slice(0, LEDGER_CAP);
  return { ok: true, state: save(s) };
}

/** 待兑换(未兑换)的愿望。 */
export function pendingRewards(s = loadRewards()): RewardItem[] {
  return s.rewards.filter((r) => !r.redeemedAt);
}

/** 已兑换的奖励。 */
export function redeemedRewards(s = loadRewards()): RewardItem[] {
  return s.rewards.filter((r) => r.redeemedAt);
}
