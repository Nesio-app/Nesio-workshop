'use client';

import { useState, useEffect, useCallback } from 'react';
import { IconActivity, IconClock, IconTarget, IconTrendingDown, IconTrendingUp } from './icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

// ── Types ─────────────────────────────────────────────────────────────────────

export type VarType = 'number' | 'scale' | 'boolean';

export interface ExpDataPoint {
  date: string;       // YYYY-MM-DD
  iv: number;         // independent variable value (boolean → 0/1)
  dv: number;         // dependent variable value
  note?: string;
}

export interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  ivName: string;
  ivUnit: string;
  ivType: VarType;
  dvName: string;
  dvUnit: string;
  dvType: VarType;
  targetDays: number;
  startedAt: string;   // ISO
  dataPoints: ExpDataPoint[];
  concluded: boolean;
  conclusion?: string;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORE_KEY = 'nesio-experiments-v2';

export function loadExperiments(): Experiment[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Experiment[]) : [];
  } catch { return []; }
}

export function saveExperiments(exps: Experiment[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(exps)); } catch { /* ignore */ }
}

// ── Analysis ──────────────────────────────────────────────────────────────────

function pearsonR(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}

// α=0.05 双尾 Pearson 显著性临界 |r|(按样本量 n)。小样本下 r 必须很高才算真关联 ——
// 否则 n=5 的噪声也会被说成"正相关"。这是把"参数阈值"换成"统计显著"。
const CRIT_R: Array<[number, number]> = [
  [5, 0.878], [6, 0.811], [7, 0.754], [8, 0.707], [10, 0.632], [12, 0.576],
  [15, 0.514], [20, 0.444], [25, 0.396], [30, 0.361], [40, 0.312], [50, 0.279], [80, 0.220], [120, 0.179],
];
function criticalR(n: number): number {
  if (n <= 5) return 0.878;
  if (n >= 120) return 1.96 / Math.sqrt(n); // 大样本近似
  for (let i = 1; i < CRIT_R.length; i++) {
    const [n1, r1] = CRIT_R[i - 1];
    const [n2, r2] = CRIT_R[i];
    if (n <= n2) return r1 + (r2 - r1) * (n - n1) / (n2 - n1);
  }
  return 0.179;
}

export interface ExpInsight {
  r: number | null;
  meanOn: number | null;      // mean DV when IV is high (≥ median) or boolean=1
  meanOff: number | null;     // mean DV when IV is low or boolean=0
  trend: 'positive' | 'negative' | 'neutral' | 'insufficient';
  days: number;
  text: string;
}

