/**
 * Local Image Store — 记忆照片本机存储(批次 23)。
 *
 * 此前拍照只把图上传云端(未登录/离线就没图)。这里把压缩后的照片
 * 存 IndexedDB(localStorage 装不下图),节点详情从本机读缩略/大图,
 * 问一问也能拿到 base64 做图片问答。key = assetId,与节点的 asset 记录对应。
 */

import { logDropped, reportStorageDropped } from '@/lib/portal/storage-health';
import { openSimpleDb } from '@/lib/idb/open-simple-db';

const DB_NAME = 'nesio-images';
const STORE = 'images';

function openDB(): Promise<IDBDatabase | null> {
  return openSimpleDb(DB_NAME, 1, [{ name: STORE }]);
}

/** 压缩到最长边 maxDim 的 JPEG dataURL(存储与上传都用它)。 */
export async function compressToDataUrl(file: File | Blob, maxDim = 1400, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * 存一张本机照片。返回是否成功——离线/未登录时这是**唯一副本**,失败必须可见:
 * 红线「绝不吞掉存储写入失败」。姊妹文件 local-email-body.ts 同法(此前本文件遗漏)。
 * 返回 boolean(非破坏:现有 `await` 丢弃返回值的调用方不受影响,新调用方可据此提示重试)。
 */
export async function putLocalImage(assetId: string, dataUrl: string): Promise<boolean> {
  const db = await openDB();
  if (!db) { logDropped('image_store.put:no_idb', assetId); return false; }
  return new Promise<boolean>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(dataUrl, assetId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => {
      // 照片体积大,失败多为配额满 —— 既派发可见事件(壳层提示),又落 grep 日志。
      logDropped('image_store.put', tx.error);
      reportStorageDropped();
      resolve(false);
    };
  });
}

export async function getLocalImage(assetId: string): Promise<string | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(assetId);
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function deleteLocalImage(assetId: string): Promise<void> {
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
 * 清空所有本机照片。隐私审计:图片存在独立 IDB(nesio-images),不在 nesio-blobs 里,
 * 「清空本地数据」若只清 blob store 会把照片留在设备上(用户要求删除却没删)。收口用。
 */
export async function purgeLocalImages(): Promise<number> {
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

/** 导出用:收集所有本机照片(assetId → dataUrl),让备份能带走图片(否则导出不完整)。 */
export async function collectLocalImages(): Promise<Record<string, string>> {
  const db = await openDB();
  if (!db) return {};
  return new Promise((resolve) => {
    const out: Record<string, string> = {};
    const tx = db.transaction(STORE, 'readonly');
    const os = tx.objectStore(STORE);
    const keysReq = os.getAllKeys();
    const valsReq = os.getAll();
    tx.oncomplete = () => {
      const keys = (keysReq.result || []) as IDBValidKey[];
      const vals = (valsReq.result || []) as string[];
      keys.forEach((k, i) => { if (typeof vals[i] === 'string') out[String(k)] = vals[i]; });
      resolve(out);
    };
    tx.onerror = () => resolve(out);
  });
}

/** 恢复用:把备份里的照片写回本机 IDB。 */
export async function restoreLocalImages(map: Record<string, string>): Promise<number> {
  const db = await openDB();
  if (!db || !map) return 0;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    let n = 0;
    for (const [id, dataUrl] of Object.entries(map)) {
      if (typeof dataUrl === 'string') { os.put(dataUrl, id); n++; }
    }
    tx.oncomplete = () => resolve(n);
    tx.onerror = () => {
      // 恢复导入失败(配额满)= 备份里的照片没写回,必须可见,别假装恢复成功。
      logDropped('image_store.restore', tx.error);
      reportStorageDropped();
      resolve(0);
    };
  });
}
