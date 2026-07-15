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
import TrainingPlan from './TrainingPlan';
import { computeFitnessInsight, type FitnessInsight } from '@/lib/platform/fitness-integrator';
import { loadTrainingState, sessionsThisWeek, protocolById } from '@/lib/platform/training-protocol-engine';
import { healthNarrative, analyzeSeries } from '@/lib/portal/health-narrative';
import { mineRelationships } from '@/lib/portal/health-correlations';
import { loadClinical, type StoredClinical } from '@/lib/portal/clinical-store';
import { readLaunchSurfaceContextFromBrowser } from '@/lib/portal/launch-surface.mjs';
import { evaluateHealthFindings, type Severity } from '@/lib/portal/health-clinical';
import { computeRiskScores, type RiskCategory } from '@/lib/portal/health-risk';
import { buildMonthlyHealthReport, persistHealthReportToMemory, autoPersistLastMonthHealthReport, healthMonths } from '@/lib/portal/health-report';
import { healthReportRichHtml } from '@/lib/portal/health-report-visual';
import { IconLock } from '../icons';
import { guardPaidCloudAi } from '@/lib/portal/entitlement';

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
      <p className="nesio-settings-option-hint" style={{ margin: '0.3rem 0 0' }}>{L(dict, '按规则从你的指标+训练打卡推出(非 AI)', 'Rule-based from your metrics + training log (not AI)')}</p>
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
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="26" preserveAspectRatio="none" style={{ marginTop: '0.35rem', overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke="var(--portal-blue-deep)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {pat && (() => { const p = xy(pat.peakIdx); return <circle cx={p.x} cy={p.y} r="2.2" fill="#e0954a" />; })()}
      {pat && (() => { const p = xy(pat.valleyIdx); return <circle cx={p.x} cy={p.y} r="2.2" fill="#3d9f6e" />; })()}
      {pat?.anomalyIdx != null && (() => { const p = xy(pat.anomalyIdx); return <circle cx={p.x} cy={p.y} r="2.6" fill="none" stroke="#c25d7a" strokeWidth="1.4" />; })()}
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
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', margin: '0.5rem 0 0.35rem', background: 'var(--portal-line)' }}>
        {g.belowPct > 0 && <div style={{ width: `${g.belowPct}%`, background: 'var(--status-risk)' }} />}
        <div style={{ width: `${g.tirPct}%`, background: 'var(--status-go)' }} />
        {g.abovePct > 0 && <div style={{ width: `${g.abovePct}%`, background: 'var(--status-gentle)' }} />}
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.7rem', color: 'var(--portal-muted)', flexWrap: 'wrap' }}>
        <span><b style={{ color: 'var(--status-go)' }}>{g.tirPct}%</b> {L(dict, '达标', 'in range')}</span>
        {g.belowPct > 0 && <span><b style={{ color: 'var(--status-risk)' }}>{g.belowPct}%</b> {L(dict, '偏低', 'low')}</span>}
        {g.abovePct > 0 && <span><b style={{ color: 'var(--status-gentle)' }}>{g.abovePct}%</b> {L(dict, '偏高', 'high')}</span>}
        <span>GMI <b>{g.gmi}%</b></span>
        <span>{L(dict, '波动', 'CV')} <b>{g.cv}%</b></span>
      </div>

      {/* 每日 min–max 范围带 + 平均点,叠目标区间带 */}
      {daily.length >= 2 && (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="44" preserveAspectRatio="none" style={{ marginTop: '0.5rem', overflow: 'visible' }}>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
        {rings.map((r) => {
          const pct = r.goal > 0 ? Math.min(100, Math.round((r.v / r.goal) * 100)) : 0;
          return (
            <div key={r.label[0]}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--portal-muted)', marginBottom: 2 }}>
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
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', margin: '0.5rem 0 0.4rem', background: 'var(--portal-line)' }}>
        {segs.filter((g) => g.v > 0).map((g) => <div key={g.label[0]} style={{ width: `${(g.v / denom) * 100}%`, background: g.color }} />)}
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.7rem', color: 'var(--portal-muted)' }}>
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
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="26" preserveAspectRatio="none" style={{ marginTop: '0.4rem', overflow: 'visible' }}>
          <line x1="0" x2={W} y1={mid} y2={mid} stroke="var(--portal-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <polyline points={pts} fill="none" stroke={toneColor} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <span className="nesio-health-card-range">{L(dict, `近 ${d.length} 天 · ${mood.count} 次记录`, `${d.length}d · ${mood.count} logs`)}</span>
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

  return (
    <div className="nesio-fit-panel" style={{ marginTop: '0.6rem' }}>
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, 'AI 综合解读', 'AI synthesis')}</p>
      {status === 'done' ? (
        <>
          {text.split('\n').filter(Boolean).map((line, i) => <p key={i} className="nesio-health-story-line">{line}</p>)}
          <button type="button" className="nesio-connector-connect" style={{ marginTop: '0.4rem', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)' }} onClick={() => void run()}>{L(dict, '重新生成', 'Regenerate')}</button>
        </>
      ) : status === 'error' ? (
        <>
          <p className="nesio-health-story-line" style={{ color: 'var(--status-risk)' }}>{L(dict, '生成失败,请重试。', 'Failed to generate. Please retry.')}</p>
          <button type="button" className="nesio-connector-connect" style={{ marginTop: '0.2rem' }} onClick={() => void run()}>{L(dict, '重试', 'Retry')}</button>
        </>
      ) : (
        <button type="button" className="nesio-connector-connect" disabled={status === 'loading'} onClick={() => void run()}>
          {status === 'loading' ? L(dict, '生成中…', 'Generating…') : L(dict, '让 AI 解读我的健康数据', 'Let AI interpret my health data')}
        </button>
      )}
      <p className="nesio-settings-option-hint" style={{ margin: '0.3rem 0 0' }}>{L(dict, '基于上面已算出的关系,数据只发给模型生成建议,不下诊断', 'Built on the relationships above; not a diagnosis')}</p>
    </div>
  );
}

// 批次 48(D2):临床记录卡(化验单/用药/诊断)—— 仅 lab 模式渲染,本机存储的敏感数据。
function ClinicalCard({ c, dict }: { c: StoredClinical; dict: string }) {
  const flagColor = (f?: string) => (f === 'high' ? 'var(--status-gentle)' : f === 'low' ? 'var(--status-calm)' : 'var(--portal-ink)');
  return (
    <div>
      <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>
        {L(dict, '临床记录', 'Clinical records')} <span className="nesio-connector-soon" style={{ background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)' }}>Lab</span>
      </p>
      {c.labs.length > 0 && (
        <div className="nesio-health-card" style={{ gridColumn: '1 / -1' }}>
          <span className="nesio-health-card-label">{L(dict, `化验单 · ${c.labs.length} 项`, `Labs · ${c.labs.length}`)}</span>
          <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {c.labs.slice(0, 20).map((lab, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.74rem' }}>
                <span style={{ color: 'var(--portal-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lab.name}</span>
                <span style={{ flexShrink: 0 }}>
                  <b style={{ color: flagColor(lab.flag) }}>{lab.value}{lab.unit ? ` ${lab.unit}` : ''}</b>
                  {(lab.low != null || lab.high != null) && <span style={{ color: 'var(--portal-muted)', fontSize: '0.66rem' }}> ({lab.low ?? ''}–{lab.high ?? ''})</span>}
                  {lab.date && <span style={{ color: 'var(--portal-muted)', fontSize: '0.66rem', marginLeft: 4 }}>{lab.date.slice(2)}</span>}
                </span>
              </div>
            ))}
          </div>
          {c.labs.length > 20 && <span className="nesio-health-card-range">{L(dict, `另有 ${c.labs.length - 20} 项`, `+${c.labs.length - 20} more`)}</span>}
        </div>
      )}
      {(c.medications.length > 0 || c.conditions.length > 0) && (
        <div className="nesio-health-card" style={{ gridColumn: '1 / -1', marginTop: '0.5rem' }}>
          {c.conditions.length > 0 && <p style={{ margin: '0 0 0.3rem', fontSize: '0.74rem' }}><span style={{ color: 'var(--portal-muted)' }}>{L(dict, '诊断:', 'Conditions: ')}</span>{c.conditions.slice(0, 12).join(' · ')}</p>}
          {c.medications.length > 0 && <p style={{ margin: 0, fontSize: '0.74rem' }}><span style={{ color: 'var(--portal-muted)' }}>{L(dict, '用药:', 'Meds: ')}</span>{c.medications.slice(0, 12).join(' · ')}</p>}
        </div>
      )}
      <p className="nesio-settings-option-hint" style={{ marginTop: '0.4rem' }}>{L(dict, '来自 Apple 健康记录(export_cda)· 仅本机 · 仅 Lab 模式可见', 'From Apple Health Records (export_cda) · on-device · Lab only')}</p>
    </div>
  );
}

// 批次 49:健康提示卡 —— 指南接地的确定性判定(①目标 + ②模式),依严重度着色 + 出处。
function FindingsCard({ data, dict }: { data: HealthMetrics; dict: string }) {
  const findings = evaluateHealthFindings({ glucose: data.glucose, sleepStages: data.sleepStages, metrics: data.metrics });
  if (!findings.length) return null;
  const color: Record<Severity, string> = { flag: 'var(--status-risk)', attention: 'var(--status-gentle)', info: 'var(--status-go)' };
  const dot: Record<Severity, [string, string]> = { flag: ['需留意', 'flag'], attention: ['可关注', 'watch'], info: ['正常', 'ok'] };
  return (
    <div className="nesio-fit-panel" style={{ marginTop: '0.6rem' }}>
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '健康提示 · 依据指南', 'Health flags · guideline-based')}</p>
      {findings.map((f) => (
        <div key={f.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', marginBottom: '0.35rem' }}>
          <span style={{ flexShrink: 0, minWidth: 44, fontSize: '0.62rem', fontWeight: 600, color: color[f.severity] }}>● {L(dict, dot[f.severity][0], dot[f.severity][1])}</span>
          <span className="nesio-health-story-line" style={{ margin: 0 }}>
            <b>{L(dict, f.title[0], f.title[1])}</b> — {L(dict, f.detail[0], f.detail[1])}
            <span style={{ display: 'block', fontSize: '0.62rem', color: 'var(--portal-muted)' }}>{L(dict, `依据:${f.source}`, `source: ${f.source}`)}</span>
          </span>
        </div>
      ))}
      <p className="nesio-settings-option-hint" style={{ margin: '0.3rem 0 0' }}>{L(dict, '对照已发表共识/指南的规则判定,非 AI、非诊断;红旗请与医生确认', 'Rule-based against published consensus; not AI, not a diagnosis')}</p>
    </div>
  );
}

// 批次 50(③层):风险分层卡 —— 已验证评分(VO₂max 体适能/BMI/GMI→eA1c),数据齐才出,带出处。
function RiskCard({ data, dict }: { data: HealthMetrics; dict: string }) {
  const scores = computeRiskScores({ metrics: data.metrics, glucose: data.glucose, profile: data.profile });
  if (!scores.length) return null;
  const color: Record<RiskCategory, string> = { high: 'var(--status-risk)', moderate: 'var(--status-gentle)', low: 'var(--status-go)', info: 'var(--portal-muted)' };
  return (
    <div className="nesio-fit-panel" style={{ marginTop: '0.6rem' }}>
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '风险分层 · 已验证评分', 'Risk stratification · validated scores')}</p>
      {scores.map((s) => (
        <div key={s.id} style={{ marginBottom: '0.35rem' }}>
          <p className="nesio-health-story-line" style={{ margin: 0 }}>
            <span style={{ color: color[s.category], fontWeight: 600 }}>● </span>
            <b>{L(dict, s.label[0], s.label[1])}</b> — <span style={{ color: color[s.category] }}>{s.value}</span>
            <span style={{ display: 'block', fontSize: '0.62rem', color: 'var(--portal-muted)' }}>{L(dict, s.detail[0], s.detail[1])} · {L(dict, `依据:${s.source}`, `source: ${s.source}`)}</span>
          </p>
        </div>
      ))}
      <p className="nesio-settings-option-hint" style={{ margin: '0.3rem 0 0' }}>{L(dict, '对照已发表评分/常模,数据齐才计算;非诊断', 'Against published scores/norms; computed only when inputs are present; not a diagnosis')}</p>
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
          <span className="nesio-health-card-date" style={{ marginLeft: '0.35rem', opacity: 0.7 }}>{m.latestDate.slice(5).replace('-', '/')}</span>
        </span>
      ) : (
        <span className="nesio-health-card-date">{m.latestDate.slice(5).replace('-', '/')}</span>
      )}
      {hasTrend && <Sparkline series={m.series} />}
      {hasTrend && <span className="nesio-health-card-range">{L(dict, `近 ${m.series.length} 个月`, `${m.series.length}mo`)} · {fmt(Math.min(...m.series.map((s) => s.v)), m.decimals)}–{fmt(Math.max(...m.series.map((s) => s.v)), m.decimals)}</span>}
    </div>
  );
}

// ── 概览/分析 二级切换 ──
function HealthSubTabs({ view, onChange, dict }: { view: 'overview' | 'analysis'; onChange: (v: 'overview' | 'analysis') => void; dict: string }) {
  return (
    <div className="nesio-health-subtabs" role="tablist" aria-label={L(dict, '健康视图', 'Health view')}>
      {(['overview', 'analysis'] as const).map((v) => (
        <button key={v} type="button" role="tab" aria-selected={view === v}
          className={`nesio-health-subtab${view === v ? ' is-active' : ''}`} onClick={() => onChange(v)}>
          {v === 'overview' ? L(dict, '概览', 'Overview') : L(dict, '分析', 'Analysis')}
        </button>
      ))}
    </div>
  );
}

// 隐私横条:健康/医疗/药物 只存本机
function PrivacyBanner({ dict }: { dict: string }) {
  return (
    <div className="nesio-health-privacy">
      <IconLock size={13} />
      <span>{L(dict, '健康 / 医疗 / 药物 · 只存本机,不上传云端', 'Health / medical / meds · on-device, never uploaded')}</span>
    </div>
  );
}

// 概览:念念安抚式小结(确定性叙事,非 AI;焦虑内容留给「分析」,这里先安抚)
function NenSummaryCard({ data, dict }: { data: HealthMetrics; dict: string }) {
  const lines = healthNarrative(data.metrics, dict).slice(0, 2);
  if (!lines.length) return null;
  return (
    <div className="nesio-health-nen">
      <span className="nesio-health-nen-avatar" aria-hidden>{L(dict, '念', 'N')}</span>
      <p className="nesio-health-nen-text">{lines.join(' ')}</p>
    </div>
  );
}

// 概览:今日精选(点任意卡进「分析」看深度)
function TodayPicks({ data, dict, onOpen }: { data: HealthMetrics; dict: string; onOpen: () => void }) {
  type Pick = { key: string; dot: string; label: string; value: string; unit?: string; sub: string };
  const picks: Pick[] = [];
  if (data.activityRings) {
    const a = data.activityRings;
    const rr: Array<[number, number]> = [[a.move, a.moveGoal], [a.exercise, a.exerciseGoal], [a.stand, a.standGoal]];
    const pct = Math.round(rr.map(([v, g]) => (g > 0 ? Math.min(100, (v / g) * 100) : 0)).reduce((s, x) => s + x, 0) / 3);
    picks.push({ key: 'rings', dot: 'var(--status-gentle)', label: L(dict, '活动三环', 'Activity'), value: `${pct}`, unit: '%', sub: pct >= 100 ? L(dict, '已合上', 'closed') : L(dict, '还差一点合上', 'almost closed') });
  }
  if (data.sleepStages) {
    const s = data.sleepStages;
    picks.push({ key: 'sleep', dot: 'var(--status-calm)', label: L(dict, '睡眠', 'Sleep'), value: s.total.toFixed(1), unit: 'h', sub: L(dict, `达标 · 深睡 ${s.deep.toFixed(1)}h`, `deep ${s.deep.toFixed(1)}h`) });
  }
  if (data.glucose) {
    picks.push({ key: 'glu', dot: 'var(--status-go)', label: L(dict, '血糖达标', 'Glucose'), value: `${data.glucose.tirPct}`, unit: '%', sub: L(dict, 'TIR 稳', 'TIR steady') });
  }
  if (data.mood) {
    const tl: [string, string] = data.mood.tone === 'pleasant' ? ['偏积极', 'Pleasant'] : data.mood.tone === 'unpleasant' ? ['偏低落', 'Low'] : ['中性', 'Neutral'];
    const v = data.mood.avgValence;
    picks.push({ key: 'mood', dot: 'var(--portal-cool-accent)', label: L(dict, '情绪', 'Mood'), value: L(dict, tl[0], tl[1]), sub: L(dict, `效价 ${v > 0 ? '+' : ''}${v}`, `valence ${v > 0 ? '+' : ''}${v}`) });
  }
  if (!picks.length) return null;
  return (
    <>
      <p className="nesio-insights-section-label">{L(dict, '今日精选', 'Today')}</p>
      <div className="nesio-health-picks">
        {picks.map((p) => (
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
          <span className="nesio-health-topfind-src">{L(dict, `依据:${top.source} · 详见「分析」`, `${top.source} · see Analysis`)}</span>
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

export default function HealthDashboard() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [data, setData] = useState<HealthMetrics | null>(null);
  const [clinical, setClinical] = useState<StoredClinical | null>(null);
  const [labMode, setLabMode] = useState(false);
  const [view, setView] = useState<'overview' | 'analysis'>('overview'); // 概览先安抚 / 分析看全部

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

  if (!data || data.metrics.length === 0) {
    return (
      <div className="nesio-health-dash">
        <p className="nesio-insights-empty" style={{ marginBottom: 0 }}>
          {L(dict,
            '还没有健康数据。到「设置 → 数据接入 → Apple Health」直接上传导出的 zip(或 export.xml),就会解析出步数、心率、睡眠、血氧、体重等指标。',
            'No health data yet. Go to Settings → Data sources → Apple Health and drop the exported zip (or export.xml) to parse steps, heart rate, sleep, SpO₂, weight and more.')}
        </p>
        <FamilyDataCard kind="health" />
        <TrainingPlan />
      </div>
    );
  }

  const importedLabel = new Date(data.importedAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' });
  const ts = loadTrainingState();
  const activeProto = ts.activeProtocolId ? protocolById(ts.activeProtocolId) : undefined;
  const insight = computeFitnessInsight(data.metrics, sessionsThisWeek(ts), activeProto?.sessionsPerWeek ?? null);

  const rels = data.daily ? mineRelationships(data.daily) : [];

  return (
    <div className="nesio-health-dash">
      <HealthSubTabs view={view} onChange={setView} dict={dict} />

      {view === 'overview' ? (
        /* ── 概览:一眼看懂 + 先安抚(焦虑细节收进「分析」)── */
        <>
          <PrivacyBanner dict={dict} />
          <NenSummaryCard data={data} dict={dict} />
          <TodayPicks data={data} dict={dict} onOpen={() => setView('analysis')} />
          <TopFinding data={data} dict={dict} onOpen={() => setView('analysis')} />
          <TopRelationship data={data} dict={dict} />
          <button type="button" className="nesio-health-goanalysis" onClick={() => setView('analysis')}>
            {L(dict, '去「分析」看全部数据', 'See all data in Analysis')} ›
          </button>
        </>
      ) : (
        /* ── 分析:深看全部(专项 + 判定 + 指标组 + 月报 + 临床)── */
        <>
          <p className="nesio-health-updated">{L(dict, `${data.metrics.length} 项指标 · 锻炼 ${data.workouts} 次 · 导入于 ${importedLabel}`, `${data.metrics.length} metrics · ${data.workouts} workouts · imported ${importedLabel}`)}</p>
          {data.profile && (data.profile.age || data.profile.sex || data.profile.bloodType) && (
            <p className="nesio-settings-option-hint" style={{ margin: '0.1rem 0 0' }}>
              {[data.profile.age ? L(dict, `${data.profile.age} 岁`, `${data.profile.age}y`) : '', data.profile.sex ? L(dict, ({ male: '男', female: '女' } as Record<string, string>)[data.profile.sex] || data.profile.sex, data.profile.sex) : '', data.profile.bloodType ? L(dict, `${data.profile.bloodType} 型`, data.profile.bloodType) : ''].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* 专项 */}
          {(insight.signals.length > 0 || data.activityRings || data.sleepStages || data.mood || data.glucose) && (
            <p className="nesio-settings-section-label" style={{ marginTop: '0.6rem' }}>{L(dict, '专项', 'Deep dive')}</p>
          )}
          {insight.signals.length > 0 && <FitnessPanel insight={insight} dict={dict} />}
          {(data.activityRings || data.sleepStages || data.mood) && (
            <div className="nesio-health-grid" style={{ marginTop: '0.5rem' }}>
              {data.activityRings && <ActivityRingsCard a={data.activityRings} dict={dict} />}
              {data.sleepStages && <SleepStagesCard s={data.sleepStages} dict={dict} />}
              {data.mood && <MoodCard mood={data.mood} dict={dict} />}
            </div>
          )}
          {data.glucose && (
            <div className="nesio-health-grid" style={{ marginTop: '0.5rem' }}>
              <GlucoseCard g={data.glucose} dict={dict} />
            </div>
          )}

          {/* 判定:指南接地 + 已验证评分(红只给真红旗,每条带出处 + 非诊断) */}
          <FindingsCard data={data} dict={dict} />
          <RiskCard data={data} dict={dict} />

          {/* 跨板块关系(统计非因果) */}
          {rels.length > 0 && (
            <div className="nesio-fit-panel" style={{ marginTop: '0.6rem' }}>
              <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '跨板块关系', 'Cross-domain relationships')} <span className="nesio-connector-soon" style={{ background: 'var(--portal-surface-2, rgba(127,127,127,0.1))', color: 'var(--portal-muted)' }}>{L(dict, '统计非因果', 'correlation')}</span></p>
              {rels.map((rel) => (
                <p key={rel.key} className="nesio-health-story-line">
                  <span style={{ display: 'inline-block', minWidth: 42, fontSize: '0.62rem', fontWeight: 600, color: rel.strength === 'strong' ? 'var(--status-go)' : 'var(--portal-muted)' }}>
                    {rel.strength === 'strong' ? L(dict, '强', 'strong') : L(dict, '中', 'mod')} · n={rel.n}
                  </span>
                  {L(dict, rel.insight[0], rel.insight[1])}
                </p>
              ))}
              <p className="nesio-settings-option-hint" style={{ margin: '0.3rem 0 0' }}>{L(dict, '统计相关,非因果 · 基于你的每日数据(非 AI)', 'Statistical correlation, not causation · from your daily data (not AI)')}</p>
            </div>
          )}

          {/* 在关系之上,让念念生成人话建议(不下诊断) */}
          {(data.glucose || (data.daily && data.daily.length >= 7)) && <AiInsightPanel data={data} dict={dict} />}

          {/* 指标组 */}
          {GROUPS.map((g) => {
            const items = data.metrics.filter((m) => m.group === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key}>
                <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>{L(dict, g.zh, g.en)}</p>
                <div className="nesio-health-grid">
                  {items.map((m) => <MetricCard key={m.key} m={m} dict={dict} />)}
                </div>
              </div>
            );
          })}

          <TrainingPlan />

          {/* ── 健康月报(对齐财务页形态:下载彩色 HTML / 存记忆 / 打印存 PDF) ── */}
          {(() => {
            const ym = healthMonths(data.daily)[0] ?? new Date().toISOString().slice(0, 7);
            return (
              <>
                <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '健康月报', 'Monthly report')}</p>
                <div className="nesio-fin-budget-add">
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
                  }}>{L(dict, '下载彩色月报', 'Download report')}</button>
                  <button type="button" className="nesio-fin-flowopt" onClick={() => {
                    try {
                      const outcome = persistHealthReportToMemory(buildMonthlyHealthReport(data, ym, dict));
                      setReportMsg(outcome === 'created'
                        ? L(dict, `已把 ${ym} 健康月报存入记忆,「问一问」可检索`, `Health report ${ym} saved to memory`)
                        : L(dict, `已更新记忆里的 ${ym} 健康月报`, `Updated the ${ym} health report in memory`));
                    } catch { setReportMsg(L(dict, '存入记忆失败,请重试', 'Save to Memory failed — try again')); }
                  }}>{L(dict, '存入记忆', 'Save to Memory')}</button>
                  <button type="button" className="nesio-fin-flowopt" onClick={() => {
                    try {
                      const w = window.open('', '_blank');
                      if (!w) { setReportMsg(L(dict, '弹窗被拦截,请允许弹窗后重试', 'Popup blocked — allow popups and retry')); return; }
                      w.document.write(healthReportRichHtml(data, ym, dict));
                      w.document.close();
                      setTimeout(() => { try { w.focus(); w.print(); } catch { /* 用户手动打印 */ } }, 350);
                      setReportMsg(L(dict, '已打开打印视图(打印 → 存为 PDF)', 'Print view opened (Print → Save as PDF)'));
                    } catch { setReportMsg(L(dict, '打印视图打开失败,请重试', 'Print view failed — try again')); }
                  }}>{L(dict, '打印 / 存 PDF', 'Print / PDF')}</button>
                </div>
                {reportMsg && <p className="nesio-settings-option-hint">{reportMsg}</p>}
              </>
            );
          })()}

          {/* 临床记录(Lab · 本机) */}
          {labMode && clinical && <ClinicalCard c={clinical} dict={dict} />}

          <FamilyDataCard kind="health" />

          <p className="nesio-settings-option-hint" style={{ marginTop: '1rem', textAlign: 'center' }}>
            {L(dict, '数据只存本机 · 随时可断开;取最近导入的最新读数', 'On-device only · disconnect anytime; latest readings from your import')}
          </p>
        </>
      )}
    </div>
  );
}
