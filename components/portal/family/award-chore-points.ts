'use client';

/**
 * 家务完成 → 记积分(2026-08-01,用户:「这两个合并,家务也挣积分」)。
 *
 * 判据在 earnChorePoints(幂等 + 要审核的批准后才给)。
 * 家长批准孩子的家务时,分记在孩子设备上的积分池 —— 所以除了动作当下
 * 尝试记分,打开家庭板时还会从账本 reconcile 一遍(幂等,不会重复给)。
 */

import { getBoard, getLedger } from '@/lib/family/family-client';
import { earnChorePoints } from '@/lib/platform/rewards-engine';

function awardIfMine(
  chore: { id: string; title?: string; value: number; state: string; needsApproval?: boolean; assigneeId?: string } | undefined,
  myId: string,
  locale: 'zh' | 'en',
): void {
  if (!chore || chore.assigneeId !== myId) return;
  earnChorePoints(chore, locale);
}

/** 打开家庭板/今天页时:把账本里已批准、但本机还没记过的家务积分补齐。 */
export async function reconcileMyChorePoints(
  familyId: string,
  locale: 'zh' | 'en' = 'zh',
): Promise<void> {
  if (!familyId) return;
  try {
    const b = await getBoard(familyId);
    if (!b.ok) return;
    const myId = b.data.board.me.id;
    const lr = await getLedger(familyId, myId);
    if (!lr.ok) return;
    for (const c of lr.data.ledger.approved) {
      earnChorePoints(c, locale);
    }
  } catch { /* 记分失败不拦页面 */ }
}

export async function awardChorePoints(
  familyId: string,
  instanceId: string,
  locale: 'zh' | 'en' = 'zh',
): Promise<void> {
  if (!familyId || !instanceId) return;
  try {
    const b = await getBoard(familyId);
    if (!b.ok) return;
    const board = b.data.board;
    const all = [...board.myChoresToday, ...board.toReview, ...board.assigned];
    const chore = all.find((c) => c.id === instanceId);
    awardIfMine(chore, board.me.id, locale);
    // 家长批准后孩子不在场 —— 孩子下次打开板子时 reconcile 会补上
    void reconcileMyChorePoints(familyId, locale);
  } catch { /* 记分失败不拦家务完成 */ }
}
