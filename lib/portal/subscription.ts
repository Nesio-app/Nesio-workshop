/**
 * 订阅产品配置 —— 单一真源(批次215,#40 定价落地)。
 *
 * 定价方向(用户定案):**月费 9.9 · 21 天免费试用**。
 * - 试用天数复用 entitlement.TRIAL_DAYS(=21),别两处各写一个数漂移。
 * - 展示价是**兜底文案**;真实扣费价由 App Store Connect 按区域本地化设定,原生端应尽量在运行时
 *   读 StoreKit 的 localizedPrice 覆盖它(不同区自动换算 ¥/$/€)。
 * - productId 要和 App Store Connect 里建的自动续订订阅一致;21 天试用用该产品的「免费试用」引导优惠。
 */
import { TRIAL_DAYS } from './entitlement';

export interface SubscriptionProduct {
  /** App Store Connect 自动续订订阅的 Product ID(原生购买/校验都用它)。 */
  productId: string;
  billingPeriod: 'monthly';
  /** 展示兜底价([zh, en]);真实价以 StoreKit localizedPrice / App Store Connect 为准。 */
  priceDisplay: [string, string];
  /** 免费试用天数(复用 entitlement 的唯一真源)。 */
  trialDays: number;
}

export const PRO_MONTHLY: SubscriptionProduct = {
  productId: 'nesio_pro_monthly',
  billingPeriod: 'monthly',
  priceDisplay: ['¥9.9/月', '$9.99/mo'],
  trialDays: TRIAL_DAYS,
};

/** 定价一句话([zh, en]):试用 + 月费,给 paywall/引导复用。 */
export function pricingLine(): [string, string] {
  return [
    `${PRO_MONTHLY.trialDays} 天免费试用,之后 ${PRO_MONTHLY.priceDisplay[0]}`,
    `${PRO_MONTHLY.trialDays}-day free trial, then ${PRO_MONTHLY.priceDisplay[1]}`,
  ];
}
