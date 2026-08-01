/**
 * periodic-report —— 每周 / 每月的回顾与计划(2026-08-01 用户拍板扩展)。
 *
 * 复用每日日报已经打好的地基,不重新造轮子:
 *   · **回顾**(过去发生的):把这一期已经落库的每日日报(daily-report-persist.
 *     listDailyReports)摞起来 —— 每日那份已经是「过滤过、值得说」的内容,
 *     周报/月报只做汇总(标题列表 + 各域出现次数),不回头重新取数。
 *     另加「这一期做完的提醒/家务」(schedule-reminders.listCompleted)。
 *   · **计划**(要发生的):日历/提醒里落在这一期窗口内的项 + 还没接上的线头
 *     (loose-threads)。不猜、不编——只列**已经确定**会落在这个窗口的事,
 *     和日报「往前看」段同一条红线。
 *
 * 生成时机同日报:每次回前台检查一次,过了这一期的锚点(周一 8 点 / 每月 1 日
 * 8 点)且这一期还没生成过 → 生成并冻结落库,同一期内不再变。
 *
 * 「回顾」和「计划」虽然锚点相同,但**窗口方向相反**:
 *   · 周一 8 点到的是「上一周(刚结束的周一到周日)」的回顾,和「这一周(今天到
 *     周日)」的计划——两份内容不一样,periodKey 也不一样。
 *   · 月度同理:月初到的是上个月的回顾 + 这个月的计划。
 *
 * 存储:落成记忆节点(kind: 'periodic-report'),period ('week'|'month') +
 * direction('retrospect'|'plan') + periodKey 幂等,和日报同一套写法
 * (ingestLifeNode + externalId,同一期重生成原地更新)。
 */
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { getLifeGraph, type LifeNode } from './life-graph';
import { listCompleted, listReminders } from './schedule-reminders';
import { looseThreads } from './loose-threads';
import type { DailyReport, DailyReportSection } from './daily-report';
import { listDailyReports } from './daily-report-persist';

export type PeriodKind = 'week' | 'month';
export type PeriodDirection = 'retrospect' | 'plan';

const TAGS = ['周期报告', 'AI'];
const pad = (n: number) => String(n).padStart(2, '0');
function dateKey(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** ISO 8601 周键(周一起始),如 `2026-W31`。 */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // ISO 周四所在的那一周决定年份归属。
  const dayNum = (t.getUTCDay() + 6) % 7; // 周一=0
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${pad(week)}`;
}

/** 年月键,如 `2026-08`。 */
export function monthKey(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }

function periodKeyOf(kind: PeriodKind, d: Date): string { return kind === 'week' ? isoWeekKey(d) : monthKey(d); }

/** 这一周的周一 00:00(本地)。 */
function mondayOf(d: Date): Date {
  const r = new Date(d);
  const dow = (r.getDay() + 6) % 7; // 周一=0
  r.setDate(r.getDate() - dow);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** 锚点:本周一 08:00(周)/ 本月 1 日 08:00(月)。到点才生成,和日报同一口径。 */
export function periodAnchor(kind: PeriodKind, now: Date): Date {
  if (kind === 'week') {
    const a = mondayOf(now);
    a.setHours(8, 0, 0, 0);
    return a;
  }
  const a = new Date(now.getFullYear(), now.getMonth(), 1, 8, 0, 0, 0);
  return a;
}

export function periodDue(kind: PeriodKind, now: Date): boolean {
  return now.getTime() >= periodAnchor(kind, now).getTime();
}

/** [起, 止) 窗口。回顾看**上一期**,计划看**这一期**。 */
function windowOf(kind: PeriodKind, direction: PeriodDirection, now: Date): { start: Date; end: Date } {
  const anchor = periodAnchor(kind, now);
  if (kind === 'week') {
    const start = new Date(anchor); start.setHours(0, 0, 0, 0);
    if (direction === 'retrospect') start.setDate(start.getDate() - 7);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return { start, end };
  }
  const y = anchor.getFullYear(), m = anchor.getMonth();
  if (direction === 'retrospect') {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    return { start, end };
  }
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1);
  return { start, end };
}

/** 这一份该落哪个 periodKey——回顾用窗口起点(上一期),计划用窗口起点(这一期)。两者天然一致。 */
function externalIdOf(kind: PeriodKind, direction: PeriodDirection, now: Date): string {
  const { start } = windowOf(kind, direction, now);
  return `periodic-report-${kind}-${direction}-${periodKeyOf(kind, start)}`;
}

function fmtRange(kind: PeriodKind, start: Date, end: Date, locale: 'zh' | 'en'): string {
  const endIncl = new Date(end.getTime() - 1);
  if (kind === 'week') {
    return locale === 'en'
      ? `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${endIncl.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : `${start.getMonth() + 1}月${start.getDate()}日 – ${endIncl.getMonth() + 1}月${endIncl.getDate()}日`;
  }
  return locale === 'en'
    ? start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : `${start.getFullYear()}年${start.getMonth() + 1}月`;
}

