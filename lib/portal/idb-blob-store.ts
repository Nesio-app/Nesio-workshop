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

import { openSimpleDbStrict } from '@/lib/idb/open-simple-db';

export interface BlobBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const DB_NAME = 'nesio-blobs';
const STORE = 'blobs';

function openDb(): Promise<IDBDatabase> {
  return openSimpleDbStrict(DB_NAME, 1, [{ name: STORE }]);
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
/** key → 「从 IDB 重读一遍」。云同步在外部写完 IDB 之后靠它让 store 跟上。 */
const blobRefreshers = new Map<string, () => Promise<void>>();

function registerBlobRefresh(key: string, fn: () => Promise<void>): void {
  blobRefreshers.set(key, fn);
}

/**
 * 让这些 key 对应的 store 重新从 IDB 读一遍(外部直接写过 IDB 之后必须调)。
 * 不认识的 key 直接跳过 —— 它可能只是 localStorage 的,那边本来就没有缓存层。
 */
export async function rehydrateIdbBlobs(keys: readonly string[]): Promise<number> {
  let n = 0;
  for (const k of keys) {
    const fn = blobRefreshers.get(k);
    if (!fn) continue;
    try { await fn(); n++; } catch { /* 单个失败不拖垮其余 */ }
  }
  return n;
}

/** 该 key 是否是 IDB blob(已登记)。 */
export function isIdbBlobKey(key: string): boolean {
  return registeredBlobKeys.has(key);
}

/**
 * 登记一个直接用 idbBackend(非 createBlobStore)持久化的 key，让备份/恢复/清理
 * 把它当 IDB blob 处理。给 life-graph 这类需要「同步读 + IDB 大容量持久」的自管存储用。
 */
export function registerIdbBlobKey(key: string): void {
  registeredBlobKeys.add(key);
}

/** 全部已登记的 IDB blob key。 */
export function idbBlobKeys(): string[] {
  return [...registeredBlobKeys];
}

export interface BlobStore<T> {
  load(): T | null;
  save(value: T): void;
  ready(): Promise<void>;
  /** 从 IDB 重读一遍(外部直接写过 IDB 之后必须调,见 rehydrateIdbBlobs)。 */
  refresh(): Promise<void>;
  /** 首次水合是否已完成(写路径可据此同步读-改-写,避免空缓存盖档)。 */
  isReady(): boolean;
}

export interface BlobStoreOptions<T> {
  key: string;
  updateEvent: string;
  validate?: (v: unknown) => boolean;
  backend?: BlobBackend;
  onWriteError?: () => void;
  autoHydrate?: boolean;
  /**
   * 冷启动第一帧就能读:save 时双写 localStorage,load() 在内存空时同步读它,
   * 水合时不删这份种子。给「进页必须立刻有画」的小 JSON(车况/家务板)用。
   * 大块(流水/轨迹)不要开 —— 那正是迁出 LS 的原因。
   */
  syncSeed?: boolean;
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

  /**
   * 水合完成前的「最新意向写」。hydrate 末尾再看一次:
   * 若期间有 save,以意向写为准落盘,绝不让「基于空缓存算出的旧空账」在调用方
   * 未 await ready 时盖掉 IDB 里的完整档案(card-archive / judge-ledger 冷启动事故)。
   */
  let pendingWrite: T | null = null;
  let hydrated = false;

  function readLsSeed(): T | null {
    if (!opts.syncSeed || !hasWindow) return null;
    try {
      const raw = localStorage.getItem(opts.key);
      if (raw == null) return null;
      const v = JSON.parse(raw) as unknown;
      if (opts.validate && !opts.validate(v)) return null;
      return v as T;
    } catch { return null; }
  }

  function writeLsSeed(value: T): void {
    if (!opts.syncSeed || !hasWindow) return;
    try { localStorage.setItem(opts.key, JSON.stringify(value)); }
    catch { opts.onWriteError?.(); }
  }

  async function hydrate(): Promise<void> {
    try {
      let raw = await backend.get(opts.key);
      if (raw == null && hasWindow) {
        const ls = localStorage.getItem(opts.key);
        if (ls != null) {
          raw = ls;
          await backend.set(opts.key, ls);
          // 默认可再生缓存迁完就删 LS 腾配额;syncSeed 的种子要留着给下一帧首屏。
          if (!opts.syncSeed) {
            try { localStorage.removeItem(opts.key); } catch { /* ignore */ }
          }
        }
      }
      let disk: T | null = null;
      if (raw != null) {
        try {
          const v = JSON.parse(raw) as unknown;
          if (!opts.validate || opts.validate(v)) disk = v as T;
        } catch { /* ignore bad json */ }
      }
      if (pendingWrite != null) {
        cache = pendingWrite;
        pendingWrite = null;
        await backend.set(opts.key, JSON.stringify(cache)).catch(() => opts.onWriteError?.());
      } else if (disk != null) {
        cache = disk;
      }
      if (opts.syncSeed && cache != null) writeLsSeed(cache);
    } catch { /* 水合失败:缓存保持 null */ }
    hydrated = true;
    emit();
  }

  function ready(): Promise<void> {
    if (!hydratePromise) hydratePromise = hydrate();
    return hydratePromise;
  }

  /**
   * 重新从 IDB 读一遍(2026-07-30 自查发现)。
   *
   * 为什么必须有:云同步落地走的是 restoreCombinedBackup → idbBackend.set(),
   * **绕过了这个 store**。而 ready() 的 hydratePromise 是记忆化的,
   * 第一次之后再也不会重读 —— 于是数据已经在 IDB 里了,页面上还是旧的那份,
   * 要等下次冷启动才看得见。用户那边的表现就是「同一入口不同时间点几种状态」。
   *
   * hydrate() 末尾会 emit,监听组件据此重读。
   */
  function refresh(): Promise<void> {
    hydrated = false;
    hydratePromise = hydrate();
    return hydratePromise;
  }
  registerBlobRefresh(opts.key, refresh);

  if (opts.autoHydrate !== false && hasWindow) void ready();

  return {
    load: () => {
      if (cache != null) return cache;
      const seed = readLsSeed();
      if (seed != null) cache = seed;
      return cache;
    },
    save(value: T) {
      cache = value;
      writeLsSeed(value);
      emit();
      if (!hydrated) {
        // 尚未水合:只记意向,等 ready 后由 hydrate 或下方 then 落盘。
        pendingWrite = value;
        void ready().then(() => {
          if (pendingWrite != null) {
            cache = pendingWrite;
            pendingWrite = null;
            backend.set(opts.key, JSON.stringify(cache)).catch(() => opts.onWriteError?.());
          }
        });
        return;
      }
      pendingWrite = null;
      backend.set(opts.key, JSON.stringify(value)).catch(() => opts.onWriteError?.());
    },
    ready,
    refresh,
    isReady: () => hydrated,
  };
}
