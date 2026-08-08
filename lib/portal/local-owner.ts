/**
 * 本地数据的「主人」记录 —— 跨账号本地数据泄漏(P0)的修复核心。
 *
 * 问题:本地 localStorage/IndexedDB 数据不绑定账号。A 登出后 B 在同一台设备登录,
 * A 的全部记忆/通讯录/照片对 B 可见 —— 对「私密第二大脑」是致命信任缺陷
 * (合租/家人共用设备、二手机、演示机)。
 *
 * 方案:记录本机数据归属(userId+email)。登录会话解析后 reconcile:
 *  - 无主 + 无数据      → 静默认领(fresh device)。
 *  - 无主 + 有匿名数据  → 显式问:归入此账号 / 清除(匿名→登录合并不许默默混)。
 *  - 主人 = 当前用户    → 正常。
 *  - 主人 ≠ 当前用户    → 阻断弹窗:清除上一账号数据后继续 / 退出登录。
 *
 * 登出**不**清主人记录:数据仍属于原账号,原账号回来无感;换人登录才触发冲突。
 */

import { deleteLifeNode, getLifeGraph } from '@/lib/portal/life-graph';
import { purgeLocalData } from '@/lib/portal/storage-manifest';
import { purgeIdbBlobs } from '@/lib/portal/idb-blob-store';
import { purgeLocalImages } from '@/lib/portal/local-image-store';
import { logDropped } from '@/lib/portal/storage-health';

const OWNER_KEY = 'nesio-local-owner-v1';

export interface LocalOwner {
  userId: string;
  email: string;
  claimedAt: string;
}

export function getLocalOwner(): LocalOwner | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(OWNER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalOwner;
    return parsed && typeof parsed.userId === 'string' && parsed.userId ? parsed : null;
  } catch { return null; }
}

export function setLocalOwner(userId: string, email: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(OWNER_KEY, JSON.stringify({ userId, email, claimedAt: new Date().toISOString() } satisfies LocalOwner));
  } catch (err) { logDropped('local_owner.set', err); }
}

/**
 * 本机有没有值得保护的用户数据。
 * 记忆图是主判据;财务/健康/持仓等 durable blob 即使图已空也算「有」——
 * 否则会话过期后只剩持仓时,匿名清库会漏掉(共享设备仍能在 DevTools 看到)。
 */
export function hasMeaningfulLocalData(): boolean {
  try {
    if (getLifeGraph().length > 0) return true;
  } catch { /* ignore */ }
  if (typeof window === 'undefined') return false;
  const residualKeys = [
    'nesio-fin-holdings-v1',
    'nesio-bank-tx-v1',
    'nesio-bank-accounts-v1',
    'nesio-health-v1',
    'nesio-place-geo-v1',
    'nesio-mirror-profile-v1',
  ];
  try {
    for (const k of residualKeys) {
      const v = localStorage.getItem(k);
      if (v && v !== '[]' && v !== '{}' && v !== 'null') return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * 清除本机全部用户数据(记忆/健康/财务/地点/照片/学习偏好…),保留登录态。
 * 与设置页「彻底删除本机全部数据」同一套动作 —— 单一实现,两处共用。
 * 注意:走 deleteLifeNode **会把删除传导到云**(事实库/signals),是「彻底删号/抹数据」语义。
 * 登出**不能**用它(否则连云端也抹了、重登拉不回)—— 登出走下面的 purgeLocalUserDataForLogout。
 */
export async function purgeAllLocalUserData(): Promise<void> {
  try {
    getLifeGraph().forEach((n) => deleteLifeNode(n.id)); // 走正规删除(传导事实库/云)
    purgeLocalData(localStorage);                         // 本机 localStorage key 收口清除(保留 auth)
    await purgeIdbBlobs();                                // IDB blob(健康/临床/地点)
    await purgeLocalImages();                             // 记忆照片独立 IDB(nesio-images)
    await (await import('./local-file-store')).purgeLocalFiles();  // 记忆附件独立 IDB(nesio-files)
    (await import('../platform/music/player-engine')).stop();  // 同上:先停,再清
    await (await import('../platform/music/local-tracks')).purgeLocalTracks(); // 本地曲库独立 IDB(nesio-music)
    await (await import('./local-email-body')).purgeEmailBodies(); // 邮件全文独立 IDB(nesio-email-bodies)
  } catch (err) { logDropped('local_owner.purge', err); }
}

/**
 * 退出登录时的**本机清除**(数据泄露收口):把本机全部用户数据从这台设备抹掉,让下一个人/guest
 * 看到的是空白,而**不**触碰云端(数据已跨端同步,重新登录会从云拉回)。与 purgeAllLocalUserData 的
 * 关键区别:**绝不走 deleteLifeNode**(那会把删除传导上云),只做纯本地清除 ——
 *   - purgeLocalData 直接 removeItem 掉 nesio-life-graph-v1 等 durable key(纯本地删,不发云删除)
 *   - IDB(blob/照片/邮件全文)本地 clear
 *   - 清主人记录:这台设备回到「干净设备」,重登静默认领、从云回灌。
 */
export async function purgeLocalUserDataForLogout(): Promise<void> {
  try {
    purgeLocalData(localStorage);                         // 本机 localStorage 用户数据(含记忆图 key)——纯本地删,不传导云
    await purgeIdbBlobs();                                // 健康/临床/地点 IDB(本地 clear)
    await purgeLocalImages();                             // 记忆照片 IDB(本地 clear)
    await (await import('./local-file-store')).purgeLocalFiles();  // 记忆附件 IDB(本地 clear)
    // 先停播再清曲库:歌还在响、文件已经删掉,是这台设备上最刺眼的一种「删了没删干净」。
    (await import('../platform/music/player-engine')).stop();
    await (await import('../platform/music/local-tracks')).purgeLocalTracks(); // 本地曲库 IDB(本地 clear)——漏了就把歌留在这台设备上
    await (await import('./local-email-body')).purgeEmailBodies(); // 邮件全文 IDB(本地 clear)
    try { localStorage.removeItem(OWNER_KEY); } catch { /* ignore */ } // 清主人记录:回到干净设备
  } catch (err) { logDropped('local_owner.logout_purge', err); }
}

export type OwnerVerdict =
  | { kind: 'ok' }
  /** 无主匿名数据:要问「归入此账号还是清除」 */
  | { kind: 'anonymous_data' }
  /** 本机是另一个账号的数据:必须清除或退出 */
  | { kind: 'other_account'; prevEmail: string };

/**
 * 登录会话解析完成后调用。只读判断,不做破坏性动作 —— 由 UI 按 verdict 弹窗,
 * 用户选择后再调 claimLocalDataForUser / purgeAllLocalUserData。
 */
export function reconcileLocalOwner(userId: string, email: string): OwnerVerdict {
  if (!userId || userId === 'local') return { kind: 'ok' }; // 本地部署/无账号形态不适用
  const owner = getLocalOwner();
  if (owner) {
    if (owner.userId === userId) return { kind: 'ok' };
    return { kind: 'other_account', prevEmail: owner.email || '' };
  }
  if (hasMeaningfulLocalData()) return { kind: 'anonymous_data' };
  setLocalOwner(userId, email); // 干净设备:静默认领
  return { kind: 'ok' };
}

/** 用户选择「归入此账号」(匿名→登录合并的显式确认)。 */
export function claimLocalDataForUser(userId: string, email: string): void {
  setLocalOwner(userId, email);
}
