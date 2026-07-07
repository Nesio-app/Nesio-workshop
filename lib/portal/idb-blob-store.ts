/**
 * IDB blob store —— 把「一个 key 存一个 JSON blob」的本机存储从 localStorage 挪到 IndexedDB,
 * 腾出 5MB localStorage 配额(健康时序/地点轨迹这些大块本就该在 GB 级本机 IDB;IDB 不是云,仍 local-first)。
 *
 * 读取仍**同步**(内存缓存),不改读取点:
 *   - 每 store 一个 createBlobStore:模块加载即异步水合(读 IDB → 填缓存),load() 同步读缓存、
 *     save() 写缓存 + 异步落 IDB + 派发更新事件(监听组件冷启动那一瞬后重读)。
 *   - 迁移:水合时 IDB 空但旧 localStorage key 还在 → 搬进 IDB 并删掉 localStorage key(老用户透明迁移 + 腾配额)。
 *
 * 后端可注入(便于单测);导出/删除收口(full-backup / purgeLocalData)也覆盖这些 IDB blob。
 */

export interface BlobBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const DB_NAME = 'nesio-blobs';
const STORE = 'blobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 真 IndexedDB 后端;SSR/无 IDB 时安全降级。 */
export const idbBackend: BlobBackend = {
  async get(key) {
    if (typeof indexedDB === 'undefined') return null;
    const db = await openDb();
    return new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => resolve(null);
    });
  },
  async set(key, value) {
    if (typeof indexedDB === 'undefined') return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async delete(key) {
    if (typeof indexedDB === 'undefined') return;
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },
  async keys() {
    if (typeof indexedDB === 'undefined') return [];
    const db = await openDb();
    return new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => resolve([]);
    });
  },
};

/** 导出/删除收口:读出全部 IDB blob(key→JSON 串),给 full-backup 合并进备份。 */
export async function collectIdbBlobs(backend: BlobBackend = idbBackend): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    for (const k of await backend.keys()) {
      const v = await backend.get(k);
      if (v != null) out[k] = v;
    }
  } catch { /* 无 IDB → 空 */ }
  return out;
}

/** 删除收口:清空全部 IDB blob(「彻底删除本机数据」用)。返回删掉的数量。 */
export async function purgeIdbBlobs(backend: BlobBackend = idbBackend): Promise<number> {
  try {
    const keys = await backend.keys();
    for (const k of keys) await backend.delete(k);
    return keys.length;
  } catch { return 0; }
}

// ── IDB key 登记(单一真源)──────────────────────────────────────────────────
// 各 blob store createBlobStore 时把自己的 key 登记进来。restore/路由据此判断某 key 该落
// IDB 还是 localStorage —— 备份是扁平的、分辨不出,登记表就是那把标尺。
const registeredBlobKeys = new Set<string>();

/** 该 key 是否是 IDB blob(已登记)。 */
export function isIdbBlobKey(key: string): boolean {
  return registeredBlobKeys.has(key);
}

/** 全部已登记的 IDB blob key。 */
export function idbBlobKeys(): string[] {
  return [...registeredBlobKeys];
}

export interface BlobStore<T> {
  load(): T | null;
  save(value: T): void;
  ready(): Promise<void>;
}

export interface BlobStoreOptions<T> {
  key: string;
  updateEvent: string;
  validate?: (v: unknown) => boolean;
  backend?: BlobBackend;
  onWriteError?: () => void;
  autoHydrate?: boolean;
}

export function createBlobStore<T>(opts: BlobStoreOptions<T>): BlobStore<T> {
  registeredBlobKeys.add(opts.key); // 登记:restore 据此把这个 key 落 IDB 而非 localStorage
  const backend = opts.backend ?? idbBackend;
  const hasWindow = typeof window !== 'undefined';
  let cache: T | null = null;
  let hydratePromise: Promise<void> | null = null;

  function emit() {
    if (hasWindow) window.dispatchEvent(new CustomEvent(opts.updateEvent));
  }

  async function hydrate(): Promise<void> {
    try {
      let raw = await backend.get(opts.key);
      if (raw == null && hasWindow) {
        const ls = localStorage.getItem(opts.key);
        if (ls != null) {
          raw = ls;
          await backend.set(opts.key, ls);
          try { localStorage.removeItem(opts.key); } catch { /* ignore */ }
        }
      }
      if (raw != null) {
        const v = JSON.parse(raw) as unknown;
        if (!opts.validate || opts.validate(v)) cache = v as T;
      }
    } catch { /* 水合失败:缓存保持 null */ }
    emit();
  }

  function ready(): Promise<void> {
    if (!hydratePromise) hydratePromise = hydrate();
    return hydratePromise;
  }

  if (opts.autoHydrate !== false && hasWindow) void ready();

  return {
    load: () => cache,
    save(value: T) {
      cache = value;
      emit();
      backend.set(opts.key, JSON.stringify(value)).catch(() => opts.onWriteError?.());
    },
    ready,
  };
}