/** 已落库的每日日报节点的最小形状(和 daily-report-persist.listDailyReports 输入同源)。 */
type ReportNode = { name?: string; rawInput?: string; attributes?: Record<string, unknown>; createdAt?: string };

/**
 * 回顾:把窗口内已落库的每日日报摞起来 + 这一期做完的提醒。
 *
 * **不重新取数**——每日日报本身已经是筛过的内容,这里只做汇总统计
 * (各域出现次数是从每日日报存的 insights JSON 里数出来的,不是重新跑一遍判定)。
 */
export function buildRetrospect(
  kind: PeriodKind,
  nodes: ReadonlyArray<ReportNode>,
  now: Date,
  locale: 'zh' | 'en' = 'zh',
): DailyReport {
  const { start, end } = windowOf(kind, 'retrospect', now);
  const periodKey = periodKeyOf(kind, start);
  const inWindow = (dstr: string) => {
    const d = new Date(`${dstr}T12:00:00`);
    return !Number.isNaN(d.getTime()) && d.getTime() >= start.getTime() && d.getTime() < end.getTime();
  };

  const dailies = listDailyReports(nodes).filter((r) => inWindow(r.date));
  const completed = listCompleted().filter((c) => {
    const d = new Date(c.at);
    return !Number.isNaN(d.getTime()) && d.getTime() >= start.getTime() && d.getTime() < end.getTime();
  });

  // 各域被提到几次——从每日日报存的原始判定集(attributes.insights)里数,纯计数,不叙事。
  const tally = new Map<string, number>();
  for (const n of nodes) {
    if (n.attributes?.kind !== 'daily-report' || typeof n.attributes?.date !== 'string' || !inWindow(n.attributes.date)) continue;
    const raw = n.attributes?.insights;
    if (typeof raw !== 'string' || !raw) continue;
    try {
      const parsed = JSON.parse(raw) as Array<{ domain?: string }>;
      for (const it of parsed) { if (it?.domain) tally.set(it.domain, (tally.get(it.domain) ?? 0) + 1); }
    } catch { /* 存坏的一条不影响别的域计数 */ }
  }

  const sections: DailyReportSection[] = [];
  if (completed.length) {
    sections.push({
      id: 'completed',
      title: locale === 'en' ? 'Done' : '做完的',
      lines: completed.slice(0, 8).map((c) => `${c.title}`),
    });
  }
  if (dailies.length) {
    sections.push({
      id: 'domain',
      title: locale === 'en' ? 'Day by day' : '这一期的日子',
      lines: dailies.map((d) => `${d.date.slice(5)} · ${d.headline}`),
    });
  }
  if (tally.size) {
    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    sections.push({
      id: 'tally',
      title: locale === 'en' ? 'Mentioned' : '各面被提到',
      lines: sorted.map(([domain, n]) => `${domain} · ${n}${locale === 'en' ? ' time(s)' : ' 次'}`),
    });
  }

  const rangeLabel = fmtRange(kind, start, end, locale);
  const empty = sections.length === 0;
  const title = kind === 'week'
    ? (locale === 'en' ? `Weekly review · ${rangeLabel}` : `每周回顾 · ${rangeLabel}`)
    : (locale === 'en' ? `Monthly review · ${rangeLabel}` : `每月回顾 · ${rangeLabel}`);
  const headline = empty
    ? (locale === 'en' ? 'Quiet stretch — nothing flagged.' : '这一期比较安静,没有特别要提的。')
    : (locale === 'en' ? `${dailies.length} day(s) with something worth a look` : `${dailies.length} 天有值得一看的内容`);
  const markdown = sections.map((s) => `## ${s.title}\n${s.lines.map((l) => `- ${l}`).join('\n')}`).join('\n\n');

  return { date: periodKey, title, greeting: '', headline, sections, markdown, empty };
}

