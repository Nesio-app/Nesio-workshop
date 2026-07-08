/**
 * 健康月报(对齐财务月报形态)—— 把每日事实表(DailyFact)按月聚合,叠加
 * 临床判定(health-clinical)/体检分项(health-risk)/跨域相关(health-correlations),
 * 生成报告级 Markdown:可下载、可存入记忆(问一问可检索引用)。
 * 全部确定性、非 LLM、缺数据的分节不出;非诊断,分项带出处。
 */
import type { HealthMetrics, DailyFact } from './apple-health';
import { evaluateHealthFindings } from './health-clinical';
import { computeRiskScores } from './health-risk';
import { mineRelationships } from './health-correlations';
import { addLifeNode, updateLifeNode, getLifeGraph } from './life-graph';

export interface HealthMonthlyReport {
  ym: string;
  title: string;
  markdown: string;
  summary: { ym: string; days: number; sleepAvg: number | null; stepsAvg: number | null; restingHR: number | null };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
const pick = (facts: DailyFact[], k: keyof DailyFact): number[] =>
  facts.map((f) => f[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

export function prevYmOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** 该月每日事实(升序)。 */
export function monthFacts(daily: DailyFact[] | undefined, ym: string): DailyFact[] {
  return (daily ?? []).filter((f) => (f.date || '').startsWith(ym)).sort((a, b) => a.date.localeCompare(b.date));
}

/** 有日事实数据的月份(新→旧)。 */
export function healthMonths(daily: DailyFact[] | undefined): string[] {
  return [...new Set((daily ?? []).map((f) => (f.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
}

export function buildMonthlyHealthReport(
  data: HealthMetrics, ym: string, dict: string = 'zh', now: Date = new Date(),
): HealthMonthlyReport {
  const zh = dict !== 'en';
  const L = (a: string, b: string) => (zh ? a : b);
  const facts = monthFacts(data.daily, ym);
  const prevFacts = monthFacts(data.daily, prevYmOf(ym));
  const lines: string[] = [];
  const title = L(`${ym} 健康月报`, `Health monthly report · ${ym}`);
  lines.push(`# ${title}`, '');
  lines.push(L(`生成于 ${now.toISOString().slice(0, 10)} · 数据来自 Apple Health 导入,只存本机 · 确定性规则生成(非 LLM)`, `Generated ${now.toISOString().slice(0, 10)} · from Apple Health export, on-device · deterministic rules (no LLM)`));

  // ── 本月速览 ──
  const sleep = pick(facts, 'sleepH');
  const steps = pick(facts, 'steps');
  const rhr = pick(facts, 'restingHR');
  const hrv = pick(facts, 'hrv');
  const glu = pick(facts, 'glucoseAvg');
  const sleepAvg = avg(sleep); const stepsAvg = avg(steps); const rhrAvg = avg(rhr); const hrvAvg = avg(hrv);
  lines.push('', `## ${L('本月速览', 'At a glance')}`, '');
  lines.push(`- ${L('数据覆盖', 'Coverage')}:${facts.length} ${L('天', 'days')}`);
  if (sleepAvg !== null) {
    const good = sleep.filter((h) => h >= 7).length;
    lines.push(`- ${L('睡眠', 'Sleep')}:${L('均', 'avg')} ${r1(sleepAvg)}h · ${L(`≥7h 有 ${good}/${sleep.length} 晚`, `${good}/${sleep.length} nights ≥7h`)}(${L('成人参考 7–9h,AASM', 'adults 7–9h, AASM')})`);
  }
  if (stepsAvg !== null) lines.push(`- ${L('步数', 'Steps')}:${L('日均', 'avg')} ${Math.round(stepsAvg).toLocaleString('en-US')} · ${L('最高', 'peak')} ${Math.max(...steps).toLocaleString('en-US')}`);
  if (rhrAvg !== null) {
    const prevR = avg(pick(prevFacts, 'restingHR'));
    lines.push(`- ${L('静息心率', 'Resting HR')}:${L('均', 'avg')} ${r1(rhrAvg)} bpm${prevR !== null ? `(${L('上月', 'last mo')} ${r1(prevR)}${rhrAvg < prevR ? L(',在往下走', ', trending down') : ''})` : ''}`);
  }
  if (hrvAvg !== null) {
    const prevH = avg(pick(prevFacts, 'hrv'));
    lines.push(`- HRV:${L('均', 'avg')} ${r1(hrvAvg)} ms${prevH !== null ? `(${L('上月', 'last mo')} ${r1(prevH)})` : ''}`);
  }
  if (glu.length) lines.push(`- ${L('血糖(日均)', 'Glucose (daily avg)')}:${L('均', 'avg')} ${r1(avg(glu)!)} mg/dL · ${L('区间', 'range')} ${r1(Math.min(...glu))}–${r1(Math.max(...glu))}`);

  // ── 指标档案:月度序列里本月 vs 上月 ──
  const prevYmStr = prevYmOf(ym);
  const rows = data.metrics
    .map((m) => {
      const cur = m.series?.find((s) => s.ym === ym)?.v;
      const prev = m.series?.find((s) => s.ym === prevYmStr)?.v;
      return cur !== undefined ? { m, cur, prev } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 12);
  if (rows.length) {
    lines.push('', `## ${L('指标档案', 'Metric profile')}`, '');
    lines.push(L('| 指标 | 本月 | 上月 | 变化 |', '| Metric | This mo | Last mo | Δ |'));
    lines.push('| --- | --- | --- | --- |');
    for (const { m, cur, prev } of rows) {
      const d = prev !== undefined && prev !== 0 ? `${cur > prev ? '+' : ''}${r1(((cur - prev) / prev) * 100)}%` : '—';
      lines.push(`| ${zh ? m.label[0] : m.label[1]} | ${cur.toFixed(m.decimals)} ${m.unit} | ${prev !== undefined ? `${prev.toFixed(m.decimals)} ${m.unit}` : '—'} | ${d} |`);
    }
  }

  // ── 跨域相关(全量日事实;相关非因果)──
  const rels = data.daily ? mineRelationships(data.daily) : [];
  if (rels.length) {
    lines.push('', `## ${L('跨域观察', 'Cross-domain patterns')}`, '');
    for (const r of rels.slice(0, 6)) lines.push(`- ${zh ? r.insight[0] : r.insight[1]}(r=${r.r}, n=${r.n})`);
    lines.push(L('相关不等于因果;样本来自你的全部日事实数据。', 'Correlation is not causation; computed over all of your daily facts.'));
  }

  // ── 风险与提示(临床判定,带出处)──
  const findings = evaluateHealthFindings({ glucose: data.glucose, sleepStages: data.sleepStages, metrics: data.metrics });
  if (findings.length) {
    lines.push('', `## ${L('提示与风险', 'Notes & risks')}`, '');
    for (const f of findings) lines.push(`- ${f.severity === 'flag' ? '🔴 ' : ''}${zh ? f.title[0] : f.title[1]} —— ${zh ? f.detail[0] : f.detail[1]} · ${L('依据', 'per')} ${f.source}`);
  }

  // ── 健康体检(分项,不合成总分)──
  const scores = computeRiskScores({ metrics: data.metrics, glucose: data.glucose, profile: data.profile });
  if (scores.length) {
    lines.push('', `## ${L('健康体检', 'Health checkup')}`, '');
    for (const sc of scores) lines.push(`- ${zh ? sc.label[0] : sc.label[1]}:**${sc.value}**(${sc.category})—— ${zh ? sc.detail[0] : sc.detail[1]} · ${L('依据', 'per')} ${sc.source}`);
  }

  // ── 口径说明 ──
  lines.push('', `## ${L('口径说明', 'Methodology')}`, '');
  lines.push(`- ${L('数据来自 Apple Health 导出,按「每日事实表」聚合;缺失的天不参与均值。', 'From your Apple Health export, aggregated on the daily-facts table; missing days are excluded from averages.')}`);
  lines.push(`- ${L('「提示与风险」「体检」基于最新导入的全量数据,不限于本月;分项均附标准出处。', 'Notes/checkup use the full latest import (not month-scoped); every item cites its source.')}`);
  lines.push(`- ${L('本报告由确定性规则在本机生成,不构成医疗建议;不适请及时就医。', 'Deterministic rules, on-device; not medical advice — see a clinician for concerns.')}`);

  return {
    ym,
    title,
    markdown: lines.join('\n'),
    summary: {
      ym,
      days: facts.length,
      sleepAvg: sleepAvg !== null ? r1(sleepAvg) : null,
      stepsAvg: stepsAvg !== null ? Math.round(stepsAvg) : null,
      restingHR: rhrAvg !== null ? r1(rhrAvg) : null,
    },
  };
}

/** 存入记忆(life-graph):同月健康月报已存在则更新,不产生重复节点。 */
export function persistHealthReportToMemory(r: HealthMonthlyReport): 'created' | 'updated' {
  const existing = getLifeGraph().find(
    (n) => n.source === 'system' && n.attributes?.kind === 'health-monthly-report' && n.attributes?.ym === r.ym,
  );
  const attributes: Record<string, string | number> = { kind: 'health-monthly-report', ym: r.ym, days: r.summary.days };
  if (r.summary.sleepAvg !== null) attributes.sleepAvg = r.summary.sleepAvg;
  if (r.summary.stepsAvg !== null) attributes.stepsAvg = r.summary.stepsAvg;
  if (existing) {
    updateLifeNode(existing.id, { name: r.title, attributes, rawInput: r.markdown });
    return 'updated';
  }
  addLifeNode({ type: 'event', name: r.title, attributes, source: 'system', confidence: 1, relations: [], tags: ['健康', '月报'], rawInput: r.markdown });
  return 'created';
}

const AUTO_KEY = 'nesio-health-report-auto-v1';

/** 月初自动补生成上月健康月报并存记忆(每设备每月一次,幂等;上月无日事实则跳过)。 */
export function autoPersistLastMonthHealthReport(
  data: HealthMetrics | null, now: Date = new Date(), dict: string = 'zh',
): 'created' | 'updated' | 'skipped' {
  if (typeof window === 'undefined' || !data?.daily?.length) return 'skipped';
  const lastYm = prevYmOf(now.toISOString().slice(0, 7));
  try { if (localStorage.getItem(AUTO_KEY) === lastYm) return 'skipped'; } catch { /* ignore */ }
  if (!monthFacts(data.daily, lastYm).length) return 'skipped';
  const outcome = persistHealthReportToMemory(buildMonthlyHealthReport(data, lastYm, dict, now));
  try { localStorage.setItem(AUTO_KEY, lastYm); } catch { /* ignore */ }
  return outcome;
}
