'use client';

/**
 * HealthDashboard — Apple Health 指标看板(批次 39)。洞察 → 「健康」tab。
 * 读 nesio-health-v1(Apple Health 导入解析出的最新指标),按组渲染卡片:
 * 活动 / 心脏 / 身体成分 / 生命体征 / 身心。每张卡显示最新值 + 相对上次的变化。
 */

import { useEffect, useState } from 'react';
import { loadHealthMetrics } from '@/lib/portal/health-store';
import type { HealthMetric, HealthMetrics, GlucoseAnalysis } from '@/lib/portal/apple-health';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import TrainingPlan from './TrainingPlan';
import { computeFitnessInsight, type FitnessInsight } from '@/lib/platform/fitness-integrator';
import { loadTrainingState, sessionsThisWeek, protocolById } from '@/lib/platform/training-protocol-engine';
import { healthNarrative, analyzeSeries } from '@/lib/portal/health-narrative';

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

export default function HealthDashboard() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [data, setData] = useState<HealthMetrics | null>(null);

  useEffect(() => {
    setData(loadHealthMetrics());
    const onUpdate = () => setData(loadHealthMetrics());
    window.addEventListener('nesio-health-updated', onUpdate);
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
        <TrainingPlan />
      </div>
    );
  }

  const importedLabel = new Date(data.importedAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' });
  const ts = loadTrainingState();
  const activeProto = ts.activeProtocolId ? protocolById(ts.activeProtocolId) : undefined;
  const insight = computeFitnessInsight(data.metrics, sessionsThisWeek(ts), activeProto?.sessionsPerWeek ?? null);

  return (
    <div className="nesio-health-dash">
      <p className="nesio-health-updated">{L(dict, `${data.metrics.length} 项指标 · 锻炼 ${data.workouts} 次 · 导入于 ${importedLabel}`, `${data.metrics.length} metrics · ${data.workouts} workouts · imported ${importedLabel}`)}</p>
      {insight.signals.length > 0 && <FitnessPanel insight={insight} dict={dict} />}
      {(() => {
        const story = healthNarrative(data.metrics, dict);
        if (!story.length) return null;
        return (
          <div className="nesio-fit-panel" style={{ marginTop: '0.6rem' }}>
            <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '这段时间的健康', 'Your health lately')}</p>
            {story.map((s, i) => <p key={i} className="nesio-health-story-line">{s}</p>)}
            <p className="nesio-settings-option-hint" style={{ margin: '0.3rem 0 0' }}>{L(dict, '橙点=高峰 · 绿点=低谷 · 粉圈=异常', 'orange=peak · green=valley · pink ring=anomaly')}</p>
          </div>
        );
      })()}
      {data.glucose && (
        <div>
          <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>{L(dict, '血糖', 'Glucose')}</p>
          <div className="nesio-health-grid">
            <GlucoseCard g={data.glucose} dict={dict} />
          </div>
        </div>
      )}
      <TrainingPlan />
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
      <p className="nesio-settings-option-hint" style={{ marginTop: '1rem', textAlign: 'center' }}>
        {L(dict, '数据只存本机 · 取最近导入的最新读数;要更全历史趋势可多导几次', 'On-device only · latest readings from your import')}
      </p>
    </div>
  );
}
