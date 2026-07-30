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
import { buildDailyReport, dailyReportExternalId, type DailyReport, type DailyReportInput, type DailyReportDomainInsight } from './daily-report';

const AUTO_KEY = 'nesio-daily-report-auto-v1';
const TAGS = ['日报', 'AI'];

/** 存/更新今天的日报到记忆(externalId 幂等)。空日报跳过。 */
export function persistDailyReportToMemory(
  report: DailyReport,
  /** 今天的原始判定集 —— 明天用它算差分。 */
  insights?: readonly DailyReportDomainInsight[],
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
      kind: 'daily-report',
      externalId: dailyReportExternalId(new Date(`${report.date}T12:00:00`)),
      date: report.date,
      headline: report.headline,
      // **冻结的那一份**(2026-07-30「当天不再变」)。只把 now 钉在 08:00 是不够的:
      // 日历窗口本来就是整天,锚点几乎不影响它;真正会在白天变的是**输入** ——
      // 新邮件到了、某个域的判定翻了、提醒被打勾。所以把成品也存下来,
      // 之后一整天都读这一份,不再拿新数据重排。
      snapshot: JSON.stringify({ greeting: report.greeting, headline: report.headline, sections: report.sections }),
      // 明天算「新进展」要拿今天的**原始判定集**去比。存格式化后的 sections 是不够的:
      // 那已经是拼好的句子,反解析既脆又会把「6.4」这种数值弄丢。
      insights: JSON.stringify(insights ?? []),
      epistemic: 'system_summary',
      generator: 'rule:daily-report',
    },
  });
  return 'saved';
}

/* ── 定稿(2026-07-30 用户拍板:早上 8 点,当天不再变)────────────────────
   PWA 没有可靠后台定时,所以做不到「8 点整跑一次」。改成**拉模型 + 定稿口径**:

     ① 生成时机 = 当天首次打开且已过 08:00。早于 8 点不生成 ——
        天没亮时数据(当天天气/邮件)本来也没同步全,出一份半成品还要在中午自己改口,
        那正是用户抱怨的「早上看到的和中午看到的不是同一份」。
     ② **定稿口径 = 当天 08:00**:无论实际几点生成,都把 now 钉在 08:00。
        这是关键 —— 因为 buildDailyReport 是纯函数,同样的输入必然同样的输出,
        钉死 now 就等于定稿。10 点才打开也拿到「早上八点那份」,里面照样有 9 点那场会。
     ③ 当天已生成过 → 直接跳过,不重算(AUTO_KEY 记着日期)。 */
export const REPORT_HOUR = 8;

/** 把某一刻折成「当天 08:00」—— 日报的定稿口径。 */
export function reportAnchor(now: Date): Date {
  const d = new Date(now);
  d.setHours(REPORT_HOUR, 0, 0, 0);
  return d;
}

/** 现在够不够钟出今天这份(早于 08:00 就还没到点)。 */
export function reportDue(now: Date): boolean {
  return now.getTime() >= reportAnchor(now).getTime();
}

/** 纯决策:今天是否该自动预生成(可单测,不碰 window)。 */
export function shouldAutoPersistDailyReport(opts: {
  enabled: boolean;
  lastAutoDate: string | null;
  report: DailyReport;
  /** 到点了没(默认 true,老调用方行为不变) */
  due?: boolean;
}): boolean {
  if (!opts.enabled) return false;         // 开关关
  if (opts.due === false) return false;    // 还没到 08:00
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
  // 定稿:now 钉在当天 08:00(见上面 REPORT_HOUR 那段)。
  const report = buildDailyReport({ ...input, now: reportAnchor(now) });
  let lastAutoDate: string | null = null;
  try { lastAutoDate = localStorage.getItem(AUTO_KEY); } catch { /* 读失败按未生成处理 */ }
  if (!shouldAutoPersistDailyReport({ enabled: opts.enabled, lastAutoDate, report, due: reportDue(now) })) return 'skipped';
  const outcome = persistDailyReportToMemory(report, input.domainInsights);
  if (outcome === 'saved') {
    // 标记写失败无害:externalId 幂等,下次至多原地重写一次,不必打扰用户。
    try { localStorage.setItem(AUTO_KEY, report.date); } catch { /* ignore */ }
  }
  return outcome;
}

