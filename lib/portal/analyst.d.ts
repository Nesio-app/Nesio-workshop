export type Severity = 'go' | 'gentle' | 'risk';
export interface AnalystAlert { severity: Severity; title: string; detail: string; advice: string }
export interface DailyReport {
  date: string;
  status: Severity;
  headline: string;
  keyPoints: string[];
  alerts: AnalystAlert[];
}
export function buildDailyReport(metrics: unknown, gov: unknown, opts?: { date?: string }): DailyReport;
export function renderReportText(r: DailyReport): string;
export function buildAnalystPrompt(r: DailyReport): string;
