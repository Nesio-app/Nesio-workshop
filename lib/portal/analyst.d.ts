export type Severity = 'go' | 'gentle' | 'risk';
export type AlertBasis = 'learned' | 'static';

export interface FeedbackStat { useful: number; dismiss: number; wrong: number; total: number; usefulRate: number | null; muted: boolean }
export interface AnalystAlert {
  type: string;
  severity: Severity;
  title: string;
  detail: string;
  advice: string;
  explain?: string;
  basis?: AlertBasis;
  learned?: FeedbackStat | null;
}
export interface DailyReport {
  date: string;
  status: Severity;
  headline: string;
  keyPoints: string[];
  alerts: AnalystAlert[];
  learning?: { historyDays: number; learnedAlerts: number; mutedByFeedback: number; feedbackTypes: number };
  signals?: Record<string, number | null>;
}

export function extractSignals(metrics: unknown, gov: unknown): Record<string, number | null>;
export function summarizeFeedback(records: Array<{ alertType?: string; type?: string; reaction: string }> | undefined): Record<string, FeedbackStat>;
export function buildDailyReport(
  metrics: unknown,
  gov: unknown,
  opts?: { history?: Array<Record<string, number | null>>; feedbackRecords?: Array<{ alertType?: string; reaction: string }>; date?: string; k?: number; minSamples?: number },
): DailyReport;
export function renderReportText(r: DailyReport): string;
export function buildAnalystPrompt(r: DailyReport): string;
