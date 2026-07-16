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

/**
 * **整功能 Pro 专属**(免费点了 → 升级引导,不是能用)。
 * 注意 photo_ai / ask_ai **不在**这里:拍一下、问一问是**免费核心**(端上/确定性基础版),
 * 只有它们的**深度云版本**才 Pro —— 那层由 canUsePaidCloudAi() 在成本闸上分,不整功能锁。
 * 整功能锁的只有:冷冻仓、AI 例程、邮件直接回复、多面镜月度信(老友视角免费试读,在 UI 层放行)。
 */
export const PRO_ONLY_FEATURES = Object.freeze(['ai_routine', 'email_reply', 'freeze', 'mirror_letter'] as const);

const PRO_KEY = 'nesio-pro-entitlement-v1';
const TRIAL_START_KEY = 'nesio-trial-start-v1';
export const TIER_UPDATED_EVENT = 'nesio-tier-updated';

/**
 * 服务端权益快照缓存(账号级真源的本地镜像)。/api/entitlements 返回后写这里,getTier() 优先读它 ——
 * 使「清缓存/换设备/换浏览器就白嫖 Pro」失效(报告 #6:此前 Pro 门 100% 客户端 localStorage 置 1)。
 * 缓存仅是展示/快路径,真正的付费门在服务端 guardServerEntitlement;这里 enforced 为真且判到 free
 * 时前端也据实收权,不再被本地 PRO_KEY 蒙蔽。
 */
const SERVER_CACHE_KEY = 'nesio-server-entitlement-v1';

/** 服务端权益快照(镜像 /api/entitlements 的 server* 字段)。 */
interface ServerEntitlementCache {
  /** 'free' | 'pro' | 'unknown'(unknown=服务端未强制,回退本地判定) */
  tier: 'free' | 'pro' | 'unknown';
  /** 服务端是否已开启强制(总闸)。false → 完全回退本地。 */
  enforced: boolean;
  /** 服务端账号级试用剩余天数。 */
  trialDaysLeft: number;
}

function readServerEntitlementCache(): ServerEntitlementCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SERVER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ServerEntitlementCache>;
    const tier = parsed.tier === 'free' || parsed.tier === 'pro' ? parsed.tier : 'unknown';
    return {
      tier,
      enforced: parsed.enforced === true,
      trialDaysLeft: Number.isFinite(parsed.trialDaysLeft) ? Number(parsed.trialDaysLeft) : 0,
    };
  } catch {
    return null;
  }
}

/** 服务端权益快照(供 UI 反映「付费 Pro / 试用 / 免费」态);null=无缓存。 */
export function serverEntitlementSnapshot(): ServerEntitlementCache | null {
  return readServerEntitlementCache();
}

/** 是否账号级**付费** Pro(服务端已强制 + tier=pro + 非试用)—— 用于订阅页显「已是会员」。 */
export function hasPaidPro(): boolean {
  const s = readServerEntitlementCache();
  return Boolean(s?.enforced && s.tier === 'pro' && s.trialDaysLeft <= 0);
}

/**
 * 拉取服务端账号级权益并落缓存(登录后调用)。best-effort:任何失败都静默(保留旧缓存/回退本地),
 * 绝不因权益接口抖动锁死真用户。返回是否成功刷新。
 */
