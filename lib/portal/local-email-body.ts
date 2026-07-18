/**
 * Local Email Body Store — 邮件全文本机专属存储(邮件全链路 Phase 1)。
 *
 * 隐私红线:邮件是最私密的数据。全文**只存本机 IndexedDB**,不进云同步的
 * LifeNode.attributes(那会随 memory 快照上云)。记忆节点只保留短 summary +
 * emailId 指针;详情「阅读原文」按 emailId 从这里取全文。
 *
 * key = emailId(Gmail message id),value = 纯文本正文(已剥 HTML)。
 * 与 local-image-store 同构;「清空本地数据」时一并清。
 */

const DB_NAME = 'nesio-email-bodies';
const STORE = 'bodies';

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

/** 存一封邮件全文(本机)。空文本跳过。 */
export async function putEmailBody(emailId: string, body: string): Promise<void> {
  if (!emailId || !body) return;
  const db = await openDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(body, emailId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** 批量存(一次同步多封)。 */
export async function putEmailBodies(map: Record<string, string>): Promise<void> {
  const db = await openDB();
  if (!db || !map) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    for (const [id, body] of Object.entries(map)) {
      if (id && typeof body === 'string' && body) os.put(body, id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** 取一封邮件全文;没有返回 null。 */
export async function getEmailBody(emailId: string): Promise<string | null> {
  if (!emailId) return null;
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(emailId);
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => resolve(null);
  });
}

/** 读出全部本机邮件全文(emailId → 正文)。用于建本机全文检索索引(里程碑 B)。 */
export async function getAllEmailBodies(): Promise<Record<string, string>> {
  const db = await openDB();
  if (!db) return {};
  return new Promise((resolve) => {
    const out: Record<string, string> = {};
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        if (typeof cur.key === 'string' && typeof cur.value === 'string') out[cur.key] = cur.value;
        cur.continue();
      } else resolve(out);
    };
    req.onerror = () => resolve(out);
  });
}

/** 清空所有本机邮件全文(隐私收口:「清空本地数据」调用)。返回清掉的条数。 */
export async function purgeEmailBodies(): Promise<number> {
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
