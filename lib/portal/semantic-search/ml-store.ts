/**
 * Lab 语义搜索的本机存储:模型文件 + 照片向量索引,全在 IndexedDB,不出设备。
 * 模型第一次由用户拖入(见 Lab 页说明),之后离线可用——不依赖任何托管。
 */

const DB_NAME = 'nesio-ml';
const MODELS = 'models';
const INDEX = 'clip-index';

export interface IndexEntry {
  id: string;            // 宝盒照片 = assetId;本地文件 = name#size
  label: string;
  thumb: string;         // dataURL,展示用
  emb: Float32Array;     // 512 维,已归一化
  source: 'baohe' | 'file';
}

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MODELS)) db.createObjectStore(MODELS);
      if (!db.objectStoreNames.contains(INDEX)) db.createObjectStore(INDEX, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDB().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      const req = op(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    });
  });
}

export const putModel = (name: string, blob: Blob) => tx<undefined>(MODELS, 'readwrite', (s) => s.put(blob, name));
export const getModel = (name: string) => tx<Blob>(MODELS, 'readonly', (s) => s.get(name));
export const putIndexEntry = (e: IndexEntry) => tx<undefined>(INDEX, 'readwrite', (s) => s.put(e));
export const getAllIndex = () => tx<IndexEntry[]>(INDEX, 'readonly', (s) => s.getAll()).then((r) => r ?? []);
export const clearIndex = () => tx<undefined>(INDEX, 'readwrite', (s) => s.clear());

/** 枚举宝盒照片库(nesio-images,key=assetId,value=JPEG dataURL)。 */
export function listBaoheImages(): Promise<{ id: string; dataUrl: string }[]> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve([]); return; }
    const req = indexedDB.open('nesio-images', 1);
    req.onupgradeneeded = () => { /* 别在这里建库:没有就算了 */ };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('images')) { resolve([]); return; }
      const store = db.transaction('images', 'readonly').objectStore('images');
      const keysReq = store.getAllKeys();
      const valsReq = store.getAll();
      let keys: IDBValidKey[] = [];
      valsReq.onsuccess = () => {
        const vals = valsReq.result as string[];
        resolve(keys.map((k, i) => ({ id: String(k), dataUrl: vals[i] })).filter((x) => x.dataUrl?.startsWith?.('data:')));
      };
      keysReq.onsuccess = () => { keys = keysReq.result; };
      valsReq.onerror = () => resolve([]);
    };
    req.onerror = () => resolve([]);
  });
}
