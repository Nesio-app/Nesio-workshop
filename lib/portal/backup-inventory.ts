/**
 * backup-inventory —— 导出/备份的「装箱单」。
 *
 * 由来(2026-07-29):导出一份备份后,界面只说「✓ 已导出到本机」,用户无从知道
 * 里面到底装没装全。一次预测回测发现导出的流水条数与 App 里看到的对不上,
 * 才暴露出这个盲区 —— 而「随时导出你的全部数据」是我们对用户的承诺,
 * **一个无法验证的承诺等于没有承诺**(换设备时才发现漏了,已经晚了)。
 *
 * 这里只做纯计算:给一份备份,数清各主数据有多少条、总共多大、有没有该有却空着的。
 * 不碰存储、不发网络,可单测。
 */

export interface InventoryLine {
  key: string;
  label: [string, string]; // [zh, en]
  /** 条数;null = 这个键根本不在备份里 */
  count: number | null;
  /** 主数据:缺失或为 0 时要显式警告(其余只是没用过那个功能,正常) */
  critical: boolean;
}

export interface BackupInventory {
  lines: InventoryLine[];
  /** 备份里的键总数(含没列进清单的小配置) */
  totalKeys: number;
  /** 照片数(local-image: 前缀,单独计) */
  photos: number;
  bytes: number;
  /** 主数据里「缺失或 0 条」的行 —— 非空即代表这份备份可疑 */
  suspect: InventoryLine[];
}

/** 主数据清单。critical 的判据:用户真正会心疼丢失的东西。 */
const TRACKED: Array<{ key: string; label: [string, string]; critical: boolean }> = [
  { key: 'nesio-life-graph-v1', label: ['记忆', 'Memories'], critical: true },
  { key: 'nesio-bank-tx-v1', label: ['银行流水', 'Bank transactions'], critical: true },
  { key: 'nesio-bank-accounts-v1', label: ['银行账户', 'Bank accounts'], critical: false },
  { key: 'nesio-expenses-v1', label: ['手动记账', 'Manual entries'], critical: false },
  { key: 'nesio-fin-assets-v1', label: ['手动资产', 'Manual assets'], critical: false },
  { key: 'nesio-fin-networth-series-v1', label: ['净值快照', 'Net-worth snapshots'], critical: false },
  { key: 'nesio-place-trail-v1', label: ['地点足迹', 'Place trail'], critical: false },
  { key: 'nesio-calendar-local-v1', label: ['日历', 'Calendar'], critical: false },
  { key: 'nesio-health-v1', label: ['健康指标', 'Health metrics'], critical: false },
  { key: 'nesio-workouts-v1', label: ['我的训练', 'My workouts'], critical: false },
  { key: 'nesio-workout-history-v1', label: ['训练打卡', 'Workout log'], critical: false },
];

/**
 * 各 API 导入源的**取数窗口**(2026-07-29 逐个源查代码得出)。
 * 这不是 bug 清单,是事实清单 —— 但合在一起会得到一个反直觉的结论:
 * 一个把「回溯 > 预测」写进公理的 App,导进来的数据大部分只有「最近」和「未来」。
 * 用户看到某个板块"内容很少"时,先对这张表,而不是先怀疑同步坏了。
 */
export const IMPORT_WINDOWS: Array<{
  source: [string, string];
  window: [string, string];
  /** true = 存在历史回填路径;false = 结构上拿不到更早的数据 */
  canBackfill: boolean;
}> = [
  { source: ['银行流水 · Plaid', 'Bank · Plaid'], window: ['首次全量回填(上限 5000 笔),之后增量', 'Full backfill (5000 cap), then incremental'], canBackfill: true },
  { source: ['投资流水 · Plaid', 'Investments · Plaid'], window: ['近 24 个月(transactions 产品不覆盖投资账户,另走 investments)', 'Last 24 months (separate product)'], canBackfill: true },
  { source: ['日历 · Google', 'Calendar · Google'], window: ['**只拉未来 90 天**,不拉任何过去', '**Next 90 days only** — no past events'], canBackfill: false },
  { source: ['邮件 · Gmail', 'Mail · Gmail'], window: ['首次近 30 天,之后增量', 'First sync: last 30 days, then incremental'], canBackfill: false },
  { source: ['会议 · Granola', 'Meetings · Granola'], window: ['最多近 30 天(接口只接受 this_week/last_week/last_30_days)', 'Max last 30 days (API offers no wider range)'], canBackfill: false },
  { source: ['健康 · Apple Health', 'Health · Apple Health'], window: ['导出文件里有多少就有多少(全历史)', 'Whatever the export file contains (full history)'], canBackfill: true },
  { source: ['足迹 · 实时/时间轴导入', 'Places · live + Timeline import'], window: ['实时点靠后台定位;历史靠手动导入 Google 时间轴 JSON', 'Live pings + manual Google Timeline JSON import'], canBackfill: true },
];

