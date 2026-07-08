/**
 * 分析师运行时 —— 组装一份「学习后」的日报:自调 metrics + governance,
 * 从库里读历史(基线)+ 反馈(学习),交给规则大脑 buildDailyReport。
 * GET /api/admin/analyst(卡,只读)与 /api/admin/analyst/run(cron/邮件)共用。
 */
import { buildDailyReport, computeLearningState } from '@/lib/portal/analyst.mjs';
import { loadHistory, loadFeedback } from '@/lib/portal/analyst-store';

export interface LearningState {
  historyDays: number;
  baselines: Array<{ key: string; label: string; n: number; center: number | null; sigma: number | null; cold: boolean }>;
  feedbackTypes: Array<{ type: string; label: string; usefulRate: number | null; samples: number; muted: boolean }>;
  muted: Array<{ type: string; label: string; usefulRate: number | null; samples: number; muted: boolean }>;
}

export interface ComputedReport {
  report: {
    date: string;
    status: 'go' | 'gentle' | 'risk';
    headline: string;
    keyPoints: string[];
    alerts: Array<{ type: string; severity: string; title: string; detail: string; advice: string; explain?: string; basis?: string; learned?: unknown }>;
    learning?: { historyDays: number; learnedAlerts: number; mutedByFeedback: number; feedbackTypes: number };
    signals?: Record<string, number | null>;
  };
  signals: Record<string, number | null>;
  learningState: LearningState;
  /** 数据源自调是否成功。false = metrics/governance 拉取失败(鉴权/超时/5xx),
   *  报告已降级标注,调用方应据此跳过 saveDaily(否则把「故障=0」的假快照污染学习基线)。 */
  sourcesOk: boolean;
}

/** 自调内部 API:区分「失败」与「空数据」。HTTP 非 2xx 或 body 里 ok===false 均视为失败。 */
async function fetchJson(url: URL, headers: Record<string, string>): Promise<{ data: unknown; ok: boolean }> {
  try {
    const r = await fetch(url, { headers });
    const data = await r.json().catch(() => ({}));
    const bodyOk = !(data && typeof data === 'object' && (data as { ok?: unknown }).ok === false);
    return { data, ok: r.ok && bodyOk };
  } catch {
    return { data: {}, ok: false };
  }
}

export async function computeDailyReport(origin: string, adminSecret: string): Promise<ComputedReport> {
  const h: Record<string, string> = adminSecret ? { 'x-nesio-admin-secret': adminSecret } : {};
  const [m, g, history, feedbackRecords] = await Promise.all([
    fetchJson(new URL('/api/admin/metrics', origin), h),
    fetchJson(new URL('/api/admin/governance', origin), h),
    loadHistory(45),
    loadFeedback(500),
  ]);
  const sourcesOk = m.ok && g.ok;
  const report = buildDailyReport(m.data, g.data, { history, feedbackRecords });

  // 数据源拉取失败 → 别把「无数据=一切平稳」发出去,明确降级标注(修静默失败审计 analyst-runtime:33)。
  if (!sourcesOk) {
    const failed = [!m.ok && 'metrics', !g.ok && 'governance'].filter(Boolean).join(' / ');
    report.status = 'risk';
    report.headline = `⚠ 数据源不可用(${failed})—— 本报告不完整,勿据此判断「平稳」`;
    report.keyPoints = [`数据源自调失败:${failed}。可能是 NESIO_ADMIN_SECRET 未配/配错、Supabase 故障或超时。`, ...report.keyPoints];
  }

  const learningState = computeLearningState(history, feedbackRecords) as LearningState;
  return { report, signals: report.signals || {}, learningState, sourcesOk };
}