/**
 * 计划:窗口内已确定的日历项 + 到期提醒 + 还没接上的线头。
 *
 * 和日报「往前看」段同一条红线——只放**已知**会落在这个窗口的事,不推测、不猜
 * 「你可能想做什么」。「线头」是唯一例外(见 loose-threads.ts 的注释:那是用户
 * 自己说过想做、却一直没动的事,不是 Nesio 替他决定的目标)。
 */
export function buildPlan(
  kind: PeriodKind,
  events: ReadonlyArray<{ title?: string; start?: string }>,
  threadNodes: ReadonlyArray<{ type?: string; name?: string; createdAt?: string; lastConfirmedAt?: string; attributes?: Record<string, unknown> }>,
  now: Date,
  locale: 'zh' | 'en' = 'zh',
): DailyReport {
  const { start, end } = windowOf(kind, 'plan', now);
  const periodKey = periodKeyOf(kind, start);

  const upcomingEvents = events
    .filter((e): e is { title: string; start: string } => !!e.title && !!e.start)
    .map((e) => ({ title: e.title, d: new Date(e.start) }))
    .filter((e) => !Number.isNaN(e.d.getTime()) && e.d.getTime() >= start.getTime() && e.d.getTime() < end.getTime())
    .sort((a, b) => a.d.getTime() - b.d.getTime());

  const reminders = listReminders().filter((r) => {
    if (r.doneAt) return false;
    const d = new Date(r.at);
    return !Number.isNaN(d.getTime()) && d.getTime() >= start.getTime() && d.getTime() < end.getTime();
  });

  const threads = looseThreads(threadNodes, now.getTime()).slice(0, 5);

  const sections: DailyReportSection[] = [];
  if (upcomingEvents.length || reminders.length) {
    const lines = [
      ...reminders.map((r) => `${dateKey(new Date(r.at)).slice(5)} · ${r.title}`),
      ...upcomingEvents.map((e) => `${dateKey(e.d).slice(5)} · ${e.title}`),
    ];
    sections.push({ id: 'calendar', title: locale === 'en' ? 'Already on the calendar' : '已经排定的', lines: lines.slice(0, 10) });
  }
  if (threads.length) {
    sections.push({
      id: 'threads',
      title: locale === 'en' ? 'Loose threads' : '还没接上的线头',
      lines: threads.map((t) => `「${(t.name || '').slice(0, 30)}」`),
    });
  }

  const rangeLabel = fmtRange(kind, start, end, locale);
  const empty = sections.length === 0;
  const title = kind === 'week'
    ? (locale === 'en' ? `Next week · ${rangeLabel}` : `下周计划 · ${rangeLabel}`)
    : (locale === 'en' ? `Next month · ${rangeLabel}` : `下月计划 · ${rangeLabel}`);
  const headline = empty
    ? (locale === 'en' ? 'Nothing set yet for this stretch.' : '这一期还没有排定的事。')
    : (locale === 'en' ? `${upcomingEvents.length + reminders.length} thing(s) already on the calendar` : `已经有 ${upcomingEvents.length + reminders.length} 件事排定`);
  const markdown = sections.map((s) => `## ${s.title}\n${s.lines.map((l) => `- ${l}`).join('\n')}`).join('\n\n');

  return { date: periodKey, title, greeting: '', headline, sections, markdown, empty };
}

/* ── 持久化 + 自动预生成(和 daily-report-persist 同一套口径)───────────── */

/**
 * 静态字面量,不用模板字符串拼——scripts/storage-key-registry.test.mjs 只扫描
 * 源码里的**字符串字面量**,拼出来的 key 会绕过登记检查,那正是这张登记表要防的事
 * (2026-07-29 那次普查踩过的坑:没登记的键默认当用户数据上云)。
 */
const AUTO_KEYS: Record<PeriodKind, Record<PeriodDirection, string>> = {
  week: {
    retrospect: 'nesio-periodic-report-week-retrospect-auto-v1',
    plan: 'nesio-periodic-report-week-plan-auto-v1',
  },
  month: {
    retrospect: 'nesio-periodic-report-month-retrospect-auto-v1',
    plan: 'nesio-periodic-report-month-plan-auto-v1',
  },
};

function autoKey(kind: PeriodKind, direction: PeriodDirection): string {
  return AUTO_KEYS[kind][direction];
}

