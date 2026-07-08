/**
 * 健康月报 · 彩色图文版 —— 与财务月报同一可视化底座(report-visual-kit):
 * KPI 卡打头、每日睡眠/步数柱图(带参考线)、指标档案表、跨域观察、
 * 临床提示色点、体检分项。自包含 HTML,打印即彩色 PDF;非诊断。
 */
import type { HealthMetrics } from './apple-health';
import { evaluateHealthFindings } from './health-clinical';
import { computeRiskScores } from './health-risk';
import { mineRelationships } from './health-correlations';
import { monthFacts, prevYmOf } from './health-report';
import {
  MUTED, ACCENT, GO, GENTLE, RISK,
  esc, r1, singleBarSvg, docShell,
} from './report-visual-kit';

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

export function healthReportRichHtml(
  data: HealthMetrics, ym: string, dict: string = 'zh', now: Date = new Date(),
): string {
  const zh = dict !== 'en';
  const L = (a: string, b: string) => (zh ? a : b);
  const facts = monthFacts(data.daily, ym);
  const prevFacts = monthFacts(data.daily, prevYmOf(ym));
  const num = (k: 'sleepH' | 'steps' | 'restingHR' | 'hrv' | 'glucoseAvg', fs = facts) =>
    fs.map((f) => f[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const title = L(`${ym} 健康月报`, `Health monthly report · ${ym}`);
  const B: string[] = [];
  const day = (d: string) => d.slice(8); // 'DD' 作 x 轴标签

  // ── KPI:睡眠 / 步数 / 静息心率 / HRV(方向着色:恢复向绿、走弱琥珀,不用红) ──
  const sleep = num('sleepH'); const steps = num('steps'); const rhr = num('restingHR'); const hrv = num('hrv');
  const kpi: string[] = [];
  const sleepAvg = avg(sleep);
  if (sleepAvg !== null) {
    const good = sleep.filter((h) => h >= 7).length;
    kpi.push(`<div class="kpi"><span class="kl">${L('睡眠均值', 'Avg sleep')}</span><span class="kv">${r1(sleepAvg)}h</span><span class="delta" style="color:${sleepAvg >= 7 ? GO : GENTLE}">${L(`≥7h 有 ${good}/${sleep.length} 晚`, `${good}/${sleep.length} nights ≥7h`)}</span></div>`);
  }
  const stepsAvg = avg(steps);
  if (stepsAvg !== null) kpi.push(`<div class="kpi"><span class="kl">${L('日均步数', 'Avg steps')}</span><span class="kv">${Math.round(stepsAvg).toLocaleString('en-US')}</span></div>`);
  const rhrAvg = avg(rhr); const rhrPrev = avg(num('restingHR', prevFacts));
  if (rhrAvg !== null) {
    const d = rhrPrev !== null ? r1(rhrAvg - rhrPrev) : null;
    kpi.push(`<div class="kpi"><span class="kl">${L('静息心率', 'Resting HR')}</span><span class="kv">${r1(rhrAvg)}<span style="font-size:12px;font-weight:600"> bpm</span></span>${d !== null && Math.abs(d) >= 0.5 ? `<span class="delta" style="color:${d < 0 ? GO : GENTLE}">${d < 0 ? '▼' : '▲'} ${Math.abs(d)} ${L('vs 上月', 'vs last mo')}</span>` : ''}</div>`);
  }
  const hrvAvg = avg(hrv); const hrvPrev = avg(num('hrv', prevFacts));
  if (hrvAvg !== null) {
    const d = hrvPrev !== null ? r1(hrvAvg - hrvPrev) : null;
    kpi.push(`<div class="kpi"><span class="kl">HRV</span><span class="kv">${r1(hrvAvg)}<span style="font-size:12px;font-weight:600"> ms</span></span>${d !== null && Math.abs(d) >= 0.5 ? `<span class="delta" style="color:${d > 0 ? GO : GENTLE}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} ${L('vs 上月', 'vs last mo')}</span>` : ''}</div>`);
  }
  if (kpi.length) B.push(`<div class="kpis">${kpi.join('\n')}</div>`);

  // ── 每日睡眠(7h 参考线) ──
  const sleepRows = facts.filter((f) => typeof f.sleepH === 'number').map((f) => ({ label: day(f.date), v: f.sleepH as number }));
  if (sleepRows.length >= 2) {
    B.push(`<section><h2>${L('每日睡眠', 'Sleep by night')}</h2>${singleBarSvg(sleepRows, ACCENT, { refLine: { v: 7, label: L('7h 参考', '7h ref') }, yFmt: (v) => `${r1(v)}h` })}</section>`);
  }

  // ── 每日步数(8k 常用参考线) ──
  const stepRows = facts.filter((f) => typeof f.steps === 'number').map((f) => ({ label: day(f.date), v: f.steps as number }));
  if (stepRows.length >= 2) {
    B.push(`<section><h2>${L('每日步数', 'Steps by day')}</h2>${singleBarSvg(stepRows, GO, { refLine: { v: 8000, label: L('8k 常用参考', '8k ref') }, yFmt: (v) => `${Math.round(v / 1000)}k` })}</section>`);
  }

  // ── 血糖日均(若有) ──
  const gluRows = facts.filter((f) => typeof f.glucoseAvg === 'number').map((f) => ({ label: day(f.date), v: f.glucoseAvg as number }));
  if (gluRows.length >= 2) {
    B.push(`<section><h2>${L('血糖 · 日均', 'Glucose · daily avg')}</h2>${singleBarSvg(gluRows, GENTLE, { refLine: { v: 140, label: L('140 餐后参考', '140 post-meal ref') }, yFmt: (v) => String(Math.round(v)) })}</section>`);
  }

  // ── 指标档案:本月 vs 上月 ──
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
    const trs = rows.map(({ m, cur, prev }) => {
      const d = prev !== undefined && prev !== 0 ? r1(((cur - prev) / prev) * 100) : null;
      return `<tr><td>${esc(zh ? m.label[0] : m.label[1])}</td><td class="num">${cur.toFixed(m.decimals)} ${esc(m.unit)}</td><td class="num muted">${prev !== undefined ? `${prev.toFixed(m.decimals)} ${esc(m.unit)}` : '—'}</td><td class="num muted">${d !== null ? `${d > 0 ? '+' : ''}${d}%` : '—'}</td></tr>`;
    }).join('');
    B.push(`<section><h2>${L('指标档案', 'Metric profile')}</h2><table class="clean"><tr><td class="muted">${L('指标', 'Metric')}</td><td class="num muted">${L('本月', 'This mo')}</td><td class="num muted">${L('上月', 'Last mo')}</td><td class="num muted">Δ</td></tr>${trs}</table></section>`);
  }

  // ── 跨域观察 ──
  const rels = data.daily ? mineRelationships(data.daily) : [];
  if (rels.length) {
    const lis = rels.slice(0, 6).map((r) => `<li><i class="dot" style="background:${ACCENT}"></i>${esc(zh ? r.insight[0] : r.insight[1])} <span class="muted">(r=${r.r}, n=${r.n})</span></li>`).join('');
    B.push(`<section><h2>${L('跨域观察', 'Cross-domain patterns')}</h2><ul class="dots">${lis}</ul><p class="muted small">${L('相关不等于因果;样本来自你的全部日事实数据。', 'Correlation ≠ causation; computed over all daily facts.')}</p></section>`);
  }

  // ── 提示与风险(flag 红 = 建议就医;attention 琥珀;info 绿) ──
  const findings = evaluateHealthFindings({ glucose: data.glucose, sleepStages: data.sleepStages, metrics: data.metrics });
  if (findings.length) {
    const tone = (s: string) => (s === 'flag' ? RISK : s === 'attention' ? GENTLE : GO);
    const lis = findings.map((f) => `<li><i class="dot" style="background:${tone(f.severity)}"></i><strong>${esc(zh ? f.title[0] : f.title[1])}</strong> —— ${esc(zh ? f.detail[0] : f.detail[1])} <span class="muted">· ${esc(f.source)}</span></li>`).join('');
    B.push(`<section><h2>${L('提示与风险', 'Notes & risks')}</h2><ul class="dots">${lis}</ul></section>`);
  }

  // ── 健康体检 ──
  const scores = computeRiskScores({ metrics: data.metrics, glucose: data.glucose, profile: data.profile });
  if (scores.length) {
    const tone = (cat: string) => (cat === 'high' ? RISK : cat === 'moderate' ? GENTLE : GO);
    const divs = scores.map((sc) => `<div class="score"><div class="scoretop"><span><i class="dot" style="position:static;display:inline-block;vertical-align:-.5px;margin-right:6px;background:${tone(sc.category)}"></i>${esc(zh ? sc.label[0] : sc.label[1])}</span><strong>${esc(sc.value)}</strong></div>
<p class="muted small">${esc(zh ? sc.detail[0] : sc.detail[1])} · ${esc(sc.source)}</p></div>`).join('');
    B.push(`<section><h2>${L('健康体检', 'Health checkup')}</h2>${divs}</section>`);
  }

  // ── 口径说明 ──
  B.push(`<section><h2>${L('口径说明', 'Methodology')}</h2><ul class="fine">
<li>${L('数据来自 Apple Health 导出,按每日事实表聚合;缺失的天不参与均值。', 'From your Apple Health export; missing days excluded from averages.')}</li>
<li>${L('「提示与风险」「体检」基于最新导入的全量数据,不限于本月;分项均附标准出处。', 'Notes/checkup use the full latest import (not month-scoped); items cite sources.')}</li>
<li>${L('本报告由确定性规则在本机生成,不构成医疗建议;不适请及时就医。', 'Deterministic, on-device; not medical advice — see a clinician for concerns.')}</li>
</ul></section>`);

  return docShell(
    title,
    `${L(`生成于 ${now.toISOString().slice(0, 10)} · 覆盖 ${facts.length} 天 · 数据只存本机 · 非 LLM`, `Generated ${now.toISOString().slice(0, 10)} · ${facts.length} days covered · on-device · no LLM`)}${facts.length ? '' : ` <span style="color:${MUTED}">${L('(该月暂无日级数据)', '(no daily data this month)')}</span>`}`,
    B.join('\n'),
  );
}
