/**
 * 投资页为什么是空的(2026-08-01,用户实测截图:这一页一片白,
 * 底下只孤零零一句「价格是上次同步的快照」)。
 *
 * 「一片白 + 一句免责声明」是这一屏最糟的一种状态:它既没说**为什么空**,
 * 也没说**下一步做什么**,用户唯一能得出的结论是「这个功能坏了」。
 *
 * 而空的原因有三种,三个完全不同的下一步:
 *   · no-account  —— 压根没连投资账户 → 去连一个券商
 *   · no-holdings —— 连了,但这次没取到持仓 → 去同步一次
 *   · none        —— 有持仓,不是空态
 *
 * 中间那一种是这里最要小心的:「没同步到」和「这个账户里真的没有持仓」
 * 我们**分不出来**。分不出来就如实说分不出来,不替券商断言 ——
 * 一句「你的账户是空的」在它其实只是没同步时,是在替别人说一件错话。
 */

export type InvestEmptyReason = 'no-account' | 'no-holdings' | 'none';

export interface InvestEmptyInput {
  /** 持仓条数。 */
  holdingCount: number;
  /** 被判成「投资账户」的账户数。 */
  investAccountCount: number;
}

export function investEmptyReason(input: InvestEmptyInput): InvestEmptyReason {
  const holdings = Math.max(0, Math.trunc(Number(input.holdingCount) || 0));
  const accounts = Math.max(0, Math.trunc(Number(input.investAccountCount) || 0));
  if (holdings > 0) return 'none';
  return accounts === 0 ? 'no-account' : 'no-holdings';
}
