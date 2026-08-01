'use client';

/**
 * 家务完成 → 记积分(2026-08-01,用户:「这两个合并,家务也挣积分」)。
 *
 * 在这之前奖励页是两套经济并排:上面「乐高」按**钱**攒(进度来自家务挣的钱,
 * 存家庭服务端),下面愿望清单按**积分**攒(存本机)。同一页两种单位、两条进度条。
 * 现在只有积分这一种:家务做完也进同一个池子,「做够这些家务就能换那个东西」
 * 在心里是直接对得上的。
 *
 * 这个文件只做一件事:拿到刚动过的那条家务的**最新状态**,交给 earnChorePoints。
 * 为什么要重新读一遍 board 而不是直接用点击时手上那条 —— 「完成」之后的状态
 * 是服务端定的(要不要审核、批没批),客户端手上那份是动作**之前**的。
 * 拿旧的去判,要审核的那些会在还没批的时候就把分发了。
 *
 * 幂等在 earnChorePoints 里(按 instance id 去重)—— 这里可以放心重复调:
 * 今天页和家庭板各有一个「完成」按钮,刷新之后 board 还会把它带回来。
 */

import { getBoard } from '@/lib/family/family-client';
import { earnChorePoints } from '@/lib/platform/rewards-engine';

export async function awardChorePoints(
  familyId: string,
  instanceId: string,
  locale: 'zh' | 'en' = 'zh',
): Promise<void> {
  if (!familyId || !instanceId) return;
  try {
    const b = await getBoard(familyId);
    if (!b.ok) return;   // 读不到就不给分。下次动这条家务时会再判一遍(幂等,不会重复给)
    const board = b.data.board;
    const all = [...board.myChoresToday, ...board.toReview, ...board.assigned];
    const chore = all.find((c) => c.id === instanceId);
    if (!chore) return;
    // 只给**自己**做的那些记分 —— 家长批准别人的家务不该往自己的积分池里加。
    if (chore.assigneeId !== board.me.id) return;
    earnChorePoints(chore, locale);
  } catch {
    // 记分失败不该把「家务完成」这件事一起打翻 —— 家务是主,积分是影。
    // 下次动这条家务时会再判一遍。
  }
}
