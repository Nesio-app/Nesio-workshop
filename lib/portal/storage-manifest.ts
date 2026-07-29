/**
 * 本机存储清单(单一真源)—— 全仓 ~150 个 localStorage key 的分类中枢。
 *
 * 为什么存在:key 三年攒到 ~150 个、三套前缀(nesio- / treasurebox- / baohe_ / analyst_),
 * 导出只认 nesio-/treasurebox-(漏 baohe_/analyst_),删除只清记忆节点(bank/health/place/
 * 学习态全留在本机 = 隐私漏洞)。这里把「哪些 key、属哪类」收成一处,导出/删除都据此遍历,
 * 不再各写一份、不再漏。(docs/design/system-layers.md:统一层的隐私收口。)
 *
 * kind 三分:
 *   auth   —— 登录票据(绝不进备份文件;「删除数据」默认保留,除非显式登出)
 *   cache  —— 可再生缓存/节流(不进备份;删除可清,无损)
 *   durable—— 用户数据/学习态/配置(进备份;「删除数据」要清)
 */

export interface StorageLike {
  length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 识别为「本应用的 key」的前缀(含历史三套)。 */
export const APP_PREFIXES = ['nesio-', 'nesio_', 'treasurebox-', 'baohe_', 'baohe-', 'analyst_'];

export function isAppKey(key: string): boolean {
  return APP_PREFIXES.some((p) => key.startsWith(p));
}

// 登录票据 —— 明确列举 + 模式兜底(auth/session/token/openid/access/refresh)。
const AUTH_RE = /(^|[-_])(auth|session|token|openid|access|refresh|provider)([-_]|$)|wechat_openid/i;

// 可再生缓存/节流 —— 不进备份、删除无损(与旧 full-backup EXCLUDE 合并,单一真源)。
export const CACHE_KEYS = new Set<string>([
  'nesio-email-signals-cache',
  'nesio-guidance-lang-cache-v1',
  'nesio-daily-brief-v2',
  'nesio-calendar-local-v1',
  'nesio-last-location-v1',
  'nesio-telemetry-device-v1',
  'nesio-storage-warned-at',
  'nesio-gmail-last-sync',
  'nesio-node-embeddings-v1', // legacy 向量缓存(已迁 IndexedDB)
  'nesio-ai-cache-v1',
  // 各同步引擎「自己的簿记/水位」—— 单设备本地状态,绝不该被当数据同步(否则每轮 churn 上云、
  // 且新设备被别端水位污染 → 冷启动该刷新却不刷新)。归 cache:不进备份/模块同步。
  'nesio-module-sync-state-v1',           // cloud-module-sync 每 key 上次同步哈希
  'nesio-module-sync-since-v1',           // cloud-module-sync 增量拉取水位(仅本机,不上云)
  'nesio-email-sync-state-v1',            // cloud-email-sync 每封上次同步哈希
  'nesio-backup-synced-entrycount-v1',    // cloud-backup 高水位
  'nesio-cloud-backup-last-v1',           // cloud-backup 上次推送标记
  'nesio-backup-first-sync-done-v1',      // legacy 首次同步标志
  // 单设备草稿/测试位 —— 云同步会让它们「删了又复活」(QA:草稿乱码清不掉、测试 Pro 位跨设备扩散)
  'nesio-jot-draft-v1',                   // 速记草稿:本机暂存,别跨设备回灌
  'nesio-pro-entitlement-v1',             // Lab 测试 Pro 覆盖位:绝不该同步到真设备
]);
// 注意:**不要**在这里放裸 `geo` —— 它会误伤足迹主数据键 `nesio-place-geo-v1`
// (`-geo-` 被判成缓存 → 从云备份里被剔除 → 换浏览器足迹永远同步不过去,已踩过)。
// 反向地理编码缓存靠 `cache`(nesio-revgeo-cache-v1)、地理编码开关靠 `geocode` 各自命中,
// 都不需要裸 `geo`。
const CACHE_RE = /(^|[-_])(cache|last-sync|last-location|warned-at|shown|geocode)([-_]|$)/i;

export type StorageKind = 'auth' | 'cache' | 'durable';

export function keyKind(key: string): StorageKind {
  if (AUTH_RE.test(key)) return 'auth';
  if (CACHE_KEYS.has(key) || CACHE_RE.test(key)) return 'cache';
  return 'durable';
}

// durable 但「绝不出本机」—— 即便备份也不带走。**workshop:一切数据跨端一致**,故此集合现为空:
// 按人数据/积分/地点照片/阅读高亮 都已改为**云端同步**(仅你自己的账号内、RLS 只本人可读、不进 AI),
// 由记录级模块同步覆盖,并靠 cloud-module-sync 的「反遮盖闸」(云端明显更空的值绝不覆盖本机非空值)
// 兜住,不会被清空的浏览器盖掉。保留这个机制与 isLocalOnly 接口,便于将来若要把某类数据重新钉回本机。
// 注:邮件全文(nesio-email-bodies)是**独立 IndexedDB**,不走这套 localStorage 枚举,另由
// cloud-email-sync 逐封记录级同步(见该文件),与此集合无关。
export const LOCAL_ONLY_KEYS = new Set<string>([]);

export function isLocalOnly(key: string): boolean {
  return LOCAL_ONLY_KEYS.has(key);
}

/** 现存于 storage 里的全部本应用 key。 */
export function listAppKeys(storage: StorageLike): string[] {
  const out: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && isAppKey(k)) out.push(k);
  }
  return out;
}

/** 该进备份的 key:durable(用户数据/学习态/配置)。auth/cache 不进(票据安全 + 减 bloat);
 *  local-only 也不进(敏感按人数据只存本机、不上传)。 */
export function keysForBackup(storage: StorageLike): string[] {
  return listAppKeys(storage).filter((k) => keyKind(k) === 'durable' && !isLocalOnly(k));
}

/** 单个 key 是否该进备份(供 full-backup 复用,避免两套判断漂移)。 */
export function isBackupKey(key: string): boolean {
  return isAppKey(key) && keyKind(key) === 'durable' && !isLocalOnly(key);
}

/**
 * 删除本机数据(隐私收口)。默认清 durable + cache,保留 auth(用户不被登出);
 * includeAuth=true 则连票据一起清(彻底退出 + 抹除)。返回删掉的 key。
 */
export function purgeLocalData(
  storage: StorageLike,
  { includeAuth = false }: { includeAuth?: boolean } = {},
): { removed: number; keys: string[] } {
  const victims = listAppKeys(storage).filter((k) => {
    const kind = keyKind(k);
    return kind === 'durable' || kind === 'cache' || (includeAuth && kind === 'auth');
  });
  for (const k of victims) storage.removeItem(k);
  return { removed: victims.length, keys: victims };
}
