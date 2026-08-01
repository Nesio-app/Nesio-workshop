'use client';

/**
 * 把家庭板上那个「攒钱目标」搬成愿望清单里的一条(2026-08-01,用户:
 * 「乐高并入愿望清单」+「这两个合并,家务也挣积分」)。
 *
 * 在这之前奖励页顶上有一块独立卡片:目标名 + 金额 + 一条按**钱**走的进度条
 * (数据在家庭服务端,setMyGoal)。下面才是按积分走的愿望清单。
 * 两套单位、两条进度条、两种加法 —— 用户点名的就是这件事。
 *
 * 家务改成挣积分之后,那块卡片连数据源都没有了(earned 现在按分算)。
 * 所以:**搬一次,然后清掉服务端那个 goal**。
 *
 * 为什么是「搬完就清」而不是留着两边同步:
 * 两处存着同一个目标就要对账,而对账正是「两处不一致」的常见来源。
 * 清掉之后家庭板不再有攒钱目标这回事,愿望清单是唯一一处。
 *
 * 换算 1 元 = 1 积分,和 chorePointValue 同一口径。
 *
 * 幂等:按标题查重 —— 搬过一次之后服务端 goal 已清,不会再进来;
 * 万一清失败(离线),下次进来会发现同名愿望已在,不会搬第二条。
 */

import { listFamilies, getBoard, setMyGoal } from '@/lib/family/family-client';
import { loadRewards, addManualReward } from '@/lib/platform/rewards-engine';

/** 1 元 = 1 积分。和 chorePointValue 同一口径 —— 两处不一样的话搬过来的目标会对不上数。 */
function moneyToPoints(amount: number): number {
  const v = Number(amount);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.max(1, Math.round(v));
}

/** 搬了返回那条愿望的标题;没什么可搬的返回空串。失败也返回空串(不抛,不阻断奖励页)。 */
export async function migrateFamilyGoalToWish(): Promise<string> {
  try {
    const fam = await listFamilies();
    if (!fam.ok || fam.data.families.length === 0) return '';
    const familyId = fam.data.families[0].familyId;
    const b = await getBoard(familyId);
    if (!b.ok) return '';

    const me = b.data.board.me;
    const amount = me.goalAmount ?? 0;
    const label = (me.goalLabel || '').trim();
    if (amount <= 0 || !label) return '';   // 没设过目标就没什么可搬的

    // 已经搬过了(同名愿望还在清单里)→ 只把服务端那个清掉,别搬第二条
    const existing = loadRewards().rewards.some((r) => r.title === label && !r.redeemedAt);
    if (!existing) {
      addManualReward({ title: label, cost: moneyToPoints(amount) });
    }
    // 清掉服务端那个 —— 从此愿望清单是唯一一处
    await setMyGoal(familyId, 0, '');
    return existing ? '' : label;
  } catch {
    // 搬不动不该让奖励页出错。下次进来会再试一遍(幂等)。
    return '';
  }
}
