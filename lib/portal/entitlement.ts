/**
 * 付费层 & 成本护栏(App Store v1)。免费 vs Pro 的唯一判定点。
 *
 * 成本经济学红线:**免费用户绝不触发付费云 LLM** —— 否则免费用户直接烧钱、毛利垮。
 * 所以 Pro 能力(拍照 AI / 问问 AI / AI routine / 邮件回复 / 冷冻仓)的调用方在发起前
 * 用 canUse() 判:免费 → 走确定性/端上兜底 + 升级引导,不发付费云。
 *
 * 权益来源:v1 是 StoreKit 收据 → **服务端校验** → 写这个本地标志(防篡改由服务端保证)。
 * 现在是桩:localStorage `nesio-pro-entitlement-v1 === '1'` = Pro,缺省 free。真支付接上后
 * 由校验流程写它。开发/内部可手动置 1 测 Pro。
 */

import { logDropped } from './storage-health';
import { isAppStoreBuild } from './app-build.mjs';

export type Tier = 'free' | 'pro';

/**
 * 分层是否已启用。**关键**:现在的 web PWA 还没付费系统,所有人都是 free —— 若立刻按
 * free/pro 门控会把当前所有用户的 AI 砍掉(线上回归)。所以门控**默认不生效**,只在
 * 分层真正上线时开:App Store v1 构建强制分层;将来 PWA 计费上线可加显式旗。
 * 未启用时 canUse/canUsePaidCloudAi 一律放行 → 当前 PWA 体验不变。
 */
export function isTieringActive(): boolean {
  return isAppStoreBuild();
}

/** Pro 专属能力 id(免费用确定性/端上兜底,不打付费云)。 */
export const PRO_FEATURES = Object.freeze([
  'photo_ai',    // 拍照:云视觉深理解(免费=端上标签/OCR)
  'ask_ai',      // 问一问:对话式 RAG 问答(免费=语义搜索)
  'ai_routine',  // AI 日程/例程
  'email_reply', // 邮件问问直接回复
  'freeze',      // 冷冻仓
] as const);
export type ProFeature = typeof PRO_FEATURES[number];

const PRO_KEY = 'nesio-pro-entitlement-v1';
export const TIER_UPDATED_EVENT = 'nesio-tier-updated';

export function getTier(): Tier {
  if (typeof window === 'undefined') return 'free';
  try { return localStorage.getItem(PRO_KEY) === '1' ? 'pro' : 'free'; } catch { return 'free'; }
}

export function isPro(): boolean {
  return getTier() === 'pro';
}

/** 该能力当前可用吗:分层未启用 → 全放行(当前 PWA 不变);启用后 Pro 能力仅 Pro 层。 */
export function canUse(feature: string): boolean {
  if (!isTieringActive()) return true;
  if (!(PRO_FEATURES as readonly string[]).includes(feature)) return true;
  return isPro();
}

/** 免费层能不能打付费云 AI —— 成本护栏总闸。分层未启用 → true;启用后 免费 false → 走兜底。 */
export function canUsePaidCloudAi(): boolean {
  if (!isTieringActive()) return true;
  return isPro();
}

/** 由 StoreKit 收据服务端校验后调用,设/清 Pro 权益。别在客户端凭空置(防篡改靠服务端)。 */
export function setProEntitlement(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) localStorage.setItem(PRO_KEY, '1'); else localStorage.removeItem(PRO_KEY);
    window.dispatchEvent(new CustomEvent(TIER_UPDATED_EVENT));
  } catch (err) { logDropped('entitlement.set', err); }
}
