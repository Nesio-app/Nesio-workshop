/**
 * open-simple-db —— 独立单库 IndexedDB 的通用 open() 实现。
 *
 * `nesio-signals` / `nesio-images` / `nesio-email-bodies` / `nesio-reader` /
 * `nesio-vectors` / `nesio-files` / `nesio-blobs` / `nesio-ml` / `nesio-music` /
 * `nesio-account-spaces` 这 10 个库此前各自复制粘贴同一段 `indexedDB.open`
 * 样板。抽成这一份 —— DB_NAME/STORE/keyPath/indexes 仍各库自己的，只是
 * 「怎么开库」这件事不再重复十遍。
 *
 * **不合并物理 store**（那是另一件事，见 idb-core.ts 的 `treasurebox`）：
 * 独立库带来的故障隔离是真实价值，不因为样板代码重复就该牺牲掉。
 *
 * 幂等建表：一律走 `objectStoreNames.contains` 判重再建 —— 原来 `nesio-signals`
 * 和 `nesio-vectors` 完全没判（版本号从没升过所以没炸，是巧合不是设计），
 * 顺手把这个隐患堵上，呼应 idb-core.ts 同一类修复（补索引那条）。
 *
 * ## 两种失败契约，都保留
 *
 * 多数库（8/10）失败即 `resolve(null)`，调用方自己判断退化（`if (!db) return`）。
 * `nesio-blobs` / `nesio-account-spaces` 这两个失败即 `reject`，调用方自己
 * try/catch —— 这不是随意的差异，是这两个模块原有的错误处理契约，改成
 * fail-soft 会悄悄吞掉它们原本会往外抛的错误。两条路径都提供，别选错。
 */

export interface SimpleStoreDef {
  name: string;
  keyPath?: string;
  indexes?: ReadonlyArray<{ name: string; keyPath: string; unique?: boolean }>;
}

/** 失败(无 IDB / open 报错)即 `resolve(null)` —— 多数调用方靠这个语义退化，不抛。 */
export function openSimpleDb(
  dbName: string,
  version: number,
  stores: readonly SimpleStoreDef[],
): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of stores) {
        if (db.objectStoreNames.contains(s.name)) continue;
        const store = db.createObjectStore(s.name, s.keyPath ? { keyPath: s.keyPath } : undefined);
        for (const idx of s.indexes || []) {
          store.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/**
 * 失败即 `reject`(原始 `req.error`)——给自己 try/catch 的调用方用，
 * 不悄悄把它们的「错误要抛出去」契约改成「错误变 null」。
 */
export function openSimpleDbStrict(
  dbName: string,
  version: number,
  stores: readonly SimpleStoreDef[],
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of stores) {
        if (db.objectStoreNames.contains(s.name)) continue;
        const store = db.createObjectStore(s.name, s.keyPath ? { keyPath: s.keyPath } : undefined);
        for (const idx of s.indexes || []) {
          store.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