export function computeInsight(exp: Experiment, dict: string = 'zh'): ExpInsight {
  const pts = exp.dataPoints;
  const days = pts.length;

  if (days < 5) {
    return { r: null, meanOn: null, meanOff: null, trend: 'insufficient', days,
      text: L(dict, `还需要 ${5 - days} 次记录，洞察就能出现。坚持每天打卡，数据会告诉你答案。`, `${5 - days} more logs and insights appear. Keep checking in daily — the data will answer.`) };
  }

  const ivs = pts.map((p) => p.iv);
  const dvs = pts.map((p) => p.dv);

  let meanOn: number | null = null;
  let meanOff: number | null = null;
  let r: number | null = null;

  if (exp.ivType === 'boolean') {
    const onPts = pts.filter((p) => p.iv >= 0.5).map((p) => p.dv);
    const offPts = pts.filter((p) => p.iv < 0.5).map((p) => p.dv);
    if (onPts.length > 0) meanOn = onPts.reduce((a, b) => a + b, 0) / onPts.length;
    if (offPts.length > 0) meanOff = offPts.reduce((a, b) => a + b, 0) / offPts.length;
  } else {
    r = pearsonR(ivs, dvs);
    const median = [...ivs].sort((a, b) => a - b)[Math.floor(ivs.length / 2)];
    const onPts = pts.filter((p) => p.iv >= median).map((p) => p.dv);
    const offPts = pts.filter((p) => p.iv < median).map((p) => p.dv);
    if (onPts.length > 0) meanOn = onPts.reduce((a, b) => a + b, 0) / onPts.length;
    if (offPts.length > 0) meanOff = offPts.reduce((a, b) => a + b, 0) / offPts.length;
  }

  const diff = meanOn !== null && meanOff !== null ? meanOn - meanOff : null;
  const rAbs = r !== null ? Math.abs(r) : null;

  let trend: ExpInsight['trend'] = 'neutral';
  if (r !== null) {
    // 只有统计显著才敢下"正/负相关"的结论;否则保持中性(文案会请用户继续记录)。
    const significant = rAbs! >= criticalR(days);
    trend = significant ? (r > 0 ? 'positive' : 'negative') : 'neutral';
  } else if (diff !== null) {
    // 布尔 IV:两组都要有足够样本,且差异要盖过合并标准差(粗略效应量)才算数。
    const onArr = pts.filter((p) => p.iv >= 0.5).map((p) => p.dv);
    const offArr = pts.filter((p) => p.iv < 0.5).map((p) => p.dv);
    const sd = (arr: number[]) => { if (arr.length < 2) return 0; const m = arr.reduce((a, b) => a + b, 0) / arr.length; return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); };
    const pooledSd = Math.max(0.5, (sd(onArr) + sd(offArr)) / 2);
    const enoughGroups = onArr.length >= 3 && offArr.length >= 3;
    trend = enoughGroups && Math.abs(diff) >= 0.6 * pooledSd ? (diff > 0 ? 'positive' : 'negative') : 'neutral';
  }

  const dvAvg = (dvs.reduce((a, b) => a + b, 0) / dvs.length).toFixed(1);
  const unitDV = exp.dvUnit ? ` ${exp.dvUnit}` : '';
  const unitIV = exp.ivUnit ? ` ${exp.ivUnit}` : '';

  let text = '';
  if (exp.ivType === 'boolean') {
    const onCount = pts.filter((p) => p.iv >= 0.5).length;
    const offCount = pts.length - onCount;
    if (meanOn !== null && meanOff !== null) {
      const diffStr = Math.abs(meanOn - meanOff).toFixed(1);
      if (trend === 'positive') {
        text = L(dict,
          `过去 ${days} 天里，你有 ${onCount} 天进行了「${exp.ivName}」，${exp.dvName} 均值是 ${meanOn.toFixed(1)}${unitDV}；另外 ${offCount} 天均值是 ${meanOff.toFixed(1)}${unitDV}。差距约 ${diffStr}${unitDV}，你的数据支持这个假设。`,
          `Over the last ${days} days you did "${exp.ivName}" on ${onCount} of them — ${exp.dvName} averaged ${meanOn.toFixed(1)}${unitDV}, vs ${meanOff.toFixed(1)}${unitDV} on the other ${offCount}. A gap of about ${diffStr}${unitDV}: your data supports the hypothesis.`);
      } else if (trend === 'negative') {
        text = L(dict,
          `过去 ${days} 天，「${exp.ivName}」的日子里 ${exp.dvName} 均值反而更低（${meanOn.toFixed(1)} vs ${meanOff.toFixed(1)}${unitDV}）。数据和假设方向相反，可能有其他因素在影响结果。`,
          `Over the last ${days} days, ${exp.dvName} was actually lower on "${exp.ivName}" days (${meanOn.toFixed(1)} vs ${meanOff.toFixed(1)}${unitDV}). The data runs against the hypothesis — something else may be at play.`);
      } else {
        text = L(dict,
          `过去 ${days} 天，做与不做「${exp.ivName}」对 ${exp.dvName} 的影响不明显（${meanOn.toFixed(1)} vs ${meanOff.toFixed(1)}${unitDV}）。可以继续观察，或者看看是否有其他变量在起作用。`,
          `Over the last ${days} days, doing "${exp.ivName}" or not made little difference to ${exp.dvName} (${meanOn.toFixed(1)} vs ${meanOff.toFixed(1)}${unitDV}). Keep observing, or check for another variable.`);
      }
    }
  } else {
    if (r !== null) {
      const rStr = (r > 0 ? '+' : '') + r.toFixed(2);
      if (trend === 'positive') {
        text = L(dict,
          `过去 ${days} 次记录，${exp.ivName} 和 ${exp.dvName} 呈正相关（r = ${rStr}）。${exp.dvName} 整体均值 ${dvAvg}${unitDV}。增加 ${exp.ivName} 时，${exp.dvName} 有上升趋势。`,
          `Across ${days} logs, ${exp.ivName} and ${exp.dvName} correlate positively (r = ${rStr}). ${exp.dvName} averages ${dvAvg}${unitDV}, and rises as ${exp.ivName} increases.`);
      } else if (trend === 'negative') {
        text = L(dict,
          `过去 ${days} 次记录，${exp.ivName} 越高，${exp.dvName} 有下降趋势（r = ${rStr}）。${exp.dvName} 均值 ${dvAvg}${unitDV}。可以考虑降低 ${exp.ivName} 看看效果。`,
          `Across ${days} logs, higher ${exp.ivName} trends with lower ${exp.dvName} (r = ${rStr}). ${exp.dvName} averages ${dvAvg}${unitDV}. Try dialing ${exp.ivName} down and see.`);
      } else {
        text = L(dict,
          `过去 ${days} 次记录，${exp.ivName} 与 ${exp.dvName} 之间目前看不出明显关联（r = ${rStr}）。${exp.dvName} 均值 ${dvAvg}${unitDV}。继续记录，或许还需要更多数据。`,
          `Across ${days} logs, no clear link between ${exp.ivName} and ${exp.dvName} yet (r = ${rStr}). ${exp.dvName} averages ${dvAvg}${unitDV}. Keep logging — it may just need more data.`);
      }
    } else {
      text = L(dict,
        `已记录 ${days} 天，${exp.dvName} 均值 ${dvAvg}${unitDV}。再记录几天，相关性分析就可以开始了。`,
        `${days} days logged; ${exp.dvName} averages ${dvAvg}${unitDV}. A few more days and correlation analysis can start.`);
    }
  }

  return { r, meanOn, meanOff, trend, days, text };
}

// ── Tiny SVG Charts ───────────────────────────────────────────────────────────

