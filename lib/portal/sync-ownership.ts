/**
 * 同步归属登记(单一真源)—— 谁负责同步哪份数据。根治「多引擎抢同一份数据」。
 *
 * 背景(数据链审计根因):此前 profile 身份键、学习态键、记忆图 都**同时**被
 *  ① 通用记录级同步 cloud-module-sync(整键 replace)
 *  ② 各自的专属引擎(profile-sync 身份 LWW / learning-sync 无损 union / memory-sync 逐节点 union)
 * 两套抢着写,判据互不相同、落地无锁并发 → 换端头像/名字/学习态反复横跳、偶发回退。
 *
 * 纪律(以后加功能照此办,不要每个功能自己一套):
 *  - **默认**:一个 durable 的 `nesio-*` / `treasurebox-*` key,或一个登记过的 IDB blob,
 *    **自动**走通用 module-sync 上云(私有、跨端、按身份隔离)。加新功能 = 加一个 durable key,
 *    零同步代码。
 *  - **专属引擎**:少数数据有特殊合并语义(记忆图 union、身份 LWW、学习态 union),它们由专属引擎
 *    负责。**在此登记它们的 key**,通用引擎据此**让路**(不重复搬运),避免两套语义打架。
 *
 * 这里只声明「归属」,不实现同步。通用引擎(cloud-module-sync)import 本文件做排除判断。
 */
import { EMAIL_BODY_MODULE_PREFIX } from './cloud-email-sync';

/** 由专属引擎负责同步的具体 key —— 通用 module-sync 必须让路(不重复搬运)。 */
export const DEDICATED_SYNC_KEYS = new Set<string>([
  // 记忆图:signals 表逐节点 union(cloud-memory-sync)。整键 replace 会冲掉 union + 复活已删节点。
  'nesio-life-graph-v1',
  // 头像/名字/语言/教练/主题/日报:profile_settings 身份 LWW(cloud-profile-sync,按「编辑时刻」判胜负)。
  'treasurebox-profile-name',
  'treasurebox-profile-avatar',              // 头像 dataURL 本地缓存(由 avatarStoragePath 换签重建,不另同步)
  'treasurebox-profile-avatar-storage-path', // 头像资产指针(profile_settings 携带)
  'treasurebox-profile-updated-at',          // 身份 LWW 时间戳
  'treasurebox-locale',
  'treasurebox-coach-style',
  'treasurebox-theme',
  'nesio-daily-report-enabled',
  // 学习态:assets learning blob 无损 union(cloud-learning-sync)。整块 replace 会把 union 打回单端旧副本。
  'nesio-ranker-trainlog-v1',
  'nesio-preference-v1',
]);

/** 由专属引擎负责的 key 前缀(通用 module-sync 让路)。 */
export const DEDICATED_SYNC_PREFIXES: readonly string[] = [
  EMAIL_BODY_MODULE_PREFIX, // 邮件全文逐封行(cloud-email-sync)。
];

/** 该 key 是否由某个专属引擎负责同步 → 通用 module-sync 应跳过它。 */
export function isDedicatedSyncKey(key: string): boolean {
  if (DEDICATED_SYNC_KEYS.has(key)) return true;
  return DEDICATED_SYNC_PREFIXES.some((p) => key.startsWith(p));
}