export async function refreshServerEntitlement(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const res = await fetch('/api/entitlements', { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      serverTier?: string;
      serverEntitlementEnforced?: boolean;
      serverTrialDaysLeft?: number;
    };
    const tier = data.serverTier === 'free' || data.serverTier === 'pro' ? data.serverTier : 'unknown';
    const cache: ServerEntitlementCache = {
      tier,
      enforced: data.serverEntitlementEnforced === true,
      trialDaysLeft: Number.isFinite(data.serverTrialDaysLeft) ? Number(data.serverTrialDaysLeft) : 0,
    };
    localStorage.setItem(SERVER_CACHE_KEY, JSON.stringify(cache));
    window.dispatchEvent(new CustomEvent(TIER_UPDATED_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** 免费试用期:21 天(3 周)—— 产品文案:刚好养成一个记录的好习惯。 */
export const TRIAL_DAYS = 21;

/** 首次调用时落试用起点(设备级;将来接账号后迁到服务端,防重装重置)。 */
function trialStartMs(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(TRIAL_START_KEY);
    if (raw) { const v = Number(raw); if (Number.isFinite(v) && v > 0) return v; }
    const now = Date.now();
    localStorage.setItem(TRIAL_START_KEY, String(now));
    return now;
  } catch { return 0; }
}

/** 试用剩余天数(0 = 已结束;分层未启用时仅用于展示)。 */
export function trialDaysLeft(): number {
  const start = trialStartMs();
  if (!start) return 0;
  const used = (Date.now() - start) / 86_400_000;
  return Math.max(0, Math.ceil(TRIAL_DAYS - used));
}

export function getTier(): Tier {
  if (typeof window === 'undefined') return 'free';
  try {
    // 服务端账号级真源优先:总闸开且明确判到 pro/free 时,以它为准 —— 清缓存/换设备不再白嫖 Pro,
    // 到期也不再被本地 PRO_KEY 蒙蔽(报告 #6)。unknown / 未强制 → 回退本地判定(下方)。
    const server = readServerEntitlementCache();
    if (server?.enforced && (server.tier === 'pro' || server.tier === 'free')) return server.tier;
    if (localStorage.getItem(PRO_KEY) === '1') return 'pro';
    // 试用期内按 Pro 对待(分层启用后生效;PWA 分层未启用本就全放行,无感)
    if (trialDaysLeft() > 0) return 'pro';
    return 'free';
  } catch { return 'free'; }
}

/** 本机 Pro 覆盖位(测试开关)本身的开关状态 —— 与 getTier 区分:
 *  试用期内 getTier 恒 'pro',用它初始化设置开关会出现「关不掉,自己跳回开」。 */
export function hasProOverride(): boolean {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(PRO_KEY) === '1'; } catch { return false; }
}

export function isPro(): boolean {
  return getTier() === 'pro';
}

/**
 * 该能力当前可用吗。**整功能 Pro 专属**(冷冻仓/AI例程/邮件回复)在 PWA + 原生**都强制** Pro
 * (免费 → 升级引导);其余(含免费核心 拍一下/问一问 基础版)一律放行。深度云能力的免费/Pro
 * 分层在 canUsePaidCloudAi() 上,不在这。
 */
export function canUse(feature: string): boolean {
  if ((PRO_ONLY_FEATURES as readonly string[]).includes(feature)) return isPro();
  return true;
}

/** 是不是整功能 Pro 专属(给 UI 判「要不要显示升级锁」)。 */
export function isProOnlyFeature(feature: string): boolean {
  return (PRO_ONLY_FEATURES as readonly string[]).includes(feature);
}

/**
 * 冷冻仓(freeze)上线开关(安全审计:freeze 此前「卖了但不存在」—— 门死、写入口零引用、
 * 新用户进不去,却列在会员页权益里)。现在把功能走闭环 + 统一 gate,但**先不上线**:
 * 未上线 → 免费和 Pro **都进不去**(点了走「会随 Pro 开放」引导);上线只需把这里改成读
 * 真开关(launch-surface / 远程配置)。改这一处即全站生效。
 */
export function isFreezeLaunched(): boolean {
  return false;
}

/** 冷冻仓当前是否可打开:未上线 → 免费/Pro 都不上;上线后 → Pro 专属(试用期内按 Pro)。 */
export function canOpenFreeze(): boolean {
  return isFreezeLaunched() && canUse('freeze');
}

/** 免费层能不能打付费云 AI —— 成本护栏总闸。分层未启用 → true;启用后 免费 false → 走兜底。 */
export function canUsePaidCloudAi(): boolean {
  if (!isTieringActive()) return true;
  return isPro();
}

/**
 * 付费云 AI 的**用户触发**入口统一闸(安全审计 #2):放行返回 true;拦截时派发升级引导事件
 * 并返回 false,调用方据此走兜底/收手。给此前「连名义门都没有」的九路云 AI 面补门 ——
 * 分层未启用(当前 Web)时 canUsePaidCloudAi 恒 true → 无行为变化;分层开启后免费即被拦,
 * 不再成为成本泄漏。**后台被动增强**(引导语/生活状态)别用它(无用户动作),直接判
 * canUsePaidCloudAi() 静默跳过即可。
 */
export function guardPaidCloudAi(feature: string): boolean {
  if (canUsePaidCloudAi()) return true;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature } }));
  }
  return false;
}

/** 由 StoreKit 收据服务端校验后调用,设/清 Pro 权益。别在客户端凭空置(防篡改靠服务端)。 */
export function setProEntitlement(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) localStorage.setItem(PRO_KEY, '1'); else localStorage.removeItem(PRO_KEY);
    window.dispatchEvent(new CustomEvent(TIER_UPDATED_EVENT));
  } catch (err) { logDropped('entitlement.set', err); }
}