function SparkDualLine({ pts, ivType }: { pts: ExpDataPoint[]; ivType: VarType }) {
  if (pts.length < 2) return null;
  const W = 280, H = 60, PAD = 4;
  const last = pts.slice(-14);
  const n = last.length;

  const ivVals = last.map((p) => p.iv);
  const dvVals = last.map((p) => p.dv);

  function norm(vals: number[], v: number) {
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const range = mx - mn || 1;
    return PAD + ((1 - (v - mn) / range) * (H - PAD * 2));
  }

  function path(vals: number[], all: number[]) {
    return last.map((p, i) => {
      const x = PAD + (i / (n - 1)) * (W - PAD * 2);
      const y = norm(all, vals[i]);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  if (ivType === 'boolean') {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="nesio-exp-chart">
        {/* boolean IV: colored background bands */}
        {last.map((p, i) => {
          const x = PAD + (i / (n - 1)) * (W - PAD * 2) - (W - PAD * 2) / n / 2;
          const bw = (W - PAD * 2) / n;
          return p.iv >= 0.5 ? (
            <rect key={i} x={x} y={PAD} width={bw} height={H - PAD * 2}
              fill="var(--portal-accent-soft)" rx="2" />
          ) : null;
        })}
        {/* DV line */}
        <path d={path(dvVals, dvVals)} fill="none" stroke="var(--status-go)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        {last.map((p, i) => {
          const x = PAD + (i / (n - 1)) * (W - PAD * 2);
          const y = norm(dvVals, p.dv);
          return <circle key={i} cx={x} cy={y} r="2.5" fill="var(--status-go)" />;
        })}
      </svg>
    );
  }

  const allIv = ivVals, allDv = dvVals;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="nesio-exp-chart">
      {/* IV area fill */}
      <path
        d={`${path(ivVals, allIv)} L${(PAD + (n - 1) / (n - 1) * (W - PAD * 2)).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`}
        fill="var(--portal-accent-soft)" />
      {/* IV line */}
      <path d={path(ivVals, allIv)} fill="none" stroke="var(--portal-blue-deep)" strokeWidth="1.5" strokeLinecap="round" />
      {/* DV line */}
      <path d={path(dvVals, allDv)} fill="none" stroke="var(--status-go)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="0" />
      {last.map((p, i) => {
        const x = PAD + (i / (n - 1)) * (W - PAD * 2);
        return <circle key={i} cx={x} cy={norm(dvVals, p.dv)} r="2.5" fill="var(--status-go)" />;
      })}
    </svg>
  );
}

function ScatterPlot({ pts, ivType }: { pts: ExpDataPoint[]; ivType: VarType }) {
  if (pts.length < 4 || ivType === 'boolean') return null;
  const W = 240, H = 120, PAD = 16;

  const ivs = pts.map((p) => p.iv);
  const dvs = pts.map((p) => p.dv);
  const mnX = Math.min(...ivs), mxX = Math.max(...ivs);
  const mnY = Math.min(...dvs), mxY = Math.max(...dvs);
  const rx = mxX - mnX || 1, ry = mxY - mnY || 1;

  function px(v: number) { return PAD + ((v - mnX) / rx) * (W - PAD * 2); }
  function py(v: number) { return H - PAD - ((v - mnY) / ry) * (H - PAD * 2); }

  // linear regression for trend line
  const n = pts.length;
  const mx = ivs.reduce((a, b) => a + b, 0) / n;
  const my = dvs.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (ivs[i] - mx) * (dvs[i] - my); den += (ivs[i] - mx) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const y1 = slope * mnX + intercept;
  const y2 = slope * mxX + intercept;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="nesio-exp-scatter">
      {/* trend line */}
      <line x1={px(mnX)} y1={py(y1)} x2={px(mxX)} y2={py(y2)}
        stroke="var(--portal-blue-deep)" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.6" />
      {/* points */}
      {pts.map((p, i) => (
        <circle key={i} cx={px(p.iv)} cy={py(p.dv)} r="3.5"
          fill="var(--portal-accent-soft-md)" stroke="var(--portal-blue-deep)" strokeWidth="1" />
      ))}
    </svg>
  );
}

// ── Trend Badge ───────────────────────────────────────────────────────────────

function TrendBadge({ trend }: { trend: ExpInsight['trend'] }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  if (trend === 'insufficient') return null;
  const map = {
    positive: { label: L(dict, '正相关', 'Positive'), style: { background: 'var(--status-go-soft)', color: 'var(--status-go)' } },
    negative: { label: L(dict, '负相关', 'Negative'), style: { background: 'var(--status-risk-soft)', color: 'var(--status-risk)' } },
    neutral:  { label: L(dict, '暂无关联', 'No link yet'), style: { background: 'var(--status-calm-soft)', color: 'var(--status-calm)' } },
  } as const;
  const { label, style } = map[trend as keyof typeof map];
  return <span className="nesio-exp-trend-badge" style={style}>{label}</span>;
}

// ── Progress Arc ──────────────────────────────────────────────────────────────

function ProgressArc({ done, total }: { done: number; total: number }) {
  const pct = Math.min(done / total, 1);
  const R = 18, CX = 22, CY = 22;
  const circ = 2 * Math.PI * R;
  const dash = pct * circ;
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="nesio-exp-arc">
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--portal-line)" strokeWidth="3" />
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--portal-blue-deep)" strokeWidth="3"
        strokeDasharray={`${dash.toFixed(1)} ${circ.toFixed(1)}`}
        strokeLinecap="round" transform={`rotate(-90 ${CX} ${CY})`} />
      <text x={CX} y={CY + 4} textAnchor="middle" fontSize="9" fill="var(--portal-ink)" fontWeight="600">{done}</text>
    </svg>
  );
}

// ── Create Wizard ─────────────────────────────────────────────────────────────

const VAR_TYPE_OPTS: { value: VarType; label: string; labelEn: string; hint: string; hintEn: string }[] = [
  { value: 'scale',   label: '评分 1–10', labelEn: 'Score 1–10', hint: '主观感受，如精力/心情/专注度', hintEn: 'Subjective feel: energy / mood / focus' },
  { value: 'number',  label: '具体数值',  labelEn: 'Number',     hint: '客观数据，如睡眠时长/步数/咖啡量', hintEn: 'Objective data: sleep hours / steps / coffees' },
  { value: 'boolean', label: '是 / 否',   labelEn: 'Yes / No',   hint: '有没有做某件事', hintEn: 'Did you do the thing or not' },
];

