/**
 * Local File Store — 记忆附件本机存储(2026-07-28,用户:「pdf 也要能收,常见文件类型都要能收」)。
 *
 * 此前记忆只收得下**图片**(local-image-store,dataURL)和**文本类**(正文塞进 rawInput)。
 * pdf / docx / xlsx / zip 这些二进制一律拒收 —— 拒得诚实,但用户要的是都能收。
 *
 * 这里是 local-image-store 的姊妹件,刻意保持同一副骨架,因为**收口点是同一批五处**:
 *   ① cloud-backup 收集(导出要带走)   ② cloud-backup 恢复(导入要写回)
 *   ③ local-owner 切账号清            ④ local-owner 登出清
 *   ⑤ SettingsSheets「删除全部数据」清
 * 仓里踩过这个坑:照片当年只清了 blob store,图片留在设备上 —— 用户以为删了其实没删。
 * 所以这五处一处都不能漏,scripts/local-file-store.test.mjs 就压这个。
 *
 * 与图片存储的两处**有意为之**的不同:
 *   · 存 Blob 而不是 dataURL。二进制转 base64 会白白胖 33%,pdf 动辄几 MB,不值当;
 *     只有导出那一步才转 base64(备份格式是 JSON,装不下 Blob)。
 *   · 有体积上限。图片是自己压过的,附件不是 —— 不设限的话一个视频就能把配额顶满,
 *     而配额满的表现是**别的东西静默存不进去**,比拒收这一个文件糟得多。
 */

import { logDropped, reportStorageDropped } from '@/lib/portal/storage-health';
import { openSimpleDb } from '@/lib/idb/open-simple-db';

const DB_NAME = 'nesio-files';
const STORE = 'files';

/** 单个附件上限。超了明确拒收,不截断 —— 截断的 pdf 是坏文件,比没有更糟。 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface LocalFileMeta {
  name: string;
  mimeType: string;
  size: number;
}
interface StoredFile extends LocalFileMeta {
  blob: Blob;
}

function openDB(): Promise<IDBDatabase | null> {
  return openSimpleDb(DB_NAME, 1, [{ name: STORE }]);
}

/** 人话体积:给 UI 和错误提示共用,免得两处各写一份四舍五入。 */
export function prettyBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
}

/**
 * 存一个附件。返回是否成功 —— 这是**唯一副本**(不上传),失败必须可见:
 * 红线「绝不吞掉存储写入失败」,和 putLocalImage 同一处理。
 */
export async function putLocalFile(assetId: string, file: File | Blob, meta: LocalFileMeta): Promise<boolean> {
  if (meta.size > MAX_FILE_BYTES) { logDropped('file_store.put:too_big', `${meta.name} ${meta.size}`); return false; }
  const db = await openDB();
  if (!db) { logDropped('file_store.put:no_idb', assetId); return false; }
  return new Promise<boolean>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const rec: StoredFile = { blob: file instanceof Blob ? file : new Blob([file]), name: meta.name, mimeType: meta.mimeType, size: meta.size };
    tx.objectStore(STORE).put(rec, assetId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => {
      // 附件体积大,失败多为配额满 —— 既派发可见事件(壳层提示),又落 grep 日志。
      logDropped('file_store.put', tx.error);
      reportStorageDropped();
      resolve(false);
    };
  });
}

export async function getLocalFile(assetId: string): Promise<StoredFile | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(assetId);
    req.onsuccess = () => resolve((req.result as StoredFile) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function deleteLocalFile(assetId: string): Promise<void> {
  const db = await openDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/**
 * 清空所有本机附件。收口用 —— 「清空本地数据」若漏了这个 IDB,
 * 用户要求删除的 pdf 会留在设备上(照片当年就是这么漏的)。
 */
export async function purgeLocalFiles(): Promise<number> {
  const db = await openDB();
  if (!db) return 0;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    const countReq = os.count();
    os.clear();
    tx.oncomplete = () => resolve((countReq.result as number) || 0);
    tx.onerror = () => resolve(0);
  });
}

const blobToDataUrl = (b: Blob) => new Promise<string>((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => resolve('');
  r.readAsDataURL(b);
});

/** 导出用:附件 → dataURL(备份格式是 JSON,装不下 Blob),带上文件名/类型。 */
export async function collectLocalFiles(): Promise<Record<string, { name: string; mimeType: string; size: number; dataUrl: string }>> {
  const db = await openDB();
  if (!db) return {};
  const rows = await new Promise<Array<[string, StoredFile]>>((resolve) => {
    const out: Array<[string, StoredFile]> = [];
    const tx = db.transaction(STORE, 'readonly');
    const os = tx.objectStore(STORE);
    const keysReq = os.getAllKeys();
    const valsReq = os.getAll();
    tx.oncomplete = () => {
      const keys = (keysReq.result || []) as IDBValidKey[];
      const vals = (valsReq.result || []) as StoredFile[];
      keys.forEach((k, i) => { if (vals[i]?.blob) out.push([String(k), vals[i]]); });
      resolve(out);
    };
    tx.onerror = () => resolve(out);
  });
  const map: Record<string, { name: string; mimeType: string; size: number; dataUrl: string }> = {};
  for (const [id, rec] of rows) {
    const dataUrl = await blobToDataUrl(rec.blob);
    if (dataUrl) map[id] = { name: rec.name, mimeType: rec.mimeType, size: rec.size, dataUrl };
  }
  return map;
}

/** 恢复用:把备份里的附件写回本机 IDB。 */
export async function restoreLocalFiles(map: Record<string, { name?: string; mimeType?: string; size?: number; dataUrl?: string }>): Promise<number> {
  const db = await openDB();
  if (!db || !map) return 0;
  const items: Array<[string, StoredFile]> = [];
  for (const [id, rec] of Object.entries(map)) {
    if (!rec?.dataUrl) continue;
    try {
      const res = await fetch(rec.dataUrl);
      const blob = await res.blob();
      items.push([id, { blob, name: rec.name || id, mimeType: rec.mimeType || blob.type || 'application/octet-stream', size: rec.size || blob.size }]);
    } catch { /* 单条坏了不拖垮整批 */ }
  }
  if (!items.length) return 0;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    for (const [id, rec] of items) os.put(rec, id);
    tx.oncomplete = () => resolve(items.length);
    tx.onerror = () => {
      // 恢复导入失败(配额满)= 备份里的附件没写回,必须可见,别假装恢复成功。
      logDropped('file_store.restore', tx.error);
      reportStorageDropped();
      resolve(0);
    };
  });
}