/** 存/更新这一期的报告(externalId 幂等)。空报告跳过——没内容不占记忆。 */
export function persistPeriodicReport(
  kind: PeriodKind,
  direction: PeriodDirection,
  report: DailyReport,
  now: Date,
): 'saved' | 'skipped' {
  if (report.empty) return 'skipped';
  ingestLifeNode({
    type: 'event',
    name: report.title,
    source: 'system',
    confidence: 1,
    relations: [],
    tags: TAGS,
    rawInput: report.markdown,
    attributes: {
      kind: 'periodic-report',
      period: kind,
      direction,
      periodKey: report.date,
      externalId: externalIdOf(kind, direction, now),
      headline: report.headline,
      snapshot: JSON.stringify({ greeting: report.greeting, headline: report.headline, sections: report.sections }),
      epistemic: 'system_summary',
      generator: `rule:periodic-report-${kind}-${direction}`,
    },
  });
  return 'saved';
}

/**
 * 客户端每期幂等自动预生成 + 存记忆。调用方保证仅在 canUsePrivateData 时调用
 * (私据门,和 daily-report-persist.autoPersistTodayReport 同一条规矩)。
 */
export function autoPersistPeriodicReport(opts: {
  kind: PeriodKind;
  direction: PeriodDirection;
  report: DailyReport;
  enabled: boolean;
  now: Date;
}): 'saved' | 'skipped' {
  if (typeof window === 'undefined') return 'skipped';
  if (!opts.enabled) return 'skipped';
  if (!periodDue(opts.kind, opts.now)) return 'skipped';
  const key = autoKey(opts.kind, opts.direction);
  let lastKey: string | null = null;
  try { lastKey = localStorage.getItem(key); } catch { /* 读失败按未生成处理 */ }
  const thisExternalId = externalIdOf(opts.kind, opts.direction, opts.now);
  if (lastKey === thisExternalId) return 'skipped'; // 这一期已经生成过
  const outcome = persistPeriodicReport(opts.kind, opts.direction, opts.report, opts.now);
  // 即使是空报告也记下「这一期问过了」——否则每次开 App 都要重新判定一遍空不空。
  try { localStorage.setItem(key, thisExternalId); } catch { /* 写失败下次至多重判一次,无害 */ }
  return outcome;
}

/** 读记忆里最新一份「这一期」的报告(不重算,和 daily-report-persist.readTodayReport 同一读法)。 */
export function readCurrentPeriodicReport(
  nodes: ReadonlyArray<LifeNode>,
  kind: PeriodKind,
  direction: PeriodDirection,
  now: Date,
): DailyReport | null {
  const key = externalIdOf(kind, direction, now);
  const hit = nodes.find((n) => n.attributes?.kind === 'periodic-report' && n.attributes?.externalId === key);
  return reportFromPeriodicNode(hit);
}

/** 历史列表(洞察「回顾」/「计划」页用)。最近在前。 */
export function listPeriodicReports(
  nodes: ReadonlyArray<LifeNode>,
  kind: PeriodKind,
  direction: PeriodDirection,
): Array<{ periodKey: string; title: string; headline: string; report: DailyReport | null }> {
  return nodes
    .filter((n) => n.attributes?.kind === 'periodic-report' && n.attributes?.period === kind && n.attributes?.direction === direction)
    .map((n) => ({
      periodKey: String(n.attributes?.periodKey ?? ''),
      title: n.name || '',
      headline: typeof n.attributes?.headline === 'string' ? n.attributes.headline : '',
      report: reportFromPeriodicNode(n),
    }))
    .sort((a, b) => (a.periodKey < b.periodKey ? 1 : a.periodKey > b.periodKey ? -1 : 0));
}

function reportFromPeriodicNode(n: LifeNode | undefined): DailyReport | null {
  if (!n) return null;
  const raw = n.attributes?.snapshot;
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const snap = JSON.parse(raw) as Pick<DailyReport, 'greeting' | 'headline' | 'sections'>;
    if (!Array.isArray(snap?.sections)) return null;
    return {
      date: String(n.attributes?.periodKey ?? ''),
      title: n.name || '',
      greeting: snap.greeting || '',
      headline: snap.headline || '',
      sections: snap.sections,
      markdown: n.rawInput || '',
      empty: false,
    };
  } catch {
    return null;
  }
}

/** 供 useTodayData 一次性拿到"这一路径手上有什么"——避免 4 次各自读一遍 life graph。 */
export function currentLifeGraphSnapshot(): LifeNode[] {
  try { return getLifeGraph(); } catch { return []; }
}
