/**
 * 账号空间(批次 34)—— 每个账号的本地记忆放在自己名下,切号不再逼用户清数据。
 *
 * 机制:切换账号时把当前本地数据整包归档(buildCombinedBackup,与导出/云备份同一
 * 枚举),存入**独立 IDB**(nesio-account-spaces —— 故意不放 blob store:
 * purgeAllLocalUserData 会清空 blob store,归档必须在清场之外幸存);
 * 清场后若新账号有归档就原地恢复(restoreCombinedBackup replace),没有则空场
 * 起步(云同步会拉回该账号的云端数据)。
 *
 * 已知限界:归档覆盖 localStorage 全清单 + IDB blob(健康/地点/图)+ 记忆照片;
 * signal 事实库按删除传导清场,恢复后由后续编辑/云同步逐步回填(语义索引重建)。
 */

import { buildCombinedBackup, restoreCombinedBackup } from './cloud-backup';
import { logDropped } from './storage-health';
import { openSimpleDbStrict } from '@/lib/idb/open-simple-db';

const DB_NAME = 'nesio-account-spaces';
const STORE = 'spaces';

function openDb(): Promise<IDBDatabase> {
  return openSimpleDbStrict(DB_NAME, 1, [{ name: STORE }]);
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

async function idbPut(key: string, value: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

const spaceKey = (userId: string) => `space:${userId}`;

/** 把当前本机数据整包归档到 userId 名下(含记忆照片)。 */
export async function archiveCurrentSpace(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const backup = await buildCombinedBackup({ includeImages: true });
    await idbPut(spaceKey(userId), JSON.stringify(backup));
    return true;
  } catch (err) {
    logDropped('account_spaces.archive', err);
    return false;
  }
}

export async function hasArchivedSpace(userId: string): Promise<boolean> {
  try { return Boolean(await idbGet(spaceKey(userId))); } catch { return false; }
}

/** 恢复 userId 名下的归档到本机(replace 覆盖);成功后删归档(live 数据即最新)。 */
export async function restoreArchivedSpace(userId: string): Promise<boolean> {
  try {
    const raw = await idbGet(spaceKey(userId));
    if (!raw) return false;
    const backup = JSON.parse(raw) as Parameters<typeof restoreCombinedBackup>[0];
    await restoreCombinedBackup(backup, 'replace');
    await idbDelete(spaceKey(userId));
    return true;
  } catch (err) {
    logDropped('account_spaces.restore', err);
    return false;
  }
}