const TARGET_DAYS_OPTS = [7, 14, 21, 30];

interface WizardProps {
  onSave: (exp: Experiment) => void;
  onCancel: () => void;
}

export function CreateExperimentWizard({ onSave, onCancel }: WizardProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [hypo, setHypo] = useState('');
  const [ivName, setIvName] = useState('');
  const [ivUnit, setIvUnit] = useState('');
  const [ivType, setIvType] = useState<VarType>('number');
  const [dvName, setDvName] = useState('');
  const [dvUnit, setDvUnit] = useState('');
  const [dvType, setDvType] = useState<VarType>('scale');
  const [targetDays, setTargetDays] = useState(14);

  function save() {
    const exp: Experiment = {
      id: `exp_${Date.now()}`,
      name: name.trim(),
      hypothesis: hypo.trim(),
      ivName: ivName.trim() || L(dict, '干预变量', 'Intervention'),
      ivUnit: ivUnit.trim(),
      ivType,
      dvName: dvName.trim() || L(dict, '结果变量', 'Outcome'),
      dvUnit: dvUnit.trim(),
      dvType,
      targetDays,
      startedAt: new Date().toISOString(),
      dataPoints: [],
      concluded: false,
    };
    onSave(exp);
  }

  const canStep0 = name.trim().length > 0;
  const canStep1 = ivName.trim().length > 0;
  const canStep2 = dvName.trim().length > 0;

  return (
    <div className="nesio-exp-wizard">
      <div className="nesio-exp-wizard-steps">
        {[L(dict, '基本信息', 'Basics'), L(dict, '干预变量', 'Intervention'), L(dict, '结果 & 目标', 'Outcome & goal')].map((s, i) => (
          <div key={i} className={`nesio-exp-step-dot${i === step ? ' active' : i < step ? ' done' : ''}`} />
        ))}
      </div>

      {step === 0 && (
        <div className="nesio-exp-wizard-body">
          <p className="nesio-exp-wizard-label">{L(dict, '这个实验叫什么？', 'What is this experiment called?')}</p>
          <input className="nesio-exp-input" autoFocus
            placeholder={L(dict, '例：早睡对晨间精力的影响', 'e.g. Early sleep vs. morning energy')}
            value={name} onChange={(e) => setName(e.target.value)} />
          <p className="nesio-exp-wizard-label" style={{ marginTop: '0.9rem' }}>{L(dict, '你的假设（可选）', 'Your hypothesis (optional)')}</p>
          <input className="nesio-exp-input"
            placeholder={L(dict, '例：如果我在 11 点前入睡，第二天精力评分会更高', 'e.g. If I sleep before 11pm, next-day energy scores higher')}
            value={hypo} onChange={(e) => setHypo(e.target.value)} />
          <div className="nesio-exp-wizard-actions">
            <button type="button" className="nesio-exp-cancel-btn" onClick={onCancel}>{L(dict, '取消', 'Cancel')}</button>
            <button type="button" className="nesio-exp-next-btn" onClick={() => setStep(1)} disabled={!canStep0}>{L(dict, '下一步', 'Next')}</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="nesio-exp-wizard-body">
          <p className="nesio-exp-wizard-label">{L(dict, '你要改变或追踪什么？（干预 / 自变量）', 'What will you change or track? (intervention / independent variable)')}</p>
          <input className="nesio-exp-input" autoFocus
            placeholder={L(dict, '例：入睡时间、咖啡杯数、运动时长', 'e.g. bedtime, cups of coffee, workout minutes')}
            value={ivName} onChange={(e) => setIvName(e.target.value)} />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <input className="nesio-exp-input" style={{ flex: 1 }} placeholder={L(dict, '单位（可选）', 'Unit (optional)')}
              value={ivUnit} onChange={(e) => setIvUnit(e.target.value)} />
          </div>
          <p className="nesio-exp-wizard-label" style={{ marginTop: '0.9rem' }}>{L(dict, '记录方式', 'How to record')}</p>
          <div className="nesio-exp-type-opts">
            {VAR_TYPE_OPTS.map((o) => (
              <button key={o.value} type="button"
                className={`nesio-exp-type-btn${ivType === o.value ? ' active' : ''}`}
                onClick={() => setIvType(o.value)}>
                <span className="nesio-exp-type-label">{L(dict, o.label, o.labelEn)}</span>
                <span className="nesio-exp-type-hint">{L(dict, o.hint, o.hintEn)}</span>
              </button>
            ))}
          </div>
          <div className="nesio-exp-wizard-actions">
            <button type="button" className="nesio-exp-cancel-btn" onClick={() => setStep(0)}>{L(dict, '上一步', 'Back')}</button>
            <button type="button" className="nesio-exp-next-btn" onClick={() => setStep(2)} disabled={!canStep1}>{L(dict, '下一步', 'Next')}</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="nesio-exp-wizard-body">
          <p className="nesio-exp-wizard-label">{L(dict, '你期待哪个指标发生变化？（结果 / 因变量）', 'Which metric do you expect to change? (outcome / dependent variable)')}</p>
          <input className="nesio-exp-input" autoFocus
            placeholder={L(dict, '例：晨间精力、睡眠质量、专注时长', 'e.g. morning energy, sleep quality, focus time')}
            value={dvName} onChange={(e) => setDvName(e.target.value)} />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <input className="nesio-exp-input" style={{ flex: 1 }} placeholder={L(dict, '单位（可选）', 'Unit (optional)')}
              value={dvUnit} onChange={(e) => setDvUnit(e.target.value)} />
          </div>
          <p className="nesio-exp-wizard-label" style={{ marginTop: '0.9rem' }}>{L(dict, '记录方式', 'How to record')}</p>
          <div className="nesio-exp-type-opts">
            {VAR_TYPE_OPTS.filter((o) => o.value !== 'boolean').map((o) => (
              <button key={o.value} type="button"
                className={`nesio-exp-type-btn${dvType === o.value ? ' active' : ''}`}
                onClick={() => setDvType(o.value as VarType)}>
                <span className="nesio-exp-type-label">{L(dict, o.label, o.labelEn)}</span>
                <span className="nesio-exp-type-hint">{L(dict, o.hint, o.hintEn)}</span>
              </button>
            ))}
          </div>
          <p className="nesio-exp-wizard-label" style={{ marginTop: '0.9rem' }}>{L(dict, '实验持续天数', 'Experiment length (days)')}</p>
          <div className="nesio-exp-days-opts">
            {TARGET_DAYS_OPTS.map((d) => (
              <button key={d} type="button"
                className={`nesio-exp-days-btn${targetDays === d ? ' active' : ''}`}
                onClick={() => setTargetDays(d)}>{L(dict, `${d} 天`, `${d} days`)}</button>
            ))}
          </div>
          <div className="nesio-exp-wizard-actions">
            <button type="button" className="nesio-exp-cancel-btn" onClick={() => setStep(1)}>{L(dict, '上一步', 'Back')}</button>
            <button type="button" className="nesio-exp-create-btn" onClick={save} disabled={!canStep2}>{L(dict, '开始实验', 'Start experiment')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Log Panel ─────────────────────────────────────────────────────────────────

/** number 型变量的步进输入:上次值起步,+/- 点按,点数值可直改(批次 5 去手动填写)。 */
function NumberStepper({ value, onChange, unit }: { value: string; onChange: (v: string) => void; unit?: string }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [editing, setEditing] = useState(false);
  const n = parseFloat(value);
  const cur = Number.isNaN(n) ? 0 : n;
  // 恒定步长 1:时刻/次数类数值居多,粗步长会打错(实测 23点−5=18)
  const step = 1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
      <button type="button" aria-label={L(dict, '减少', 'Decrease')}
        style={{ width: 'var(--tap-min)', height: 'var(--tap-min)', borderRadius: '50%', border: '1.5px solid var(--portal-line)', background: 'var(--glass-bg-solid)', color: 'var(--portal-ink)', fontSize: '1.15rem', cursor: 'pointer' }}
        onClick={() => onChange(String(Math.max(0, cur - step)))}>−</button>
      {editing ? (
        <input className="nesio-exp-log-input" type="number" autoFocus value={value}
          style={{ width: '5.5rem', textAlign: 'center' }}
          onChange={(e) => onChange(e.target.value)} onBlur={() => setEditing(false)} />
      ) : (
        <button type="button" onClick={() => setEditing(true)}
          style={{ minWidth: '5.5rem', minHeight: 'var(--tap-min)', border: 'none', background: 'none', cursor: 'text', fontSize: '1.3rem', fontWeight: 700, color: value === '' ? 'var(--portal-muted)' : 'var(--portal-ink)' }}>
          {value === '' ? '0' : value}{unit ? <span style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--portal-muted)', marginLeft: 3 }}>{unit}</span> : null}
        </button>
      )}
      <button type="button" aria-label={L(dict, '增加', 'Increase')}
        style={{ width: 'var(--tap-min)', height: 'var(--tap-min)', borderRadius: '50%', border: '1.5px solid var(--portal-line)', background: 'var(--glass-bg-solid)', color: 'var(--portal-ink)', fontSize: '1.15rem', cursor: 'pointer' }}
        onClick={() => onChange(String(cur + step))}>＋</button>
    </div>
  );
}

export function LogPanel({ exp, onLog }: { exp: Experiment; onLog: (iv: number, dv: number, note: string) => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const last = exp.dataPoints[exp.dataPoints.length - 1];
  const [iv, setIv] = useState(exp.ivType === 'number' && last ? String(last.iv) : '');
  const [dv, setDv] = useState(exp.dvType === 'number' && last ? String(last.dv) : '');
  const [note, setNote] = useState('');
  const [scaleIv, setScaleIv] = useState(0);
  const [scaleDv, setScaleDv] = useState(0);
  const [boolIv, setBoolIv] = useState<boolean | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const alreadyLogged = exp.dataPoints.some((p) => p.date === today);

  function submit() {
    let ivVal: number;
    let dvVal: number;

    if (exp.ivType === 'boolean') {
      if (boolIv === null) return;
      ivVal = boolIv ? 1 : 0;
    } else if (exp.ivType === 'scale') {
      if (!scaleIv) return;
      ivVal = scaleIv;
    } else {
      ivVal = parseFloat(iv);
      if (Number.isNaN(ivVal)) return;
    }

    if (exp.dvType === 'scale') {
      if (!scaleDv) return;
      dvVal = scaleDv;
    } else {
      dvVal = parseFloat(dv);
      if (Number.isNaN(dvVal)) return;
    }

    onLog(ivVal, dvVal, note.trim());
    setIv(''); setDv(''); setNote(''); setScaleIv(0); setScaleDv(0); setBoolIv(null);
  }

  if (alreadyLogged) {
    return (
      <div className="nesio-exp-logged-today">
        <span>✓</span> {L(dict, '今天已记录', 'Logged today')}
      </div>
    );
  }

  return (
    <div className="nesio-exp-log-panel">
      <p className="nesio-exp-log-title">{L(dict, '今日记录', "Today's log")}</p>

      {/* IV input */}
      <div className="nesio-exp-log-row">
        <span className="nesio-exp-log-label">{exp.ivName}{exp.ivUnit ? ` (${exp.ivUnit})` : ''}</span>
        {exp.ivType === 'boolean' ? (
          <div className="nesio-exp-bool-row">
            <button type="button" className={`nesio-exp-bool-btn${boolIv === true ? ' active' : ''}`} onClick={() => setBoolIv(true)}>✓ {L(dict, '是', 'Yes')}</button>
            <button type="button" className={`nesio-exp-bool-btn${boolIv === false ? ' active' : ''}`} onClick={() => setBoolIv(false)}>✗ {L(dict, '否', 'No')}</button>
          </div>
        ) : exp.ivType === 'scale' ? (
          <div className="nesio-exp-scale-row">
            {[1,2,3,4,5,6,7,8,9,10].map((n) => (
              <button key={n} type="button" className={`nesio-exp-scale-btn${scaleIv === n ? ' active' : ''}`} onClick={() => setScaleIv(n)}>{n}</button>
            ))}
          </div>
        ) : (
          <NumberStepper value={iv} onChange={setIv} unit={exp.ivUnit} />
        )}
      </div>

      {/* DV input */}
      <div className="nesio-exp-log-row">
        <span className="nesio-exp-log-label">{exp.dvName}{exp.dvUnit ? ` (${exp.dvUnit})` : ''}</span>
        {exp.dvType === 'scale' ? (
          <div className="nesio-exp-scale-row">
            {[1,2,3,4,5,6,7,8,9,10].map((n) => (
              <button key={n} type="button" className={`nesio-exp-scale-btn${scaleDv === n ? ' active' : ''}`} onClick={() => setScaleDv(n)}>{n}</button>
            ))}
          </div>
        ) : (
          <NumberStepper value={dv} onChange={setDv} unit={exp.dvUnit} />
        )}
      </div>

      <input className="nesio-exp-log-note" placeholder={L(dict, '今天有什么特别的事？（可选）', 'Anything special today? (optional)')} value={note} onChange={(e) => setNote(e.target.value)} />

      <button type="button" className="nesio-exp-log-submit" onClick={submit}>{L(dict, '记录今天', 'Log today')}</button>
    </div>
  );
}

// ── Experiment Detail View ────────────────────────────────────────────────────

interface DetailProps {
  exp: Experiment;
  onLog: (expId: string, iv: number, dv: number, note: string) => void;
  onConclude: (expId: string, conclusion: string) => void;
  onDelete: (expId: string) => void;
  onBack: () => void;
}

export function ExperimentDetail({ exp, onLog, onConclude, onDelete, onBack }: DetailProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [showConclude, setShowConclude] = useState(false);
  const [conclusionText, setConclusionText] = useState('');
  const insight = computeInsight(exp, dict);
  const progress = exp.dataPoints.length;
  const daysSince = Math.floor((Date.now() - new Date(exp.startedAt).getTime()) / 86_400_000);

  return (
    <div className="nesio-exp-detail">
      <div className="nesio-exp-detail-header">
        <button type="button" className="nesio-exp-back-btn" onClick={onBack}>{L(dict, '← 返回', '← Back')}</button>
        <span className="nesio-exp-detail-title">{exp.name}</span>
        {!exp.concluded && (
          <button type="button" className="nesio-exp-menu-btn" onClick={() => setShowConclude(true)}>{L(dict, '结束实验', 'End experiment')}</button>
        )}
      </div>

      {exp.hypothesis && (
        <div className="nesio-exp-hypo-block">
          <span className="nesio-exp-hypo-label">{L(dict, '假设', 'Hypothesis')}</span>
          <p className="nesio-exp-hypo-text">{exp.hypothesis}</p>
        </div>
      )}

      <div className="nesio-exp-meta-row">
        <div className="nesio-exp-meta-item">
          <ProgressArc done={progress} total={exp.targetDays} />
          <div>
            <p className="nesio-exp-meta-val">{L(dict, `${progress} / ${exp.targetDays} 天`, `${progress} / ${exp.targetDays} days`)}</p>
            <p className="nesio-exp-meta-sub">{L(dict, `已持续 ${daysSince} 天`, `${daysSince} days in`)}</p>
          </div>
        </div>
        <div className="nesio-exp-vars-col">
          <span className="nesio-exp-var-chip iv">{exp.ivName}</span>
          <span className="nesio-exp-var-chip dv">{exp.dvName}</span>
        </div>
      </div>

      {/* Chart */}
      {exp.dataPoints.length >= 2 && (
        <div className="nesio-exp-chart-block">
          <div className="nesio-exp-chart-legend">
            <span className="nesio-exp-legend iv">— {exp.ivName}</span>
            <span className="nesio-exp-legend dv">— {exp.dvName}</span>
          </div>
          <SparkDualLine pts={exp.dataPoints} ivType={exp.ivType} />
        </div>
      )}

      {/* Scatter for continuous */}
      {exp.dataPoints.length >= 4 && exp.ivType !== 'boolean' && (
        <div className="nesio-exp-scatter-block">
          <p className="nesio-exp-scatter-label">{L(dict, '相关散点图', 'Correlation scatter')}</p>
          <div className="nesio-exp-scatter-wrap">
            <ScatterPlot pts={exp.dataPoints} ivType={exp.ivType} />
            <div className="nesio-exp-scatter-axes">
              <span className="nesio-exp-axis-x">{exp.ivName}</span>
              <span className="nesio-exp-axis-y">{exp.dvName}</span>
            </div>
          </div>
        </div>
      )}

      {/* Insight */}
      <div className={`nesio-exp-insight-block${insight.trend === 'insufficient' ? ' pending' : ''}`}>
        <div className="nesio-exp-insight-head">
          <span className="nesio-exp-insight-icon">
            {insight.trend === 'positive' ? <IconTrendingUp size={15} /> : insight.trend === 'negative' ? <IconTrendingDown size={15} /> : insight.trend === 'insufficient' ? <IconClock size={15} /> : <IconActivity size={15} />}
          </span>
          <span className="nesio-exp-insight-title">{L(dict, '数据说明', 'What the data says')}</span>
          <TrendBadge trend={insight.trend} />
        </div>
        <p className="nesio-exp-insight-text">{insight.text}</p>
        {insight.r !== null && (
          <p className="nesio-exp-insight-stat">
            Pearson r = {insight.r > 0 ? '+' : ''}{insight.r.toFixed(2)}
            {Math.abs(insight.r) > 0.5 ? L(dict, '（强）', ' (strong)') : Math.abs(insight.r) > 0.3 ? L(dict, '（中）', ' (moderate)') : L(dict, '（弱）', ' (weak)')}
          </p>
        )}
        {insight.meanOn !== null && insight.meanOff !== null && exp.ivType === 'boolean' && (
          <div className="nesio-exp-compare-row">
            <div className="nesio-exp-compare-item on">
              <span className="nesio-exp-compare-label">{L(dict, `有「${exp.ivName}」`, `With "${exp.ivName}"`)}</span>
              <span className="nesio-exp-compare-val">{insight.meanOn.toFixed(1)}</span>
            </div>
            <div className="nesio-exp-compare-item off">
              <span className="nesio-exp-compare-label">{L(dict, `无「${exp.ivName}」`, `Without "${exp.ivName}"`)}</span>
              <span className="nesio-exp-compare-val">{insight.meanOff.toFixed(1)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Log today */}
      {!exp.concluded && (
        <LogPanel exp={exp} onLog={(iv, dv, note) => onLog(exp.id, iv, dv, note)} />
      )}

      {/* History */}
      {exp.dataPoints.length > 0 && (
        <div className="nesio-exp-history">
          <p className="nesio-exp-history-label">{L(dict, '记录历史', 'History')}</p>
          <div className="nesio-exp-history-list">
            {[...exp.dataPoints].reverse().slice(0, 20).map((p, i) => (
              <div key={i} className="nesio-exp-history-row">
                <span className="nesio-exp-history-date">{p.date.slice(5)}</span>
                <span className="nesio-exp-history-iv">
                  {exp.ivType === 'boolean' ? (p.iv ? L(dict, '✓ 是', '✓ Yes') : L(dict, '✗ 否', '✗ No')) : `${p.iv}${exp.ivUnit}`}
                </span>
                <span className="nesio-exp-history-dv">{p.dv}{exp.dvUnit}</span>
                {p.note && <span className="nesio-exp-history-note">{p.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conclude modal */}
      {showConclude && (
        <div className="nesio-exp-conclude-overlay" onClick={() => setShowConclude(false)}>
          <div className="nesio-exp-conclude-modal" onClick={(e) => e.stopPropagation()}>
            <p className="nesio-exp-conclude-title">{L(dict, '结束这个实验', 'End this experiment')}</p>
            <p className="nesio-exp-conclude-sub">{L(dict, '记录一下你的结论（可选）', 'Note your conclusion (optional)')}</p>
            <textarea className="nesio-exp-conclude-text"
              placeholder={L(dict, '根据数据，我得出……', 'Based on the data, I conclude…')}
              value={conclusionText} onChange={(e) => setConclusionText(e.target.value)} rows={3} />
            <div className="nesio-exp-conclude-actions">
              <button type="button" className="nesio-exp-cancel-btn" onClick={() => setShowConclude(false)}>{L(dict, '继续实验', 'Keep going')}</button>
              <button type="button" className="nesio-exp-create-btn" onClick={() => { onConclude(exp.id, conclusionText); setShowConclude(false); }}>{L(dict, '确认结束', 'Confirm end')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Conclusion (concluded) */}
      {exp.concluded && (
        <div className="nesio-exp-conclusion-block">
          <p className="nesio-exp-conclusion-label">{L(dict, '✓ 实验已完成', '✓ Experiment complete')}</p>
          {exp.conclusion && <p className="nesio-exp-conclusion-text">{exp.conclusion}</p>}
          <button type="button" className="nesio-exp-delete-btn" onClick={() => onDelete(exp.id)}>{L(dict, '删除实验', 'Delete experiment')}</button>
        </div>
      )}
    </div>
  );
}

// ── Compact Card (in widget list) ─────────────────────────────────────────────

interface CardProps {
  exp: Experiment;
  onOpen: () => void;
  onQuickLog: (expId: string, iv: number, dv: number) => void;
}

function ExperimentCard({ exp, onOpen, onQuickLog }: CardProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const insight = computeInsight(exp, dict);
  const progress = exp.dataPoints.length;
  const today = new Date().toISOString().slice(0, 10);
  const loggedToday = exp.dataPoints.some((p) => p.date === today);

  const lastPt = exp.dataPoints[exp.dataPoints.length - 1];
  const lastIvDisplay = lastPt
    ? (exp.ivType === 'boolean' ? (lastPt.iv ? L(dict, '是', 'Yes') : L(dict, '否', 'No')) : `${lastPt.iv}${exp.ivUnit}`)
    : null;

  return (
    <div className={`nesio-exp-card${exp.concluded ? ' concluded' : ''}`} onClick={onOpen}>
      <div className="nesio-exp-card-top">
        <div className="nesio-exp-card-info">
          <span className="nesio-exp-card-name">{exp.name}</span>
          <div className="nesio-exp-card-vars">
            <span className="nesio-exp-var-tag">{exp.ivName}</span>
            <span className="nesio-exp-var-arrow">→</span>
            <span className="nesio-exp-var-tag">{exp.dvName}</span>
          </div>
        </div>
        <ProgressArc done={progress} total={exp.targetDays} />
      </div>

      {exp.dataPoints.length >= 2 && (
        <SparkDualLine pts={exp.dataPoints} ivType={exp.ivType} />
      )}

      <div className="nesio-exp-card-footer">
        {insight.trend !== 'insufficient' ? (
          <TrendBadge trend={insight.trend} />
        ) : (
          <span className="nesio-exp-card-hint">{L(dict, `还需 ${Math.max(0, 5 - progress)} 次打卡`, `${Math.max(0, 5 - progress)} more check-ins needed`)}</span>
        )}
        {lastIvDisplay && <span className="nesio-exp-last-val">{L(dict, `上次：${lastIvDisplay}`, `Last: ${lastIvDisplay}`)}</span>}
        {!exp.concluded && !loggedToday && (
          <button type="button" className="nesio-exp-quick-log-btn"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}>
            {L(dict, '打卡', 'Check in')}
          </button>
        )}
        {loggedToday && <span className="nesio-exp-card-done">{L(dict, '今日 ✓', 'Today ✓')}</span>}
      </div>
    </div>
  );
}

// ── Main Widget ───────────────────────────────────────────────────────────────

export function MyExperimentWidget() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => { setExperiments(loadExperiments()); }, []);

  function mutate(next: Experiment[]) {
    setExperiments(next);
    saveExperiments(next);
  }

  const handleSave = useCallback((exp: Experiment) => {
    mutate([exp, ...experiments]);
    setDetailId(exp.id);
    setView('detail');
  }, [experiments]);

  const handleLog = useCallback((expId: string, iv: number, dv: number, note: string) => {
    const today = new Date().toISOString().slice(0, 10);
    mutate(experiments.map((e) => e.id !== expId ? e : {
      ...e,
      dataPoints: [...e.dataPoints.filter((p) => p.date !== today), { date: today, iv, dv, note }],
    }));
  }, [experiments]);

  const handleQuickLog = useCallback((expId: string, iv: number, dv: number) => {
    handleLog(expId, iv, dv, '');
  }, [handleLog]);

  const handleConclude = useCallback((expId: string, conclusion: string) => {
    mutate(experiments.map((e) => e.id !== expId ? e : { ...e, concluded: true, conclusion }));
    setView('list');
  }, [experiments]);

  const handleDelete = useCallback((expId: string) => {
    mutate(experiments.filter((e) => e.id !== expId));
    setView('list');
  }, [experiments]);

  const detailExp = detailId ? experiments.find((e) => e.id === detailId) : null;

  if (view === 'create') {
    return (
      <div className="nesio-exp-widget">
        <CreateExperimentWizard onSave={handleSave} onCancel={() => setView('list')} />
      </div>
    );
  }

  if (view === 'detail' && detailExp) {
    return (
      <div className="nesio-exp-widget">
        <ExperimentDetail
          exp={detailExp}
          onLog={handleLog}
          onConclude={handleConclude}
          onDelete={handleDelete}
          onBack={() => setView('list')}
        />
      </div>
    );
  }

  const active = experiments.filter((e) => !e.concluded);
  const done = experiments.filter((e) => e.concluded);

  return (
    <div className="nesio-exp-widget">
      {experiments.length === 0 && (
        <div className="nesio-exp-empty">
          <p className="nesio-exp-empty-icon"><IconTarget size={30} /></p>
          <p className="nesio-exp-empty-title">{L(dict, '还没有实验', 'No experiments yet')}</p>
          <p className="nesio-exp-empty-hint">
            {L(dict, '设定一个变量，每天记录数据，用你自己的数字看趋势。', 'Pick a variable, log it daily, and watch the trend in your own numbers.')}<br />
            {L(dict, '比如：「早睡 → 晨间精力」或「运动量 → 睡眠质量」', 'e.g. "early sleep → morning energy" or "exercise → sleep quality"')}
          </p>
        </div>
      )}

      {active.map((exp) => (
        <ExperimentCard key={exp.id} exp={exp}
          onOpen={() => { setDetailId(exp.id); setView('detail'); }}
          onQuickLog={handleQuickLog} />
      ))}

      {done.length > 0 && (
        <div className="nesio-exp-done-section">
          <p className="nesio-exp-done-label">{L(dict, `已完成 ${done.length} 个`, `${done.length} completed`)}</p>
          {done.map((exp) => (
            <div key={exp.id} className="nesio-exp-done-row"
              onClick={() => { setDetailId(exp.id); setView('detail'); }}>
              <span>{exp.name}</span>
              <TrendBadge trend={computeInsight(exp, dict).trend} />
            </div>
          ))}
        </div>
      )}

      <button type="button" className="nesio-exp-add-btn" onClick={() => setView('create')}>
        {L(dict, '+ 新建实验', '+ New experiment')}
      </button>
    </div>
  );
}
