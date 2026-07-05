/**
 * Local Image Store — 记忆照片本机存储(批次 23)。
 *
 * 此前拍照只把图上传云端(未登录/离线就没图)。这里把压缩后的照片
 * 存 IndexedDB(localStorage 装不下图),节点详情从本机读缩略/大图,
 * 问一问也能拿到 base64 做图片问答。key = assetId,与节点的 asset 记录对应。
 */

const DB_NAME = 'nesio-images';
const STORE = 'images';

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
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

export async function putLocalImage(assetId: string, dataUrl: string): Promise<void> {
  const db = await openDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(dataUrl, assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
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
