/**
 * schedule-filters —— 日程页的一排筛选标签(2026-07-30 用户要求:
 * 「希望日程增加一排 label filter。用谷歌的 filter 先筛选,我也可以自定义」)。
 *
 * 两种来源,合成一排:
 *   ① **Google 自己的**(不用我们猜,也不用用户配):
 *      · 日历项 → 事件来自哪个日历(calendarName,Google 日历里的那些分栏);
 *      · 邮件   → Gmail 的系统分类与重要性预测(mailCategory / IMPORTANT)。
 *      这些标签**只从当前数据里长出来** —— 数据里没有的分类不给标签,
 *      不做「点了筛出 0 条」的空标签。
 *   ② **用户自定义**:一个名字 + 一个关键词,对标题和副行(发件人 / 地点 / 日历名)匹配。
 *      故意做得笨而透明 —— 用户能预测它会筛出什么。不做隐式语义匹配:
 *      那正是这个仓库反复踩坑的地方(「健身」被认成健康打卡)。
 *
 * 存的是**定义**,不是当前选中项 —— 选中项每次进页面重置,免得用户忘了自己还开着筛选、
 * 以为数据丢了。
 */

import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';

export const SCHEDULE_FILTERS_KEY = 'nesio-schedule-filters-v1';
export const SCHEDULE_FILTERS_EVENT = 'nesio-schedule-filters-updated';

export interface CustomFilter {
  id: string;
  /** 显示在标签上的名字 */
  name: string;
  /** 匹配用的关键词(对标题 + 副行,不区分大小写)。 */
  keyword: string;
  createdAt: string;
}

const store = createBlobStore<CustomFilter[]>({
  key: SCHEDULE_FILTERS_KEY,
  updateEvent: SCHEDULE_FILTERS_EVENT,
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

export function scheduleFiltersReady(): Promise<void> {
  return store.ready().then(() => undefined);
}

export function listCustomFilters(): CustomFilter[] {
  const raw = store.load();
  return Array.isArray(raw) ? raw.filter((f) => f && f.id && f.name && f.keyword) : [];
}

export function addCustomFilter(name: string, keyword: string): CustomFilter | null {
  const n = name.trim();
  const k = keyword.trim();
  if (!n || !k) return null;
  const f: CustomFilter = {
    id: `sf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: n, keyword: k, createdAt: new Date().toISOString(),
  };
  store.save([...listCustomFilters(), f].slice(0, 24));
  return f;
}

/**
 * 改一个已有的筛选(2026-07-31 用户:「如果确实不管用,我希望可以修改,现在不行」)。
 *
 * 以前只能删了重建 —— 而删除是长按/右键触发的,手机上长按还常常被系统的文本选择抢走。
 * 于是一个建错了的筛选事实上是**改不掉也删不掉**的。
 *
 * 名字和关键词都可选:只想改关键词就别动名字。
 * 传空串视为「没改这一项」——真要清空一个筛选的关键词是没有意义的(那它谁也匹配不到),
 * 与其存一个废筛选,不如当作没改。
 */
export function updateCustomFilter(id: string, patch: { name?: string; keyword?: string }): CustomFilter | null {
  const all = listCustomFilters();
  const i = all.findIndex((f) => f.id === id);
  if (i < 0) return null;
  const cur = all[i] as CustomFilter;
  const name = (patch.name ?? '').trim() || cur.name;
  const keyword = (patch.keyword ?? '').trim() || cur.keyword;
  const next: CustomFilter = { ...cur, name, keyword };
  all[i] = next;
  store.save(all);
  return next;
}

export function removeCustomFilter(id: string): void {
  store.save(listCustomFilters().filter((f) => f.id !== id));
}

/* ── 纯判定(可单测,不碰存储/DOM)────────────────────────────────────── */

/** 一条日程/邮件在筛选眼里长什么样。 */
export interface FilterableRow {
  title: string;
  /** 副行:发件人 / 地点 / 日历名 */
  meta: string;
  /**
   * 这一行**屏幕上还看得见的其它字**:状态行(「扣款 · $662.59」「已付款」)、
   * 右下角徽章(「账单」「私人」「有附件」)。
   *
   * 2026-07-31 补(用户实测:自定义筛选「扣款」命中 0,而列表里明明有一条写着
   * 「扣款 · $662.59」)。根因是这些字是**派生出来展示的**(mail-badges 从
   * moneyFlow / orderStatus 算),既不在标题里也不在发件人里 ——
   * 于是屏幕上有的字,搜不到。
   *
   * 判据是**看得见就搜得到**,不是「把所有字段都塞进来」:
   * 正文预览(body)刻意不进 —— 它在屏幕上是折起来的,拿它匹配会筛出一堆
   * 用户看不出为什么会命中的行,那比漏筛更难排查。
   */
  extra?: string;
  /** Google 给的标签(日历名 / mailCategory / 重要),原样带过来 */
  googleLabels: readonly string[];
}

/** 一个标签:来自 Google 的用 google,用户自己建的用 custom。 */
export type FilterChip =
  | { kind: 'google'; id: string; label: string; count: number }
  | { kind: 'custom'; id: string; label: string; count: number; keyword: string };

export function matchesCustom(row: FilterableRow, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return false;
  // 标题 + 副行 + 屏幕上看得见的其它字。三者就是这一行的**可见面**。
  return `${row.title} ${row.meta} ${row.extra || ''}`.toLowerCase().includes(k);
}

export function matchesChip(row: FilterableRow, chip: FilterChip): boolean {
  return chip.kind === 'google'
    ? row.googleLabels.includes(chip.id)
    : matchesCustom(row, chip.keyword);
}

/**
 * 把当前这批行 + 用户的自定义筛选,合成一排标签。
 *
 * 红线:**只给筛得出东西的标签**(count > 0)。一个点下去出现空列表的标签,
 * 比没有这个标签更糟 —— 用户会以为数据没了。
 * Google 标签按命中数从多到少;自定义的按创建顺序排在后面(那是用户自己的次序)。
 */
export function buildChips(rows: readonly FilterableRow[], customs: readonly CustomFilter[]): FilterChip[] {
  const counts = new Map<string, number>();
  for (const r of rows) for (const g of r.googleLabels) counts.set(g, (counts.get(g) || 0) + 1);

  const google: FilterChip[] = [...counts.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ kind: 'google', id, label: id, count }));

  const custom: FilterChip[] = customs
    .map((f) => ({
      kind: 'custom' as const,
      id: f.id,
      label: f.name,
      keyword: f.keyword,
      count: rows.filter((r) => matchesCustom(r, f.keyword)).length,
    }))
    // 自定义标签**保留 0 命中**:那是用户亲手建的东西,悄悄藏起来他会以为丢了。
    // (与 Google 标签不同 —— 那些是系统长出来的,没有就是没有。)
    .filter((c) => c.label);

  return [...google, ...custom];
}
