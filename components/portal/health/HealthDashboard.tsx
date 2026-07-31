'use client';

/**
 * HealthDashboard — Apple Health 指标看板(批次 39)。洞察 → 「健康」tab。
 * 读 nesio-health-v1(Apple Health 导入解析出的最新指标),按组渲染卡片:
 * 活动 / 心脏 / 身体成分 / 生命体征 / 身心。每张卡显示最新值 + 相对上次的变化。
 */

import { useEffect, useState } from 'react';
import FamilyDataCard from '../relationships/FamilyDataCard';
import { loadHealthMetrics } from '@/lib/portal/health-store';
import type { HealthMetric, HealthMetrics, GlucoseAnalysis, SleepStages, ActivityRings, MoodAnalysis } from '@/lib/portal/apple-health';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { computeFitnessInsight, type FitnessInsight } from '@/lib/platform/fitness-integrator';
import { loadTrainingState, sessionsThisWeek, protocolById } from '@/lib/platform/training-protocol-engine';
import { workoutSessionsThisWeek } from '@/lib/portal/workout-store';
import { analyzeSeries } from '@/lib/portal/health-narrative';
import { mineRelationships } from '@/lib/portal/health-correlations';
import { loadClinical, type StoredClinical } from '@/lib/portal/clinical-store';
import { readLaunchSurfaceContextFromBrowser } from '@/lib/portal/launch-surface.mjs';
import { evaluateHealthFindings, type Severity } from '@/lib/portal/health-clinical';
import { computeRiskScores, type RiskCategory } from '@/lib/portal/health-risk';
import { buildMonthlyHealthReport, persistHealthReportToMemory, autoPersistLastMonthHealthReport, healthMonths } from '@/lib/portal/health-report';
import { healthReportRichHtml } from '@/lib/portal/health-report-visual';
import SegTabs from '../ui/SegTabs';
import { guardPaidCloudAi } from '@/lib/portal/entitlement';
import BodyLedgerPanel, { PostMealBody, BodyLedgerAnalysisCards } from './BodyLedgerPanel';
// bug3 p40:「稳 / 飙」并进健康提示 —— 排序本身还是同一个确定性函数,只是渲染换了地方
import { rankFoodReactions, mgDlToDisplay } from '@/lib/portal/body-ledger';
import { getMeals } from '@/lib/cooking/meals';
import BeautyCarePanel from './BeautyCarePanel';
import HealthLensCards from './HealthLensCards';
import MoodTrendCard from './MoodTrendCard';
import HealthRecordSheet from './HealthRecordSheet';
import MetricDetailSheet from './MetricDetailSheet';
import LabScanSheet from './LabScanSheet';

const TREND_HEADLINE: Record<FitnessInsight['trend'], [string, string]> = {
  up: ['体能上升中', 'Fitness rising'], flat: ['体能维持中', 'Holding steady'], down: ['体能下降中', 'Fitness dipping'], unknown: ['数据积累中', 'Gathering data'],
};

function FitnessPanel({ insight, dict }: { insight: FitnessInsight; dict: string }) {
  return (
    <div className="nesio-fit-panel">
      <p className="nesio-fit-headline">{L(dict, TREND_HEADLINE[insight.trend][0], TREND_HEADLINE[insight.trend][1])}</p>
      <div className="nesio-fit-signals">
        {insight.signals.map((s) => (
          <div key={s.key} className={`nesio-fit-sig nesio-fit-sig--${s.tone}`}>
            <span className="nesio-fit-sig-label">{L(dict, s.label[0], s.label[1])}</span>
            <span className="nesio-fit-sig-value">{s.value}</span>
            <span className="nesio-fit-sig-note">{L(dict, s.note[0], s.note[1])}</span>
          </div>
        ))}
      </div>
      <p className="nesio-fit-suggest">{L(dict, insight.suggestion[0], insight.suggestion[1])}</p>
      <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>{L(dict, '按规则从你的指标+训练打卡推出(非 AI)', 'Rule-based from your metrics + training log (not AI)')}</p>
    </div>
  );
}

const GROUPS: Array<{ key: HealthMetric['group']; zh: string; en: string }> = [
  { key: 'activity', zh: '活动', en: 'Activity' },
  { key: 'heart', zh: '心脏与体能', en: 'Heart & fitness' },
  { key: 'vitals', zh: '生命体征', en: 'Vitals' },
  { key: 'body', zh: '身体成分', en: 'Body' },
  { key: 'nutrition', zh: '营养', en: 'Nutrition' },
  { key: 'mind', zh: '身心', en: 'Mind & body' },
];

function fmt(v: number, decimals: number): string {
  return decimals === 0 ? Math.round(v).toLocaleString() : v.toFixed(decimals);
}