const PHOTO_PREFIX = 'local-image:';

/** 数一个条目里有多少条记录;非数组(对象型配置)记 1,解析失败记 null。 */
function countEntry(raw: string | undefined): number | null {
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') return Object.keys(v as object).length;
    return 1;
  } catch {
    return null;
  }
}

/**
 * 记忆图已按年分片(`nesio-life-graph-v1:2024` 等);装箱单若只看整图键会误报「记忆是空的」。
 * 分片优先求和;无分片再回退整图键。
 */
function countLifeGraph(entries: Record<string, string>): number | null {
  let shardTotal = 0;
  let hasShard = false;
  for (const [k, v] of Object.entries(entries)) {
    if (!k.startsWith('nesio-life-graph-v1:')) continue;
    if (k === 'nesio-life-graph-v1:index') continue;
    hasShard = true;
    const n = countEntry(v);
    if (n != null) shardTotal += n;
  }
  if (hasShard) return shardTotal;
  return countEntry(entries['nesio-life-graph-v1']);
}

export function inventoryBackup(entries: Record<string, string>, bytes = 0): BackupInventory {
  const lines: InventoryLine[] = TRACKED.map((t) => ({
    key: t.key,
    label: t.label,
    count: t.key === 'nesio-life-graph-v1' ? countLifeGraph(entries) : countEntry(entries[t.key]),
    critical: t.critical,
  }));
  let photos = 0;
  for (const k of Object.keys(entries)) if (k.startsWith(PHOTO_PREFIX)) photos += 1;

  // 可疑 = 主数据缺失,或存在但一条都没有
  const suspect = lines.filter((l) => l.critical && (l.count == null || l.count === 0));

  return { lines, totalKeys: Object.keys(entries).length, photos, bytes, suspect };
}

/** 人话摘要:导出成功后就地给回执,让用户能一眼核对。照片数始终报出(含 0)。 */
export function inventorySummary(inv: BackupInventory, dict: string): string {
  const zh = dict !== 'en';
  const parts = inv.lines
    .filter((l) => (l.count ?? 0) > 0)
    .map((l) => `${zh ? l.label[0] : l.label[1]} ${l.count}`);
  parts.push(`${zh ? '照片' : 'Photos'} ${inv.photos}`);
  const mb = inv.bytes > 0 ? ` · ${(inv.bytes / 1048576).toFixed(1)} MB` : '';
  const head = zh ? '✓ 备份装箱:' : '✓ Backup pack: ';
  return `${head}${parts.join(' · ')}${mb}`;
}

/**
 * @param localPhotoCount 本机图库实际张数。若本机有图但备份里 0 张 → 明确警告不完整。
 */
export function inventoryWarning(
  inv: BackupInventory,
  dict: string,
  opts?: { localPhotoCount?: number },
): string | null {
  const zh = dict !== 'en';
  const bits: string[] = [];
  if (inv.suspect.length) {
    const names = inv.suspect.map((l) => (zh ? l.label[0] : l.label[1])).join('、');
    bits.push(zh
      ? `「${names}」是空的。若 App 里还能看到,多半这台还没同步完 —— 等一会儿再导,或换常用设备。`
      : `“${names}” is empty. If you still see it in the app, this device may not have finished syncing — wait and export again, or use your usual device.`);
  }
  const localPhotos = opts?.localPhotoCount;
  if (typeof localPhotos === 'number' && localPhotos > 0 && inv.photos === 0) {
    bits.push(zh
      ? `本机有 ${localPhotos} 张照片,但这份备份里一张都没有 —— 换机后图会丢。请重试导出/备份;仍不行先「一键腾空间」后再试。`
      : `This device has ${localPhotos} photos, but none are in this backup — they would be lost on a new phone. Retry export/backup; if it still fails, free up space and try again.`);
  }
  return bits.length ? (zh ? `注意:${bits.join(' ')}` : bits.join(' ')) : null;
}
