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
  { key: 'nesio-health-v1', label: ['健康指标', 'Health metrics'], critical: false },
  { key: 'nesio-workouts-v1', label: ['我的训练', 'My workouts'], critical: false },
  { key: 'nesio-workout-history-v1', label: ['训练打卡', 'Workout log'], critical: false },
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

export function inventoryBackup(entries: Record<string, string>, bytes = 0): BackupInventory {
  const lines: InventoryLine[] = TRACKED.map((t) => ({
    key: t.key,
    label: t.label,
    count: countEntry(entries[t.key]),
    critical: t.critical,
  }));
  let photos = 0;
  for (const k of Object.keys(entries)) if (k.startsWith(PHOTO_PREFIX)) photos += 1;

  // 可疑 = 主数据缺失,或存在但一条都没有
  const suspect = lines.filter((l) => l.critical && (l.count == null || l.count === 0));

  return { lines, totalKeys: Object.keys(entries).length, photos, bytes, suspect };
}

/** 人话摘要:导出成功后就地给回执,让用户能一眼核对。 */
export function inventorySummary(inv: BackupInventory, dict: string): string {
  const zh = dict !== 'en';
  const parts = inv.lines
    .filter((l) => (l.count ?? 0) > 0)
    .map((l) => `${zh ? l.label[0] : l.label[1]} ${l.count}`);
  if (inv.photos > 0) parts.push(`${zh ? '照片' : 'Photos'} ${inv.photos}`);
  const mb = inv.bytes > 0 ? ` · ${(inv.bytes / 1048576).toFixed(1)} MB` : '';
  const head = zh ? '✓ 已导出到本机:' : '✓ Exported: ';
  return `${head}${parts.join(' · ')}${mb}`;
}

/** 可疑时的提醒文案(warm-coach:说清现象与出路,不吓人)。 */
export function inventoryWarning(inv: BackupInventory, dict: string): string | null {
  if (!inv.suspect.length) return null;
  const zh = dict !== 'en';
  const names = inv.suspect.map((l) => (zh ? l.label[0] : l.label[1])).join('、');
  return zh
    ? `注意:这份备份里「${names}」是空的。如果你在 App 里能看到这些内容,说明这台设备还没同步完 —— 等一会儿再导一次,或换常用的那台设备导出。`
    : `Heads up: “${names}” is empty in this backup. If you can see that data in the app, this device hasn’t finished syncing — wait a moment and export again, or export from the device you use most.`;
}
