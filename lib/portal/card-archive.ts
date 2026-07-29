/**
 * 卡片档案 —— AI 判决层的唯一监测面(设计定稿 2026-07-29,Step 1)。
 *
 * 两个清单,缺一不可:
 *   · 「说了的」(shown):每张出过的卡 + whyNow + evidence + 当时过了哪些门 + 你的改判。
 *     误报看这里的改判率(>15% = AI 判得激进,档案顶部亮警示)。
 *   · 「没说的」(declined):AI 判过但没给窗口的信号 + 理由 + 「这条该提醒我」。
 *     漏报的唯一监测面 —— 整个转向的起因就是正则漏掉家长会,没有这个清单无法验证 AI 是否重蹈覆辙。
 *
 * 双轨:lane='rules'(老管线卡,whyNow 位置记 type+priority,给影子期留对照物)/
 *       lane='shadow'(AI 影子判决,不上屏只入档)。
 * key = 源指纹(rules 卡用 factKey)。指纹永远算在源内容上,AI 改写不参与 —— v1 尸检结论。
 *
 * 上限:90 天 + shown≤400 / declined≤200 条。写失败走 storage-health(红线:不许静默吞)。
 * 跨端:整键属临时态,**不进 module-sync 整键 replace 通道**(改判 union 语义是挂账,先本机)。
 */
import { reportStorageDropped } from './storage-health';

const KEY = 'nesio-card-archive-v1';

export const ARCHIVE_MAX_DAYS = 90;
export const ARCHIVE_MAX_SHOWN = 400;
export const ARCHIVE_MAX_DECLINED = 200;
/** 改判率警示线:shown 里被判「不该出/太多」的比例超过它 → 档案顶部亮警示。 */
export const ARCHIVE_ALARM_RATIO = 0.15;

export type ArchiveLane = 'rules' | 'shadow';
export type ArchiveVerdict = 'useful' | 'too_much' | 'wrong' | 'repeat' | 'should_have_told';

export interface ArchiveShownEntry {
  id: string; // 源指纹(rules 卡 = `rules:${factKey}`)
  lane: ArchiveLane;
  group: string;
  title: string;
  body: string;
  whyNow: string;
  evidence: string[];
  severity: number;
  showFrom?: string;
  showUntil?: string;
  fingerprints?: string[];
  /** 当时会被哪些门拦(影子卡记录假想执行结果;rules 卡记实际通过 = [])。 */
  gates: string[];
  firstAt: string;
  lastAt: string;
  times: number;
  verdict?: { v: ArchiveVerdict; at: string };
}

export interface ArchiveDeclinedEntry {
  id: string; // 源指纹
  lane: ArchiveLane;
  title: string; // 信号的可读摘要
  reason: string;
  at: string;
  /** 用户点了「这条该提醒我」。 */
  wanted?: boolean;
}

interface ArchiveState {
  shown: ArchiveShownEntry[];
  declined: ArchiveDeclinedEntry[];
}

function load(): ArchiveState {
  if (typeof localStorage === 'undefined') return { shown: [], declined: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<ArchiveState> | null;
    return {
      shown: Array.isArray(raw?.shown) ? raw!.shown! : [],
      declined: Array.isArray(raw?.declined) ? raw!.declined! : [],
    };
  } catch {
    return { shown: [], declined: [] };
  }
}

function save(st: ArchiveState, now: Date): void {
  if (typeof localStorage === 'undefined') return;
  const cutoff = new Date(now.getTime() - ARCHIVE_MAX_DAYS * 86_400_000).toISOString();
  const trimmed: ArchiveState = {
    shown: st.shown.filter((e) => e.lastAt >= cutoff).slice(-ARCHIVE_MAX_SHOWN),
    declined: st.declined.filter((e) => e.at >= cutoff).slice(-ARCHIVE_MAX_DECLINED),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    reportStorageDropped(); // 红线:存储写失败必须可见,不许静默吞
  }
}

/** 记一张出过的卡。同 id 再出 = 累加 times、刷新 lastAt(不重复建条)。 */
export function archiveShownCard(
  entry: Omit<ArchiveShownEntry, 'firstAt' | 'lastAt' | 'times'>,
  now: Date = new Date(),
): void {
  if (!entry.id) return;
  const st = load();
  const at = now.toISOString();
  const hit = st.shown.find((e) => e.id === entry.id);
  if (hit) {
    hit.lastAt = at;
    hit.times += 1;
    hit.gates = entry.gates; // 门的结果随最近一次
  } else {
    st.shown.push({ ...entry, firstAt: at, lastAt: at, times: 1 });
  }
  save(st, now);
}

/** 记一批「没说的」判决(影子期主要入口)。同 id 幂等。 */
export function archiveDeclined(
  entries: Array<Omit<ArchiveDeclinedEntry, 'at'>>,
  now: Date = new Date(),
): void {
  if (entries.length === 0) return;
  const st = load();
  const at = now.toISOString();
  const known = new Set(st.declined.map((e) => e.id));
  for (const e of entries) {
    if (!e.id || known.has(e.id)) continue;
    known.add(e.id);
    st.declined.push({ ...e, at });
  }
  save(st, now);
}

/** 用户改判(说了的)。改判要能覆盖(点错了可以再点)。 */
export function recordArchiveVerdict(id: string, v: ArchiveVerdict, now: Date = new Date()): void {
  const st = load();
  const hit = st.shown.find((e) => e.id === id);
  if (!hit) return;
  hit.verdict = { v, at: now.toISOString() };
  save(st, now);
}

/** 「这条该提醒我」(没说的)。回灌为下一轮判决的口味事实。 */
export function markDeclinedWanted(id: string, now: Date = new Date()): void {
  const st = load();
  const hit = st.declined.find((e) => e.id === id);
  if (!hit) return;
  hit.wanted = true;
  save(st, now);
}

export function readArchive(): ArchiveState {
  const st = load();
  return {
    shown: [...st.shown].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)),
    declined: [...st.declined].sort((a, b) => (a.at < b.at ? 1 : -1)),
  };
}

export interface ArchiveStats {
  shownCount: number;
  verdictCount: number;
  /** 「不该出/太多/重复」占已改判的比例(不是占全部 —— 没表态不算数)。 */
  badRatio: number;
  alarm: boolean;
  /** 每组 [有用, 太多/不该出] 计数 —— 喂给判决 prompt 的口味事实。 */
  groupCounts: Record<string, [number, number]>;
  /** 「该提醒我」的漏报计数。 */
  wantedCount: number;
}

export function archiveStats(): ArchiveStats {
  const st = load();
  const groupCounts: Record<string, [number, number]> = {};
  let verdictCount = 0;
  let bad = 0;
  for (const e of st.shown) {
    if (!e.verdict) continue;
    verdictCount += 1;
    const g = e.group || '其他';
    if (!groupCounts[g]) groupCounts[g] = [0, 0];
    if (e.verdict.v === 'useful') groupCounts[g][0] += 1;
    else {
      groupCounts[g][1] += 1;
      bad += 1;
    }
  }
  const badRatio = verdictCount > 0 ? bad / verdictCount : 0;
  return {
    shownCount: st.shown.length,
    verdictCount,
    badRatio,
    alarm: verdictCount >= 5 && badRatio > ARCHIVE_ALARM_RATIO,
    groupCounts,
    wantedCount: st.declined.filter((e) => e.wanted).length,
  };
}

/** 隐私清除。 */
export function resetCardArchive(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(KEY); } catch { /* 删除失败无害 */ }
}
