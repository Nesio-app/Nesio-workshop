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
}

export async function computeDailyReport(origin: string, adminSecret: string): Promise<ComputedReport> {
  const h: Record<string, string> = adminSecret ? { 'x-nesio-admin-secret': adminSecret } : {};
  const [metrics, gov, history, feedbackRecords] = await Promise.all([
    fetch(new URL('/api/admin/metrics', origin), { headers: h }).then((r) => r.json()).catch(() => ({})),
    fetch(new URL('/api/admin/governance', origin), { headers: h }).then((r) => r.json()).catch(() => ({})),
    loadHistory(45),
    loadFeedback(500),
  ]);
  const report = buildDailyReport(metrics, gov, { history, feedbackRecords });
  const learningState = computeLearningState(history, feedbackRecords) as LearningState;
  return { report, signals: report.signals || {}, learningState };
}
