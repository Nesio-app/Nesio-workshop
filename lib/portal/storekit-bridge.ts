/**
 * StoreKit 桥 —— iOS 内购与 JS 权益之间的契约(批次215,#40)。
 *
 * 权益授予链(entitlement.ts 头注的架构):
 *   原生 StoreKit 购买/恢复成功 → 拿交易/收据 → 服务端校验(/api/portal/iap/verify,Apple 凭据接上后生效)
 *   → applyVerifiedPurchase(true) 写本地 Pro 标志 → 现有 canUsePaidCloudAi()/getTier() 门自动放行。
 *
 * 本文件只做 **JS 侧契约 + 授予逻辑**(可测)。**原生 remainder(用户/后续)**:
 *   ① Capacitor StoreKit 插件实现 NativeStoreKit 接口(purchase/restore,返回交易);
 *   ② App Store Connect 建自动续订订阅 PRO_MONTHLY.productId(¥9.9/$9.99 月付 + 21 天免费试用引导优惠);
 *   ③ /api/portal/iap/verify 用 App Store Server API 校验收据 → 写 user_entitlements(#38 的真源)。
 * 在 ① 接上前,web/无原生环境下 startSubscription 返回明确不可用原因,不假装能买。
 */
import { setProEntitlement, TIER_UPDATED_EVENT } from './entitlement';
import { PRO_MONTHLY } from './subscription';
import { logDropped } from './storage-health';

export interface PurchaseOutcome {
  ok: boolean;
  /** 不可用/失败原因(web_unavailable / cancelled / verify_failed / native_error)。 */
  reason?: string;
}

/** 原生插件应实现的最小接口(Capacitor StoreKit 插件挂在 window)。 */
export interface NativeStoreKit {
  purchase(productId: string): Promise<{ verified: boolean }>;
  restore(): Promise<{ verified: boolean }>;
}

/** 取原生 StoreKit 插件;无(web / 插件未装)→ null。 */
export function getNativeStoreKit(): NativeStoreKit | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { Capacitor?: { Plugins?: { StoreKit?: NativeStoreKit } } };
  return w.Capacitor?.Plugins?.StoreKit ?? null;
}

/**
 * 授予/收回 Pro —— 校验通过后由原生成功回调 / verify 路由触发(纯逻辑,可测)。
 * 写本地 Pro 标志(setProEntitlement 内部已派发 TIER_UPDATED_EVENT;这里不重复派发)。
 */
export function applyVerifiedPurchase(active: boolean): void {
  setProEntitlement(active);
}

/** 发起订阅购买。原生在场 → 走 StoreKit;否则返回明确不可用原因(不假装)。 */
export async function startSubscription(): Promise<PurchaseOutcome> {
  const sk = getNativeStoreKit();
  if (!sk) return { ok: false, reason: 'web_unavailable' };
  try {
    const r = await sk.purchase(PRO_MONTHLY.productId);
    if (r?.verified) { applyVerifiedPurchase(true); return { ok: true }; }
    return { ok: false, reason: 'verify_failed' };
  } catch (err) {
    logDropped('iap.purchase', err);
    return { ok: false, reason: 'native_error' };
  }
}

/** 恢复购买(换机/重装)。原生在场 → StoreKit restore;否则不可用。 */
export async function restoreSubscription(): Promise<PurchaseOutcome> {
  const sk = getNativeStoreKit();
  if (!sk) return { ok: false, reason: 'web_unavailable' };
  try {
    const r = await sk.restore();
    applyVerifiedPurchase(Boolean(r?.verified));
    return r?.verified ? { ok: true } : { ok: false, reason: 'verify_failed' };
  } catch (err) {
    logDropped('iap.restore', err);
    return { ok: false, reason: 'native_error' };
  }
}

export { TIER_UPDATED_EVENT };