/** 记忆节点(存的是日报)。 */
type ReportNode = { name?: string; rawInput?: string; attributes?: Record<string, unknown> };

/**
 * 一个记忆节点 → 完整的 DailyReport(含 sections)。
 *
 * 冻结件存在 attributes.snapshot 里。老节点(2026-07-30 之前存的)没有这个字段 ——
 * 返回 null,让调用方各自决定是现算还是不显示;**绝不半截拼一份**
 * (只有 markdown 没有 sections 的话,UI 只能渲染出个空壳)。
 */
function reportFromNode(n: ReportNode | undefined): DailyReport | null {
  if (!n) return null;
  const raw = n.attributes?.snapshot;
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const snap = JSON.parse(raw) as Pick<DailyReport, 'greeting' | 'headline' | 'sections'>;
    if (!Array.isArray(snap?.sections)) return null;
    return {
      date: String(n.attributes?.date ?? ''),
      title: n.name || '',
      greeting: snap.greeting || '',
      headline: snap.headline || '',
      sections: snap.sections,
      markdown: n.rawInput || '',
      empty: false,
    };
  } catch {
    return null;   // 存坏了就当没有,不给一份半截的
  }
}

/**
 * 读今天已定稿的那份(从记忆里,不重算)。
 * 当天第一次生成之后,界面上看到的必须一直是**这一份** —— 这就是「当天不再变」。
 */
export function readTodayReport(
  nodes: ReadonlyArray<ReportNode>,
  now: Date = new Date(),
): DailyReport | null {
  const key = dailyReportExternalId(reportAnchor(now));
  return reportFromNode(nodes.find(
    (n) => n.attributes?.kind === 'daily-report' && n.attributes?.externalId === key,
  ));
}

/**
 * 读**昨天**那份日报里的原始判定集 —— 今天算「新进展」要拿它当基线。
 * 没有(第一天 / 老节点 / 昨天没生成)就返回 undefined,日报据此退回出快照,
 * 并把标题从「新进展」换成「这几面」—— 不装作有进展。
 */
export function readYesterdayInsights(
  nodes: ReadonlyArray<ReportNode>,
  now: Date = new Date(),
): DailyReportDomainInsight[] | undefined {
  const y = reportAnchor(now);
  y.setDate(y.getDate() - 1);
  const key = dailyReportExternalId(y);
  const hit = nodes.find((n) => n.attributes?.kind === 'daily-report' && n.attributes?.externalId === key);
  const raw = hit?.attributes?.insights;
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as DailyReportDomainInsight[];
    return Array.isArray(parsed) && parsed.length ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 读记忆里已存的每日日报(供洞察页历史;调用方注入 life graph 快照,便于测试)。
 * 带上 report(完整冻结件)—— 点开往日那天要能渲染出和当天一模一样的版面。
 * 老节点没有冻结件时 report 为 null,列表里仍然列出来(有 markdown 可看),
 * 但点开不给一份半截的。
 */
export function listDailyReports(
  nodes: ReadonlyArray<ReportNode & { createdAt?: string }>,
): Array<{ date: string; title: string; headline: string; markdown: string; report: DailyReport | null }> {
  return nodes
    .filter((n) => n.attributes?.kind === 'daily-report' && typeof n.attributes?.date === 'string')
    .map((n) => ({
      date: String(n.attributes!.date),
      title: n.name || '',
      headline: typeof n.attributes?.headline === 'string' ? n.attributes.headline : '',
      markdown: n.rawInput || '',
      report: reportFromNode(n),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // 最近在前
}