// 批次 40:按月历史趋势曲线(多年)+ 高峰/低谷/anomaly 标注
function Sparkline({ series }: { series: Array<{ ym: string; v: number }> }) {
  const vals = series.map((s) => s.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 100;
  const H = 26;
  const xy = (i: number) => ({ x: series.length > 1 ? (i / (series.length - 1)) * W : 0, y: H - ((vals[i] - min) / range) * H });
  const pts = series.map((_, i) => { const p = xy(i); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');
  const pat = analyzeSeries(series);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="26" preserveAspectRatio="none" style={{ marginTop: 'var(--space-1)', overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke="var(--portal-blue-deep)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {/* 2026-07-29:这三个色值原本是硬编码(#e0954a/#3d9f6e/#c25d7a),违反配色红线 ——
          夜间主题下不跟着翻转。换成 token:高峰=琥珀、低谷=完成绿、异常=中性信息色。
          异常刻意**不用** --status-risk:一次离群点不是风险,红色只留给真实风险。 */}
      {pat && (() => { const p = xy(pat.peakIdx); return <circle cx={p.x} cy={p.y} r="2.2" fill="var(--status-gentle)" />; })()}
      {pat && (() => { const p = xy(pat.valleyIdx); return <circle cx={p.x} cy={p.y} r="2.2" fill="var(--status-go)" />; })()}
      {pat?.anomalyIdx != null && (() => { const p = xy(pat.anomalyIdx); return <circle cx={p.x} cy={p.y} r="2.6" fill="none" stroke="var(--status-calm)" strokeWidth="1.4" />; })()}
      <circle cx={W} cy={xy(series.length - 1).y} r="2" fill="var(--portal-blue-deep)" />
    </svg>
  );
}

// "较上次"在两次读数间隔较大时改说"较 N 月前",避免拿一年前的读数冒充"较上次"。
function gapLabel(m: HealthMetric, dict: string): string {
  if (!m.prevDate) return L(dict, '较上次', 'vs last');
  const days = Math.round((Date.parse(m.latestDate) - Date.parse(m.prevDate)) / 86_400_000);
  if (!Number.isFinite(days) || days <= 45) return L(dict, '较上次', 'vs last');
  const months = Math.max(2, Math.round(days / 30));
  return L(dict, `较 ${months} 个月前`, `vs ${months}mo ago`);
}

// 批次 42(A):血糖深度卡 —— 密集(CGM/指尖血)数据不再只显示「最新一个读数」。
// TIR(时间在目标范围)+ 变异系数 + GMI + 每日 min–max 范围带 + 目标区间带。
function GlucoseCard({ g, dict }: { g: GlucoseAnalysis; dict: string }) {
  const dec = g.unit === 'mmol/L' ? 1 : 0;
  const f = (v: number) => (dec === 0 ? Math.round(v).toString() : v.toFixed(1));
  const daily = g.daily;
  const lo = Math.min(g.targetLow, ...daily.map((d) => d.min));
  const hi = Math.max(g.targetHigh, ...daily.map((d) => d.max));
  const range = hi - lo || 1;
  const W = 100, H = 44;
  const y = (v: number) => H - ((v - lo) / range) * H;
  const x = (i: number) => (daily.length > 1 ? (i / (daily.length - 1)) * W : W / 2);
  return (
    <div className="nesio-health-card" style={{ gridColumn: '1 / -1' }}>
      <span className="nesio-health-card-label">{L(dict, '血糖 · 深度', 'Glucose · deep')}</span>
      <span className="nesio-health-card-value">{f(g.avg)}<span className="nesio-health-card-unit">{g.unit} {L(dict, '平均', 'avg')}</span></span>

      {/* TIR 三段条:低于 / 在范围 / 高于目标 */}
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', margin: 'var(--space-2) 0 var(--space-1)', background: 'var(--portal-line)' }}>
        {g.belowPct > 0 && <div style={{ width: `${g.belowPct}%`, background: 'var(--status-risk)' }} />}
        <div style={{ width: `${g.tirPct}%`, background: 'var(--status-go)' }} />
        {g.abovePct > 0 && <div style={{ width: `${g.abovePct}%`, background: 'var(--status-gentle)' }} />}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--text-overline)', color: 'var(--portal-muted)', flexWrap: 'wrap' }}>
        <span><b style={{ color: 'var(--status-go)' }}>{g.tirPct}%</b> {L(dict, '达标', 'in range')}</span>
        {g.belowPct > 0 && <span><b style={{ color: 'var(--status-risk)' }}>{g.belowPct}%</b> {L(dict, '偏低', 'low')}</span>}
        {g.abovePct > 0 && <span><b style={{ color: 'var(--status-gentle)' }}>{g.abovePct}%</b> {L(dict, '偏高', 'high')}</span>}
        <span>GMI <b>{g.gmi}%</b></span>
        <span>{L(dict, '波动', 'CV')} <b>{g.cv}%</b></span>
      </div>

      {/* 每日 min–max 范围带 + 平均点,叠目标区间带 */}
      {daily.length >= 2 && (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="44" preserveAspectRatio="none" style={{ marginTop: 'var(--space-2)', overflow: 'visible' }}>
          <rect x="0" y={y(g.targetHigh)} width={W} height={Math.max(0, y(g.targetLow) - y(g.targetHigh))} fill="var(--status-go-soft)" />
          {daily.map((d, i) => (
            <line key={d.date} x1={x(i)} x2={x(i)} y1={y(d.min)} y2={y(d.max)} stroke="var(--portal-accent-soft-md)" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
          <polyline points={daily.map((d, i) => `${x(i).toFixed(1)},${y(d.avg).toFixed(1)}`).join(' ')} fill="none" stroke="var(--portal-blue-deep)" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <span className="nesio-health-card-range">
        {L(dict, `近 ${daily.length} 天 · ${g.count.toLocaleString()} 条读数 · 目标 ${f(g.targetLow)}–${f(g.targetHigh)}`, `${daily.length}d · ${g.count.toLocaleString()} readings · target ${f(g.targetLow)}–${f(g.targetHigh)}`)}
      </span>
    </div>
  );
}

// 批次 44(C):活动三环 —— Move/Exercise/Stand vs 目标(横向进度条,清爽且色彩在设计系统内)。
function ActivityRingsCard({ a, dict }: { a: ActivityRings; dict: string }) {
  const rings: Array<{ label: [string, string]; v: number; goal: number; unit: string; color: string }> = [
    { label: ['活动', 'Move'], v: a.move, goal: a.moveGoal, unit: 'kcal', color: 'var(--status-gentle)' },
    { label: ['锻炼', 'Exercise'], v: a.exercise, goal: a.exerciseGoal, unit: 'min', color: 'var(--status-go)' },
    { label: ['站立', 'Stand'], v: a.stand, goal: a.standGoal, unit: 'h', color: 'var(--status-calm)' },
  ];
  return (
    <div className="nesio-health-card" style={{ gridColumn: '1 / -1' }}>
      <span className="nesio-health-card-label">{L(dict, '活动三环', 'Activity rings')} · {a.date.slice(5).replace('-', '/')}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        {rings.map((r) => {
          const pct = r.goal > 0 ? Math.min(100, Math.round((r.v / r.goal) * 100)) : 0;
          return (
            <div key={r.label[0]}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', marginBottom: 2 }}>
                <span>{L(dict, r.label[0], r.label[1])}</span>
                <span><b style={{ color: r.color }}>{r.v}</b>{r.goal > 0 ? ` / ${r.goal} ${r.unit}` : ` ${r.unit}`}{r.goal > 0 ? ` · ${pct}%` : ''}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--portal-line)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: r.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 批次 44(C):睡眠分期 —— 最近一晚 Deep/Core/REM/清醒 堆叠条 + 图例。
function SleepStagesCard({ s, dict }: { s: SleepStages; dict: string }) {
  const segs: Array<{ label: [string, string]; v: number; color: string }> = [
    { label: ['深睡', 'Deep'], v: s.deep, color: 'var(--portal-blue-deep)' },
    { label: ['核心', 'Core'], v: s.core, color: 'var(--portal-cool-accent)' },
    { label: ['REM', 'REM'], v: s.rem, color: 'var(--status-calm)' },
    { label: ['清醒', 'Awake'], v: s.awake, color: 'var(--portal-muted)' },
  ];
  const denom = s.total + s.awake || 1;
  return (
    <div className="nesio-health-card" style={{ gridColumn: '1 / -1' }}>
      <span className="nesio-health-card-label">{L(dict, '睡眠分期', 'Sleep stages')} · {s.night.slice(5).replace('-', '/')}</span>
      <span className="nesio-health-card-value">{s.total.toFixed(1)}<span className="nesio-health-card-unit">h {L(dict, '实际睡着', 'asleep')}</span></span>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', margin: 'var(--space-2) 0 var(--space-2)', background: 'var(--portal-line)' }}>
        {segs.filter((g) => g.v > 0).map((g) => <div key={g.label[0]} style={{ width: `${(g.v / denom) * 100}%`, background: g.color }} />)}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', fontSize: 'var(--text-overline)', color: 'var(--portal-muted)' }}>
        {segs.map((g) => (
          <span key={g.label[0]}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: g.color, marginRight: 4, verticalAlign: 'middle' }} />{L(dict, g.label[0], g.label[1])} {g.v.toFixed(1)}h</span>
        ))}
      </div>
    </div>
  );
}

// 批次 45(D1):情绪(State of Mind)—— 平均效价 + 基调 + 近 90 天日均序列。
function MoodCard({ mood, dict }: { mood: MoodAnalysis; dict: string }) {
  const toneColor = mood.tone === 'pleasant' ? 'var(--status-go)' : mood.tone === 'unpleasant' ? 'var(--status-gentle)' : 'var(--status-calm)';
  const toneLabel: Record<MoodAnalysis['tone'], [string, string]> = {
    pleasant: ['偏积极', 'Pleasant'], neutral: ['中性', 'Neutral'], unpleasant: ['偏低落', 'Low'],
  };
  const d = mood.daily;
  const W = 100, H = 26, mid = H / 2;
  const yv = (v: number) => mid - (v * mid); // valence -1..1 → 底/顶
  const pts = d.map((p, i) => `${(d.length > 1 ? (i / (d.length - 1)) * W : 0).toFixed(1)},${yv(p.valence).toFixed(1)}`).join(' ');
  return (
    <div className="nesio-health-card" style={{ gridColumn: '1 / -1' }}>
      <span className="nesio-health-card-label">{L(dict, '情绪 · State of Mind', 'Mood · State of Mind')}</span>
      <span className="nesio-health-card-value" style={{ color: toneColor }}>{L(dict, toneLabel[mood.tone][0], toneLabel[mood.tone][1])}<span className="nesio-health-card-unit">{L(dict, `效价 ${mood.avgValence > 0 ? '+' : ''}${mood.avgValence}`, `valence ${mood.avgValence > 0 ? '+' : ''}${mood.avgValence}`)}</span></span>
      {d.length >= 2 && (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="26" preserveAspectRatio="none" style={{ marginTop: 'var(--space-2)', overflow: 'visible' }}>
          <line x1="0" x2={W} y1={mid} y2={mid} stroke="var(--portal-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <polyline points={pts} fill="none" stroke={toneColor} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <span className="nesio-health-card-range">{L(dict, `近 ${d.length} 天 · ${mood.count} 次记录`, `${d.length}d · ${mood.count} logs`)}</span>
      {/* 趋势入口**不在这张卡上**:这张卡讲的是 Apple Health 的 State of Mind,
          而趋势读的是 App 自己的情绪盘记录 —— 挂在这里等于给趋势加了一道
          「必须导过 Apple Health」的假门(用户实测就是「我没见到」)。
          入口已独立成 MoodTrendCard,直接摆在分析页第一屏。 */}
    </div>
  );
}

// 批次 47(E2):AI 跨数据叙事 —— 在 E 的确定性关系之上生成人话建议(走 guardAiRoute)。
// 每个异步动作必有可见失败态 + 重试(设计红线)。
function AiInsightPanel({ data, dict }: { data: HealthMetrics; dict: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [text, setText] = useState('');

  async function run() {
    if (!guardPaidCloudAi('health_insight')) return; // 安全审计 #2:健康 AI 解读付费云,免费→升级引导
    setStatus('loading');
    try {
      const rels = data.daily ? mineRelationships(data.daily) : [];
      const g = data.glucose;
      const sleepDays = (data.daily || []).map((f) => f.sleepH).filter((v): v is number => v != null);
      const summary = {
        ...(g ? { glucose: { avg: g.avg, unit: g.unit, tirPct: g.tirPct, gmi: g.gmi, cv: g.cv } } : {}),
        ...(sleepDays.length ? { sleepAvgH: Math.round((sleepDays.reduce((s, v) => s + v, 0) / sleepDays.length) * 10) / 10 } : {}),
        ...(data.mood ? { moodTone: data.mood.tone } : {}),
        ...(() => { const r = data.metrics.find((m) => m.key === 'restingHR'); return r ? { restingHR: r.latest } : {}; })(),
      };
      // ④:把 ②指南判定 + ③风险评分(带 id)一起送,路由据 id 检索指南要点接地。
      const findings = [
        ...evaluateHealthFindings({ glucose: data.glucose, sleepStages: data.sleepStages, metrics: data.metrics })
          .map((f) => ({ id: f.id, title: f.title, detail: f.detail, source: f.source })),
        ...computeRiskScores({ metrics: data.metrics, glucose: data.glucose, profile: data.profile })
          .map((s) => ({ id: s.id, title: s.label, detail: [`${s.value} · ${s.detail[0]}`, `${s.value} · ${s.detail[1]}`] as [string, string], source: s.source })),
      ];
      const res = await fetch('/api/portal/health-insight', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: dict === 'en' ? 'en' : 'zh', relationships: rels, summary, findings }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json() as { ok?: boolean; text?: string };
      if (!j.ok || !j.text) throw new Error('empty');
      setText(j.text); setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  // bug2:AI 解读按钮留下,其余说明文字删除
  return (
    <div className="nesio-fit-panel" style={{ marginTop: 'var(--space-2)' }}>
      {status === 'done' ? (
        <>
          {text.split('\n').filter(Boolean).map((line, i) => <p key={i} className="nesio-health-story-line">{line}</p>)}
          <button type="button" className="nesio-connector-connect" style={{ marginTop: 'var(--space-2)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)' }} onClick={() => void run()}>{L(dict, '重新生成', 'Regenerate')}</button>
        </>
      ) : status === 'error' ? (
        <>
          <p className="nesio-health-story-line" style={{ color: 'var(--status-risk)' }}>{L(dict, '生成失败,请重试。', 'Failed to generate. Please retry.')}</p>
          <button type="button" className="nesio-connector-connect" style={{ marginTop: 'var(--space-1)' }} onClick={() => void run()}>{L(dict, '重试', 'Retry')}</button>
        </>
      ) : (
        <button type="button" className="nesio-connector-connect" disabled={status === 'loading'} onClick={() => void run()}>
          {/* bug3 p39:按钮改名「智能解读」—— 用户不关心是谁在解读,只关心这一下能得到什么 */}
          {status === 'loading' ? L(dict, '生成中…', 'Generating…') : L(dict, '智能解读', 'Smart read')}
        </button>
      )}
    </div>
  );
}

// 批次 48(D2):临床记录卡(化验单/用药/诊断)—— 仅 lab 模式渲染,本机存储的敏感数据。
function ClinicalCard({ c, dict }: { c: StoredClinical; dict: string }) {
  const flagColor = (f?: string) => (f === 'high' ? 'var(--status-gentle)' : f === 'low' ? 'var(--status-calm)' : 'var(--portal-ink)');
  return (
    <div>
      <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>
        {L(dict, '临床记录', 'Clinical records')} <span className="nesio-connector-soon" style={{ background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)' }}>Lab</span>
      </p>
      {c.labs.length > 0 && (
        <div className="nesio-health-card" style={{ gridColumn: '1 / -1' }}>
          <span className="nesio-health-card-label">{L(dict, `化验单 · ${c.labs.length} 项`, `Labs · ${c.labs.length}`)}</span>
          <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {c.labs.slice(0, 20).map((lab, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
                <span style={{ color: 'var(--portal-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lab.name}</span>
                <span style={{ flexShrink: 0 }}>
                  <b style={{ color: flagColor(lab.flag) }}>{lab.value}{lab.unit ? ` ${lab.unit}` : ''}</b>
                  {(lab.low != null || lab.high != null) && <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-overline)' }}> ({lab.low ?? ''}–{lab.high ?? ''})</span>}
                  {lab.date && <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-overline)', marginLeft: 4 }}>{lab.date.slice(2)}</span>}
                </span>
              </div>
            ))}
          </div>
          {c.labs.length > 20 && <span className="nesio-health-card-range">{L(dict, `另有 ${c.labs.length - 20} 项`, `+${c.labs.length - 20} more`)}</span>}
        </div>
      )}
      {(c.medications.length > 0 || c.conditions.length > 0) && (
        <div className="nesio-health-card" style={{ gridColumn: '1 / -1', marginTop: 'var(--space-2)' }}>
          {c.conditions.length > 0 && <p style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--text-xs)' }}><span style={{ color: 'var(--portal-muted)' }}>{L(dict, '诊断:', 'Conditions: ')}</span>{c.conditions.slice(0, 12).join(' · ')}</p>}
          {c.medications.length > 0 && <p style={{ margin: 0, fontSize: 'var(--text-xs)' }}><span style={{ color: 'var(--portal-muted)' }}>{L(dict, '用药:', 'Meds: ')}</span>{c.medications.slice(0, 12).join(' · ')}</p>}
        </div>
      )}
      <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-2)' }}>{L(dict, '来自 Apple 健康记录(export_cda)· 仅本机 · 仅 Lab 模式可见', 'From Apple Health Records (export_cda) · on-device · Lab only')}</p>
    </div>
  );
}

// 批次 49:健康提示卡 —— 指南接地的确定性判定(①目标 + ②模式),依严重度着色 + 出处。
function FindingsCard({ data, dict }: { data: HealthMetrics; dict: string }) {
  const findings = evaluateHealthFindings({ glucose: data.glucose, sleepStages: data.sleepStages, metrics: data.metrics });
  // bug3 p40:「哪些让你稳 / 飙」不再单开一个折叠 —— 它本质就是一条提示,并进健康提示里,
  // 用同一种行样式(● 标签 + 标题 — 明细 + 依据),不再是另一套排行榜观感。
  const unit = data.glucose?.unit === 'mmol/L' ? 'mmol/L' : 'mg/dL';
  const reactions = rankFoodReactions(getMeals(), data.daily, { minN: 2, limit: 5 });
  if (!findings.length && !reactions.length) return null;
  const color: Record<Severity, string> = { flag: 'var(--status-risk)', attention: 'var(--status-gentle)', info: 'var(--status-go)' };
  const dot: Record<Severity, [string, string]> = { flag: ['需留意', 'flag'], attention: ['可关注', 'watch'], info: ['正常', 'ok'] };
  // 行样式抽成常量:两个来源(指南判定 / 稳飙)必须长得一模一样 —— 标注要的就是「风格一致」,
  // 靠复制粘贴保证不了,下一次改一处就会走形。
  const rowStyle = { display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', marginBottom: 'var(--space-1)' } as const;
  const dotStyle = { flexShrink: 0, minWidth: 44, fontSize: 'var(--text-overline)', fontWeight: 600 } as const;
  const srcStyle = { display: 'block', fontSize: 'var(--text-overline)', color: 'var(--portal-muted)' } as const;
  return (
    <div className="nesio-fit-panel" style={{ marginTop: 'var(--space-2)' }}>
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '健康提示 · 依据指南', 'Health flags · guideline-based')}</p>
      {reactions.map((r) => {
        // 偏飙 = 可关注(琥珀);偏稳 = 正常(绿)。红只留给真红旗,不拿吃饭制造焦虑。
        const sev: Severity = r.tone === 'spike' ? 'attention' : 'info';
        const rise = mgDlToDisplay(r.avgRise, unit);
        return (
          <div key={`rx-${r.name}`} style={rowStyle}>
            <span style={{ ...dotStyle, color: color[sev] }}>● {L(dict, dot[sev][0], dot[sev][1])}</span>
            <span className="nesio-health-story-line" style={{ margin: 0 }}>
              <b>{r.name}</b> — {r.tone === 'spike'
                ? L(dict, `同日血糖振幅偏大 +${rise} ${unit}`, `larger same-day glucose swing +${rise} ${unit}`)
                : L(dict, `同日血糖比较稳 +${rise} ${unit}`, `steadier same-day glucose +${rise} ${unit}`)}
              <span style={srcStyle}>
                {L(dict, `依据:同日血糖振幅与餐名共现(探索性,n=${r.n})`, `source: same-day glucose amplitude co-occurrence (exploratory, n=${r.n})`)}
              </span>
            </span>
          </div>
        );
      })}
      {findings.map((f) => (
        <div key={f.id} style={rowStyle}>
          <span style={{ ...dotStyle, color: color[f.severity] }}>● {L(dict, dot[f.severity][0], dot[f.severity][1])}</span>
          <span className="nesio-health-story-line" style={{ margin: 0 }}>
            <b>{L(dict, f.title[0], f.title[1])}</b> — {L(dict, f.detail[0], f.detail[1])}
            <span style={srcStyle}>{L(dict, `依据:${f.source}`, `source: ${f.source}`)}</span>
          </span>
        </div>
      ))}
      <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>{L(dict, '对照已发表共识/指南的规则判定,非 AI、非诊断;红旗请与医生确认', 'Rule-based against published consensus; not AI, not a diagnosis')}</p>
    </div>
  );
}

// 批次 50(③层):风险分层卡 —— 已验证评分(VO₂max 体适能/BMI/GMI→eA1c),数据齐才出,带出处。
function RiskCard({ data, dict }: { data: HealthMetrics; dict: string }) {
  const scores = computeRiskScores({ metrics: data.metrics, glucose: data.glucose, profile: data.profile });
  if (!scores.length) return null;
  const color: Record<RiskCategory, string> = { high: 'var(--status-risk)', moderate: 'var(--status-gentle)', low: 'var(--status-go)', info: 'var(--portal-muted)' };
  return (
    <div className="nesio-fit-panel" style={{ marginTop: 'var(--space-2)' }}>
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '风险分层 · 已验证评分', 'Risk stratification · validated scores')}</p>
      {scores.map((s) => (
        <div key={s.id} style={{ marginBottom: 'var(--space-1)' }}>
          <p className="nesio-health-story-line" style={{ margin: 0 }}>
            <span style={{ color: color[s.category], fontWeight: 600 }}>● </span>
            <b>{L(dict, s.label[0], s.label[1])}</b> — <span style={{ color: color[s.category] }}>{s.value}</span>
            <span style={{ display: 'block', fontSize: 'var(--text-overline)', color: 'var(--portal-muted)' }}>{L(dict, s.detail[0], s.detail[1])} · {L(dict, `依据:${s.source}`, `source: ${s.source}`)}</span>
          </p>
        </div>
      ))}
      <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>{L(dict, '对照已发表评分/常模,数据齐才计算;非诊断', 'Against published scores/norms; computed only when inputs are present; not a diagnosis')}</p>
    </div>
  );
}

function MetricCard({ m, dict }: { m: HealthMetric; dict: string }) {
  // prev===0 时也算 delta(如上月 0 次锻炼 → 本月 3 次是真实增长,不该被压成"无变化");
  // 只有 deltaPct 因除零需要 prev!==0。
  const delta = m.prev != null ? m.latest - m.prev : null;
  const hasTrend = (m.series?.length ?? 0) >= 3;
  return (
    <div className="nesio-health-card">
      <span className="nesio-health-card-label">{L(dict, m.label[0], m.label[1])}</span>
      <span className="nesio-health-card-value">{fmt(m.latest, m.decimals)}<span className="nesio-health-card-unit">{m.unit}</span></span>
      {delta != null && delta !== 0 ? (
        <span className={`nesio-health-card-delta${delta > 0 ? ' up' : ' down'}`}>
          {delta > 0 ? '▲' : '▼'} {gapLabel(m, dict)} {delta > 0 ? '+' : ''}{fmt(delta, m.decimals)}
          <span className="nesio-health-card-date" style={{ marginLeft: 'var(--space-1)', opacity: 0.7 }}>{m.latestDate.slice(5).replace('-', '/')}</span>
        </span>
      ) : (
        <span className="nesio-health-card-date">{m.latestDate.slice(5).replace('-', '/')}</span>
      )}
      {hasTrend && <Sparkline series={m.series} />}
      {/* series 是月聚合值,区间标「月均」——否则当日值(单日观测)超出月均区间像自打脸(QA:672 vs 400–492) */}
      {hasTrend && <span className="nesio-health-card-range">{L(dict, `近 ${m.series.length} 个月月均`, `${m.series.length}mo avg`)} · {fmt(Math.min(...m.series.map((s) => s.v)), m.decimals)}–{fmt(Math.max(...m.series.map((s) => s.v)), m.decimals)}</span>}
    </div>
  );
}

// ── 概览 / 分析 / 身体账本 / 护理 ──
type HealthView = 'overview' | 'analysis' | 'ledger' | 'care';

// 2026-07-29:改用全站唯一的分段控件 SegTabs(原 .nesio-health-subtabs 是五套之一)。
function HealthSubTabs({ view, onChange, dict }: { view: HealthView; onChange: (v: HealthView) => void; dict: string }) {
  const tabs: Array<[HealthView, string, string]> = [
    ['overview', '概览', 'Overview'],
    ['analysis', '分析', 'Analysis'],
    ['ledger', '身体账本', 'Body ledger'],
    ['care', '护理', 'Care'],
  ];
  return (
    <SegTabs
      items={tabs.map(([v, zh, en]) => ({ key: v, label: L(dict, zh, en) }))}
      active={view}
      onSelect={onChange}
      ariaLabel={L(dict, '健康视图', 'Health view')}
    />
  );
}

// bug2:今日精选用户可自行设置哪些进入精选(本机偏好;默认全开,「活动」也可加入)
const PICKS_KEY = 'nesio-health-picks-v1';
function loadPickPrefs(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(PICKS_KEY) || '{}') as Record<string, boolean>; } catch { return {}; }
}
function savePickPrefs(p: Record<string, boolean>): void {
  try { localStorage.setItem(PICKS_KEY, JSON.stringify(p)); } catch { /* 界面偏好,丢了重选即可 */ }
}

// 概览:今日精选(点任意卡进「分析」看深度;右上「编辑」自选哪些进精选)
function TodayPicks({ data, dict, onOpen }: { data: HealthMetrics; dict: string; onOpen: () => void }) {
  type Pick = { key: string; dot: string; label: string; value: string; unit?: string; sub: string };
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => loadPickPrefs());
  const [editing, setEditing] = useState(false);
  const all: Pick[] = [];
  if (data.activityRings) {
    const a = data.activityRings;
    const rr: Array<[number, number]> = [[a.move, a.moveGoal], [a.exercise, a.exerciseGoal], [a.stand, a.standGoal]];
    const pct = Math.round(rr.map(([v, g]) => (g > 0 ? Math.min(100, (v / g) * 100) : 0)).reduce((s, x) => s + x, 0) / 3);
    all.push({ key: 'rings', dot: 'var(--status-gentle)', label: L(dict, '活动三环', 'Activity'), value: `${pct}`, unit: '%', sub: pct >= 100 ? L(dict, '已合上', 'closed') : L(dict, '还差一点合上', 'almost closed') });
  }
  if (data.sleepStages) {
    const s = data.sleepStages;
    all.push({ key: 'sleep', dot: 'var(--status-calm)', label: L(dict, '睡眠', 'Sleep'), value: s.total.toFixed(1), unit: 'h', sub: L(dict, `达标 · 深睡 ${s.deep.toFixed(1)}h`, `deep ${s.deep.toFixed(1)}h`) });
  }
  if (data.glucose) {
    all.push({ key: 'glu', dot: 'var(--status-go)', label: L(dict, '血糖达标', 'Glucose'), value: `${data.glucose.tirPct}`, unit: '%', sub: L(dict, 'TIR 稳', 'TIR steady') });
  }
  if (data.mood) {
    const tl: [string, string] = data.mood.tone === 'pleasant' ? ['偏积极', 'Pleasant'] : data.mood.tone === 'unpleasant' ? ['偏低落', 'Low'] : ['中性', 'Neutral'];
    const v = data.mood.avgValence;
    all.push({ key: 'mood', dot: 'var(--portal-cool-accent)', label: L(dict, '情绪', 'Mood'), value: L(dict, tl[0], tl[1]), sub: L(dict, `效价 ${v > 0 ? '+' : ''}${v}`, `valence ${v > 0 ? '+' : ''}${v}`) });
  }
  // 「活动」组指标也可加入精选(步数)
  const steps = data.metrics.find((m) => m.key === 'steps' || m.group === 'activity');
  if (steps) {
    all.push({ key: `metric-${steps.key}`, dot: 'var(--portal-blue-deep)', label: L(dict, steps.label[0], steps.label[1]), value: fmt(steps.latest, steps.decimals), unit: steps.unit, sub: steps.latestDate.slice(5).replace('-', '/') });
  }
  if (!all.length) return null;
  const enabled = all.filter((p) => prefs[p.key] !== false);
  const toggle = (key: string) => {
    const next = { ...prefs, [key]: prefs[key] === false };
    setPrefs(next); savePickPrefs(next);
  };
  return (
    <>
      <p className="nesio-insights-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>{L(dict, '今日精选', 'Today')}</span>
        <button type="button" onClick={() => setEditing((v) => !v)}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', color: 'var(--portal-accent)', padding: 0 }}>
          {editing ? L(dict, '完成', 'Done') : L(dict, '编辑', 'Edit')}
        </button>
      </p>
      {editing && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
          {all.map((p) => {
            const on = prefs[p.key] !== false;
            return (
              <button key={p.key} type="button" onClick={() => toggle(p.key)}
                style={{ border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-pill)', padding: '4px 10px', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)', cursor: 'pointer', background: on ? 'var(--portal-accent-soft-md)' : 'transparent', color: on ? 'var(--portal-accent)' : 'var(--portal-muted)' }}>
                {on ? '✓ ' : ''}{p.label}
              </button>
            );
          })}
        </div>
      )}
      {enabled.length > 0 && (
        <div className="nesio-health-picks">
          {enabled.map((p) => (
            <button key={p.key} type="button" className="nesio-health-pick" onClick={onOpen}>
              <span className="nesio-health-pick-top">
                <span className="nesio-health-pick-dot" style={{ background: p.dot }} aria-hidden />
                {p.label}
                <span className="nesio-health-pick-chev" aria-hidden>›</span>
              </span>
              <span className="nesio-health-pick-val">{p.value}{p.unit && <small>{p.unit}</small>}</span>
              <span className="nesio-health-pick-sub">{p.sub}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const SEV_ORDER: Record<Severity, number> = { flag: 0, attention: 1, info: 2 };
const SEV_COLOR: Record<Severity, string> = { flag: 'var(--status-risk)', attention: 'var(--status-gentle)', info: 'var(--status-go)' };
const SEV_LABEL: Record<Severity, [string, string]> = { flag: ['需留意', 'flag'], attention: ['可关注', 'watch'], info: ['正常', 'ok'] };

// 概览:最要紧的一条(取最高严重度的指南判定;红只给真红旗,焦虑详情在「分析」)
function TopFinding({ data, dict, onOpen }: { data: HealthMetrics; dict: string; onOpen: () => void }) {
  const findings = evaluateHealthFindings({ glucose: data.glucose, sleepStages: data.sleepStages, metrics: data.metrics });
  if (!findings.length) return null;
  const top = [...findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])[0];
  return (
    <>
      <p className="nesio-insights-section-label">{L(dict, '最要紧的一条', 'What matters most')}</p>
      <button type="button" className="nesio-health-topfind" onClick={onOpen}>
        <span className="nesio-health-topfind-badge" style={{ color: SEV_COLOR[top.severity] }}>● {L(dict, SEV_LABEL[top.severity][0], SEV_LABEL[top.severity][1])}</span>
        <span className="nesio-health-topfind-body">
          <b>{L(dict, top.title[0], top.title[1])}</b> — {L(dict, top.detail[0], top.detail[1])}
        </span>
      </button>
    </>
  );
}

// 概览:念念发现的关系(取最强一条)
function TopRelationship({ data, dict }: { data: HealthMetrics; dict: string }) {
  const rels = data.daily ? mineRelationships(data.daily) : [];
  if (!rels.length) return null;
  const r = rels[0];
  return (
    <>
      <p className="nesio-insights-section-label">{L(dict, '念念发现的关系', 'What Nessa noticed')}</p>
      <div className="nesio-health-rel">
        <span className="nesio-health-rel-tag" style={{ color: r.strength === 'strong' ? 'var(--status-go)' : 'var(--portal-muted)' }}>
          {r.strength === 'strong' ? L(dict, '强', 'strong') : L(dict, '中', 'mod')} n={r.n}
        </span>
        <span className="nesio-health-rel-text">{L(dict, r.insight[0], r.insight[1])}</span>
        <span className="nesio-health-rel-note">{L(dict, '统计非因果 · 更多在「分析」', 'correlation, not causation · more in Analysis')}</span>
      </div>
    </>
  );
}

/**
 * 健康镜头的捕捉入口。规格把它画成右下角 FAB「拍化验单」;
 * 拍照 OCR 押后了(见 lib/health/health-signals.ts 的说明),所以现在是「记一条」——
 * 同一个位置、同一条确认路径,OCR 到位后只是把表单预填好。
 * 入口不能等 OCR:等了,没导过 Apple 健康记录的人就一条都记不进来。
 */
// bug3 p41:原来概览页顶上那行(「化验 · 用药 · 就诊」标签 + 拍化验单 + ＋记一条)整条删掉 ——
// 记一条挪进「身体账本」,并且只留一个「记一条」+ 一个加号(加号里既能上传也能智能拍照,
// 见 BodyLedgerPanel 的 onRecord / onScan)。

export default function HealthDashboard() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [data, setData] = useState<HealthMetrics | null>(null);
  const [clinical, setClinical] = useState<StoredClinical | null>(null);
  const [labMode, setLabMode] = useState(false);
  const [view, setView] = useState<HealthView>('overview');

  const [recordOpen, setRecordOpen] = useState(false);      // 健康镜头:记一条(化验/用药/症状/就诊)
  const [scanOpen, setScanOpen] = useState(false);          // 健康镜头 B 屏:拍化验单(端上识别)
  const [openMetric, setOpenMetric] = useState<string | null>(null); // 健康镜头 C 屏:指标详情
  const [reportMsg, setReportMsg] = useState(''); // 健康月报动作反馈(可见状态,不静默)
  // 月初自动补生成上月健康月报并存记忆(每设备每月一次,幂等)。
  // ⚠️ hooks 必须全部在下面的空态早退之前(hook 数量随渲染变化会让 React 整页抛错)。
  useEffect(() => {
    if (!data?.daily?.length) return;
    try {
      const outcome = autoPersistLastMonthHealthReport(data, new Date(), dict);
      if (outcome === 'created') setReportMsg(L(dict, '已自动生成上月健康月报并存入记忆', 'Auto-saved last month\u2019s health report to Memory'));
    } catch { /* 自动补失败静默,手动入口仍在 */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    setData(loadHealthMetrics());
    const onUpdate = () => setData(loadHealthMetrics());
    window.addEventListener('nesio-health-updated', onUpdate);
    // D2:临床记录仅 lab 模式加载渲染。
    const isLab = readLaunchSurfaceContextFromBrowser().viewerRole === 'personal_lab';
    setLabMode(isLab);
    if (isLab) {
      setClinical(loadClinical());
      const onClinical = () => setClinical(loadClinical());
      window.addEventListener('nesio-clinical-updated', onClinical);
      return () => { window.removeEventListener('nesio-health-updated', onUpdate); window.removeEventListener('nesio-clinical-updated', onClinical); };
    }
    return () => window.removeEventListener('nesio-health-updated', onUpdate);
  }, []);

  // 训练负荷不依赖 Apple Health(修「没导 XML 就永远看不到训练面板」):
  // 次数取 计划打卡 与 完成历史(自定义/生成的跟练也算)的较大者 —— 两边有重叠,取 max 不重计。
  const tsAll = loadTrainingState();
  const activeProtoAll = tsAll.activeProtocolId ? protocolById(tsAll.activeProtocolId) : undefined;
  const weekSessions = Math.max(sessionsThisWeek(tsAll), workoutSessionsThisWeek());

  if (!data || data.metrics.length === 0) {
    const emptyInsight = computeFitnessInsight([], weekSessions, activeProtoAll?.sessionsPerWeek ?? null);
    return (
      <div className="nesio-health-dash">
        <HealthSubTabs view={view} onChange={setView} dict={dict} />
        {view === 'ledger' && <BodyLedgerPanel health={data} onRecord={() => setRecordOpen(true)} onScan={() => setScanOpen(true)} />}
        {view === 'care' && <BeautyCarePanel />}
        {(view === 'overview' || view === 'analysis') && (
          <>
            {/* 健康镜头不依赖 Apple Health —— 化验/用药/就诊是另一套数据源。
                这块早退分支原本什么都不给,等于「没导过 Apple Health 就用不了健康镜头」。 */}
            <HealthLensCards onOpenMetric={setOpenMetric} />
            {/* 合并 QA 分支:没有 Apple Health 也可能有本机训练记录,有就先给一块 */}
            {emptyInsight.signals.length > 0 && <FitnessPanel insight={emptyInsight} dict={dict} />}
            {/* 心情趋势读的是 App 自己的情绪盘记录 —— 这条早退分支(没导 Apple Health)
                同样要给,否则「没导过 Apple Health 就看不到自己记的心情」。 */}
            <MoodTrendCard dict={dict} />
            <p className="nesio-insights-empty" style={{ marginBottom: 0 }}>
              {L(dict,
                '还没有 Apple Health 指标。身体账本仍可用「美味 · 记一餐」;护理看护肤物品。完整曲线请到「设置 → 数据接入 → Apple Health」上传导出。',
                'No Apple Health metrics yet. Body ledger still works from Cooking meals; Care lists skincare items. For full curves, upload an export in Settings → Data sources → Apple Health.')}
            </p>
            <FamilyDataCard kind="health" />
          </>
        )}
        <HealthRecordSheet open={recordOpen} onClose={() => setRecordOpen(false)} />
        <MetricDetailSheet metric={openMetric} onClose={() => setOpenMetric(null)} />
        <LabScanSheet open={scanOpen} onClose={() => setScanOpen(false)} onManual={() => setRecordOpen(true)} />
      </div>
    );
  }

  const insight = computeFitnessInsight(data.metrics, weekSessions, activeProtoAll?.sessionsPerWeek ?? null);

  const rels = data.daily ? mineRelationships(data.daily) : [];

  return (
    <div className="nesio-health-dash">
      <HealthSubTabs view={view} onChange={setView} dict={dict} />

      {view === 'ledger' && <BodyLedgerPanel health={data} onRecord={() => setRecordOpen(true)} onScan={() => setScanOpen(true)} />}
      {view === 'care' && <BeautyCarePanel />}

      {view === 'overview' ? (
        /* ── 概览(bug2):第一行隐私 badge 删;黄卡/绿卡迁身体账本;快捷进入删;精选可自选 ── */
        <>
          {/* 健康镜头(2026-07-29):化验/用药/就诊三卡 —— 读 Signal 主事实表。
              bug3 p41:上面那行入口(标签 + 拍化验单 + ＋记一条)删掉,入口只留在身体账本。 */}
          <HealthLensCards onOpenMetric={setOpenMetric} />
          <TodayPicks data={data} dict={dict} onOpen={() => setView('analysis')} />
          <TopFinding data={data} dict={dict} onOpen={() => setView('analysis')} />
          <TopRelationship data={data} dict={dict} />
          <button type="button" className="nesio-health-goanalysis" onClick={() => setView('analysis')}>
            {L(dict, '去「分析」看全部数据', 'See all data in Analysis')} ›
          </button>
        </>
      ) : view === 'analysis' ? (
        /* ── 分析(bug2):顶部指标计数/画像文字删;专项折叠;餐后血糖迁入
              bug3 p38:身体账本顶部的读数小结卡(去掉「念」符号)+ 蛋白琥珀卡挪来这里 ── */
        <>
          <BodyLedgerAnalysisCards health={data} dict={dict} />

          {/* bug3 p43「心情趋势显示在健康分析页」:摆在第一屏、不进「专项」折叠、
              不挂 data.mood 门 —— 折叠 + Apple Health 门就是上一版「我没见到」的原因。 */}
          <MoodTrendCard dict={dict} />

          {/* 专项(折叠) */}
          {(insight.signals.length > 0 || data.activityRings || data.sleepStages || data.mood || data.glucose) && (
            <details className="nesio-fin-fold" style={{ marginTop: 'var(--space-2)' }}>
              <summary className="nesio-settings-section-label" style={{ cursor: 'pointer', listStyle: 'none', marginTop: 0 }}>{L(dict, '专项', 'Deep dive')} ›</summary>
              {insight.signals.length > 0 && <FitnessPanel insight={insight} dict={dict} />}
              {(data.activityRings || data.sleepStages || data.mood) && (
                <div className="nesio-health-grid" style={{ marginTop: 'var(--space-2)' }}>
                  {data.activityRings && <ActivityRingsCard a={data.activityRings} dict={dict} />}
                  {data.sleepStages && <SleepStagesCard s={data.sleepStages} dict={dict} />}
                  {data.mood && <MoodCard mood={data.mood} dict={dict} />}
                </div>
              )}
              {data.glucose && (
                <div className="nesio-health-grid" style={{ marginTop: 'var(--space-2)' }}>
                  <GlucoseCard g={data.glucose} dict={dict} />
                </div>
              )}
            </details>
          )}

          {/* bug2:身体账本的「餐后血糖」迁入分析页。
              bug3 p40:「稳 / 飙」这个折叠删掉 —— 内容并进了下面的「健康提示」。 */}
          <details className="nesio-fin-fold" style={{ marginTop: 'var(--space-2)' }}>
            <summary className="nesio-settings-section-label" style={{ cursor: 'pointer', listStyle: 'none', marginTop: 0 }}>{L(dict, '餐后血糖', 'Post-meal glucose')} ›</summary>
            <PostMealBody health={data} dict={dict} />
          </details>

          {/* 判定:指南接地 + 已验证评分(红只给真红旗,每条带出处 + 非诊断) */}
          <FindingsCard data={data} dict={dict} />
          <RiskCard data={data} dict={dict} />

          {/* 跨板块关系(统计非因果;bug2:底部说明文字删) */}
          {rels.length > 0 && (
            <div className="nesio-fit-panel" style={{ marginTop: 'var(--space-2)' }}>
              <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '跨板块关系', 'Cross-domain relationships')} <span className="nesio-connector-soon" style={{ background: 'var(--portal-surface-2, rgba(127,127,127,0.1))', color: 'var(--portal-muted)' }}>{L(dict, '统计非因果', 'correlation')}</span></p>
              {rels.map((rel) => (
                <p key={rel.key} className="nesio-health-story-line">
                  <span style={{ display: 'inline-block', minWidth: 42, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' as never, color: rel.strength === 'strong' ? 'var(--status-go)' : 'var(--portal-muted)' }}>
                    {rel.strength === 'strong' ? L(dict, '强', 'strong') : L(dict, '中', 'mod')} · n={rel.n}
                  </span>
                  {L(dict, rel.insight[0], rel.insight[1])}
                </p>
              ))}
            </div>
          )}

          {/* 在关系之上,让念念生成人话建议(不下诊断) */}
          {(data.glucose || (data.daily && data.daily.length >= 7)) && <AiInsightPanel data={data} dict={dict} />}

          {/* 指标组(bug2:折叠,活动等各组收起) */}
          {GROUPS.map((g) => {
            const items = data.metrics.filter((m) => m.group === g.key);
            if (!items.length) return null;
            return (
              <details key={g.key} className="nesio-fin-fold" style={{ marginTop: 'var(--space-2)' }}>
                <summary className="nesio-settings-section-label" style={{ cursor: 'pointer', listStyle: 'none', marginTop: 0 }}>{L(dict, g.zh, g.en)} ›</summary>
                <div className="nesio-health-grid">
                  {items.map((m) => <MetricCard key={m.key} m={m} dict={dict} />)}
                </div>
              </details>
            );
          })}

          {/* ── 健康月报(对齐财务页形态:下载彩色 HTML / 存记忆 / 打印存 PDF) ── */}
          {(() => {
            const ym = healthMonths(data.daily)[0] ?? new Date().toISOString().slice(0, 7);
            return (
              <>
                {/* bug3 p39:「健康月报」这个标题删了 —— 按钮文字自己说了是月报 */}
                <div className="nesio-fin-budget-add" style={{ marginTop: 'var(--space-5)' }}>
                  <button type="button" className="nesio-fin-flowopt" onClick={() => {
                    try {
                      const blob = new Blob([healthReportRichHtml(data, ym, dict)], { type: 'text/html;charset=utf-8' });
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = `health-report-${ym}.html`;
                      document.body.appendChild(a); a.click(); a.remove();
                      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                      setReportMsg(L(dict, `已下载 ${ym} 彩色健康月报(.html,双击打开)`, `Colorful health report for ${ym} downloaded (.html)`));
                    } catch { setReportMsg(L(dict, '月报生成失败,请重试', 'Report failed — try again')); }
                  }}>{L(dict, '彩色月报', 'Report')}</button>
                  <button type="button" className="nesio-fin-flowopt" onClick={() => {
                    try {
                      const outcome = persistHealthReportToMemory(buildMonthlyHealthReport(data, ym, dict));
                      setReportMsg(outcome === 'created'
                        ? L(dict, `已把 ${ym} 健康月报存入记忆,「问一问」可检索`, `Health report ${ym} saved to memory`)
                        : L(dict, `已更新记忆里的 ${ym} 健康月报`, `Updated the ${ym} health report in memory`));
                    } catch { setReportMsg(L(dict, '存入记忆失败,请重试', 'Save to Memory failed — try again')); }
                  }}>{L(dict, '存记忆', 'To Memory')}</button>
                  {/* bug3 p39:「打印 / 存 PDF」删掉 —— 彩色月报下载的就是可直接打印的 HTML,
                      系统自带打印即可,不必在这里再放一个按钮。 */}
                </div>
                {reportMsg && <p className="nesio-settings-option-hint">{reportMsg}</p>}
              </>
            );
          })()}

          {/* 临床记录(Lab · 本机) */}
          {labMode && clinical && <ClinicalCard c={clinical} dict={dict} />}

          <FamilyDataCard kind="health" />

          {/* bug3 p39:底部「数据只存本机 · …」那行小字删掉(隐私说明在设置里,不必每页复述) */}
        </>
      ) : null}

      <HealthRecordSheet open={recordOpen} onClose={() => setRecordOpen(false)} />
      <MetricDetailSheet metric={openMetric} onClose={() => setOpenMetric(null)} />
      <LabScanSheet open={scanOpen} onClose={() => setScanOpen(false)} onManual={() => setRecordOpen(true)} />
    </div>
  );
}
