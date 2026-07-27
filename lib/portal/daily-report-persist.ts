/**
 * 每日图文日报 · 持久化 + 自动预生成(块2,客户端)。
 *
 * 全局性:
 * - 存记忆走**合法写入门** ingestLifeNode(Signal 主事实表的 LifeNode 形态门,见 STATE.md),
 *   按 attributes.externalId 幂等(同一天重生成原地更新,不堆重复节点)——与生活报告/月报一致。
 * - 自动预生成仿月报 autoPersistLastMonthReport:每设备每天一次(localStorage 标记幂等)。
 * - **私据门**:日报取材于日历/邮件/记忆(私据),调用方必须只在 canUsePrivateData 时调本模块
 *   (与 TodayFeed/MemoryTab 同一 anonymous-private-data-gate 契约);本模块不自行读私据。
 * - 开关:profile.dailyReportEnabled(默认关,设置里开)。
 */
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { buildDailyReport, dailyReportExternalId, type DailyReport, type DailyReportInput } from './daily-report';

const AUTO_KEY = 'nesio-daily-report-auto-v1';
const TAGS = ['日报', 'AI'];

/** 存/更新今天的日报到记忆(externalId 幂等)。空日报跳过。 */
export function persistDailyReportToMemory(report: DailyReport): 'saved' | 'skipped' {
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
      kind: 'daily-report',
      externalId: dailyReportExternalId(new Date(`${report.date}T12:00:00`)),
      date: report.date,
      headline: report.headline,
      epistemic: 'system_summary',
      generator: 'rule:daily-report',
    },
  });
  return 'saved';
}

/** 纯决策:今天是否该自动预生成(可单测,不碰 window)。 */
export function shouldAutoPersistDailyReport(opts: {
  enabled: boolean;
  lastAutoDate: string | null;
  report: DailyReport;
}): boolean {
  if (!opts.enabled) return false;         // 开关关
  if (opts.report.empty) return false;     // 无实质内容
  if (opts.lastAutoDate === opts.report.date) return false; // 今天已生成过
  return true;
}

/**
 * 客户端每日幂等自动预生成 + 存记忆。
 * 调用方保证:仅在 canUsePrivateData(已登录)时调用,并传入从缓存攒好的 input。
 */
export function autoPersistTodayReport(
  input: DailyReportInput,
  opts: { enabled: boolean; now?: Date },
): 'saved' | 'skipped' {
  if (typeof window === 'undefined') return 'skipped';
  const now = opts.now ?? new Date();
  const report = buildDailyReport({ ...input, now });
  let lastAutoDate: string | null = null;
  try { lastAutoDate = localStorage.getItem(AUTO_KEY); } catch { /* 读失败按未生成处理 */ }
  if (!shouldAutoPersistDailyReport({ enabled: opts.enabled, lastAutoDate, report })) return 'skipped';
  const outcome = persistDailyReportToMemory(report);
  if (outcome === 'saved') {
    // 标记写失败无害:externalId 幂等,下次至多原地重写一次,不必打扰用户。
    try { localStorage.setItem(AUTO_KEY, report.date); } catch { /* ignore */ }
  }
  return outcome;
}

/** 读记忆里已存的每日日报(供洞察页历史;调用方注入 life graph 快照,便于测试)。 */
export function listDailyReports(
  nodes: Array<{ name?: string; rawInput?: string; attributes?: Record<string, unknown>; createdAt?: string }>,
): Array<{ date: string; title: string; headline: string; markdown: string }> {
  return nodes
    .filter((n) => n.attributes?.kind === 'daily-report' && typeof n.attributes?.date === 'string')
    .map((n) => ({
      date: String(n.attributes!.date),
      title: n.name || '',
      headline: typeof n.attributes?.headline === 'string' ? n.attributes.headline : '',
      markdown: n.rawInput || '',
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // 最近在前
}
