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

// 凭证 —— 明确列举 + 模式兜底。**绝不进备份文件、绝不上云。**
// 2026-07-29 安全审计:两个真凭证键此前被判成 durable(= 进备份 JSON + 走模块同步上云):
//   · nesio-connector-tokens-v1 —— Notion/Tesla 等连接器的原始令牌。正则写的是 `token([-_]|$)`,
//     而键名是复数 `tokens-v1` → 不匹配。改 `tokens?`。
//   · nesio_admin_secret —— /admin 管理密钥。正则里压根没有 `secret` 这个词。
// 教训:凭证识别靠"猜词"必然漏;下面既扩正则,也给一张明确的名单兜底。
export const AUTH_KEYS = new Set<string>([
  'nesio-connector-tokens-v1',  // 连接器原始令牌(Gmail/日历/Notion 走 Supabase 按身份跨端,本机这份是镜像)
  'nesio_admin_secret',         // /admin 管理密钥
  'nesio-plaid-link-token',     // Plaid Link 一次性 token
  'nesio-auth-intent-v1',       // 登录意图暂存
]);
const AUTH_RE = /(^|[-_])(auth|session|tokens?|openid|access|refresh|provider|secrets?|credentials?|apikey)([-_]|$)|wechat_openid/i;

// 可再生缓存/节流 —— 不进备份、删除无损(与旧 full-backup EXCLUDE 合并,单一真源)。
export const CACHE_KEYS = new Set<string>([
  // IDB 迁移的按设备簿记(2026-07-30 合并 main 后补登记):每台设备各自迁各自的,
  // 跨端同步这两个键只会让新设备以为「已经迁过了」而跳过迁移。
  'nesio-migration-completed-v1',
  'nesio-migration-log-v1',
  'nesio-email-signals-cache',
  // 车的电量时间线:2026-08-10 改为 durable(IDB)+module-sync,换端可见稀疏采样。
  // 低电量「已通知」仍是本机 cache。
  'nesio-tesla-low-batt-notified-v1',
  // 本地曲库的**元数据**与播放位置(2026-07-30 音乐模块)。都判 cache,理由是同一个:
  // 音频本体在 IndexedDB、**不进备份**(几百 MB 的备份 JSON 没有意义),
  // 把列表同步到另一台设备只会得到一份点了放不出声的假曲库 —— 比没有更糟。
  // 判据原句:「换台设备从零开始是否正确?」—— 正确,因为文件本来就没过去。
  'nesio-music-local-tracks-v1',
  'nesio-music-last-played-v1',
  // 记忆事件日 createdAt 一次性回填完成标记 —— 换设备可再跑一次无害。
  'nesio-memory-event-at-backfill-v1',
  'nesio-guidance-lang-cache-v1',
  // 语音简报的遗留缓存(功能 2026-07-30 已删)。**故意留在这张表里**:老设备的
  // localStorage 里可能还躺着这个值,一旦从 CACHE_KEYS 拿掉,keyKind() 的默认值是
  // durable —— 它会立刻开始进备份、上云同步。留着 = 继续当缓存、继续被清掉。
  // 「例行提醒」的遗留数据(功能 2026-07-31 已删,能力并进 schedule-reminders)。
  // **故意留在这张表里**,同 daily-brief-v2:老设备的 localStorage 里可能还躺着它,
  // 一旦不在册,keyKind() 的默认值是 durable —— 它会立刻开始进备份、上云同步。
  'nesio-routines-v1',
  'nesio-daily-brief-v2',
  // 提醒 → 系统通知的排程投影(2026-07-31)。判据原句:「换台设备从零开始是否正确?」
  // —— 正确。iOS 的 pending 通知是**这台设备**的东西,旧手机排过什么和新手机毫无关系;
  // 真相在 nesio-schedule-reminders-v1 里,新设备回前台自己会重排一遍。
  'nesio-reminder-notify-state-v1',
  // 时间线/焦点/日报/回顾 → 系统通知排程投影(同 reminder-notify:设备本地,回前台重排)。
  'nesio-surface-notify-state-v1',
  'nesio-focus-notify-dismissed-v1',
  'nesio-notify-deep-links-v1',
  // HealthKit 自动同步的日期簿记 —— 单设备本地状态,同步过去只会让新设备以为已经拉过。
  'nesio-healthkit-auto-sync-v1',
  // 「让 iOS 系统搜索找得到我的记忆」开关(Core Spotlight,2026-07-31)。
  // 索引在**这台设备**的系统搜索库里,换台手机上面什么都没有 ——
  // 开关同步过去会造出「显示开着、实际没索引」的假状态。
  'nesio-spotlight-enabled-v1',
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
  'nesio-module-sync-last-at',            // cloud-module-sync 节流(localStorage 主读,跨 WKWebView 杀进程)
  'nesio-dict-ai-enabled-v1',             // 词典 AI 查词开关:按设备偏好,换端从默认(关)开始
  'nesio-dict-enrich-cache-v1',           // 词典详情 AI 补全缓存:可丢,换端从零补即可
  // nesio-wardrobe-body-v1 / body-ids-v1 → durable(换端要带着全身照清单,图在 IDB 经 wardrobe-image-sync)
  'nesio-rel-nudge-dismissed-v1',         // 关系页绿提示关闭日键:本机 UI 状态
  'nesio-email-sync-state-v1',            // cloud-email-sync 每封上次同步哈希
  'nesio-backup-synced-entrycount-v1',    // cloud-backup 高水位
  'nesio-cloud-backup-last-v1',           // cloud-backup 上次推送标记
  'nesio-backup-first-sync-done-v1',      // legacy 首次同步标志
  // 单设备草稿/测试位 —— 云同步会让它们「删了又复活」(QA:草稿乱码清不掉、测试 Pro 位跨设备扩散)
  // 「今天看没看过简报」的日键。cache —— 这是这台机器上的 UI 状态,
  // 不是用户数据;换台设备第一次打开时重新提示一遍,正是对的行为。
  // 悬浮播放球被拖到了哪。cache:换台设备回到默认角正是对的行为。
  'nesio-fp-pos-v1',
  'nesio-daily-brief-seen-v1',
  // 每日日报卡片「今天先不看」的日键——同上一条,同一类 UI 状态。
  'nesio-daily-report-card-dismiss-v1',
  'nesio-jot-draft-v1',                   // 速记草稿:本机暂存,别跨设备回灌
  'nesio-pro-entitlement-v1',             // Lab 测试 Pro 覆盖位:绝不该同步到真设备
  // AI 判决层(2026-07-29 硬拆后新增)。三个都是**按设备**的簿记,不是用户数据:
  'nesio-guidance-judge-ledger-v1',       // 判决账本(已判指纹+卡):整键 replace 会让两端互相
                                          //   抹掉对方的判决;各判各的成本可接受,数据错乱不可接受
  'nesio-judge-dismissed-v1',             // 「知道了」当日日键静默:今天的事,明天自动失效
  'nesio-push-enabled-v1',                // 推送开关:**每个浏览器**自己的订阅,跨端同步会让
                                          //   别的设备显示"已开"却收不到推送(它没订阅)
  'nesio-local-notify-enabled-v1',        // 本机系统通知总开关(权限在这台设备)
  'nesio-local-notify-welcomed-v1',       // 接通后的一次性自检通知,换设备可再响一次
  'nesio-chore-notify-state-v1',          // 家庭家务通知排程投影,同 reminder-notify-state
  'nesio-storage-heal-v1',                // 一次性自愈的完成标记
  // 档案是**观测面**,不是用户数据:整键 replace 同步会让两端互相抹掉对方的记录(静默丢反馈)。
  // 真正承重的那部分(静音裁决)另走 nesio-card-verdict-v1(durable,跨端跟人走)。
  // 代价如实:换设备/重装后档案从零开始 —— 90 天滚动窗的观测面,可接受。
  'nesio-card-archive-v1',
  // ── 2026-07-29 全量普查补登:以下**全是按设备的簿记或日键 UI 状态**,此前默认 durable,
  //    意味着它们进备份、并被当用户数据整键 replace 同步 —— 既是无谓 churn,也会两端互抹。
  //    (判据:换台设备后这个值"从头开始"是否**正确**?是 → cache。)
  'nesio-chunk-reload', 'nesio-chunk-reload-at', 'nesio-version-reload',   // 加载失败/版本重载标记
  'nesio-connectors-autosync-at-v1',                                       // 自动同步节流水位
  'nesio-bank-synced-at', 'nesio-drive-backup-at', 'nesio-last-backup-at', // 各同步的"上次时间"
  'nesio-place-image-sync-state-v1', 'nesio-reader-sync-state-v1',         // 同步簿记(同 email-sync-state)
  'nesio-wardrobe-image-sync-state-v1', 'nesio-file-sync-state-v1',        // 同步簿记(衣帽间照片/文件附件)
  'nesio-care-image-sync-state-v1',                                       // 照料附件图同步簿记
  'nesio-life-graph-cloud-sync-v1', 'nesio-life-graph-cloud-sync-outbox-v1', // 云同步水位与待发队列
  'nesio-family-strip-fetch-at-v1',                                        // 取数节流
  'nesio-family-strip-fetch-day-v1',                                       // 家务板「今天拉过了」日键
  'nesio-plaid-enrich-v1',                                                 // 一次性全量回填标记
  'nesio-pending-ask-image', 'nesio-pending-ask-text',                     // 待发问暂存(会话级)
  'nesio-storage-alert-snooze-v1',                                         // 存储告警节流
  'nesio-server-entitlement-v1',                                           // 服务端权益缓存(跨端各自问服务端)
  'nesio-today-cards-v1', 'nesio-today-dismissed-v1',                      // 今天页日键卡片状态
  'nesio-focus-dismissed-v1', 'nesio-proactive-dismissed',                 // 当天收起(用户裁决另走 card-verdict)
  'nesio-xlib-draft-v1',                                                   // 动作库草稿(同 jot-draft:本机暂存)
  'nesio-heal-earned', 'nesio-wrapped-last',                               // 日键计分 / 上次展示
  'nesio-a2hs-dismissed-until', 'nesio-ask-guide-seen-v1', 'nesio-retro-dismissed-v1', // UI 一次性标记
  // 明确匿名清库后的 sessionStorage 闸(防隐私模式/重复 reload)。本会话簿记,换设备从零正确。
  'nesio-signed-out-purged',
]);
// 注意:**不要**在这里放裸 `geo` —— 它会误伤足迹主数据键 `nesio-place-geo-v1`
// (`-geo-` 被判成缓存 → 从云备份里被剔除 → 换浏览器足迹永远同步不过去,已踩过)。
// 反向地理编码坐标格 → 真实地名,持久化 IDB(durable),非 localStorage 缓存 tier。
// 都不需要裸 `geo`。
const CACHE_RE = /(^|[-_])(cache|last-sync|last-location|warned-at|shown|geocode)([-_]|$)/i;

/** 键名带 cache 但内容是地址事实(反查地名),应 durable + IDB —— 不能走 cache tier。 */
const DURABLE_OVERRIDES = new Set(['nesio-revgeo-cache-v1']);

export type StorageKind = 'auth' | 'cache' | 'durable';

export function keyKind(key: string): StorageKind {
  if (AUTH_KEYS.has(key) || AUTH_RE.test(key)) return 'auth';
  if (DURABLE_OVERRIDES.has(key)) return 'durable';
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
