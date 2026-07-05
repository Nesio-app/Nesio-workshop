'use client';

/**
 * HealthDashboard — Apple Health 指标看板(批次 39)。洞察 → 「健康」tab。
 * 读 nesio-health-v1(Apple Health 导入解析出的最新指标),按组渲染卡片:
 * 活动 / 心脏 / 身体成分 / 生命体征 / 身心。每张卡显示最新值 + 相对上次的变化。
 */

import { useEffect, useState } from 'react';
import { loadHealthMetrics } from '@/lib/portal/health-store';
import type { HealthMetric, HealthMetrics } from '@/lib/portal/apple-health';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import TrainingPlan from './TrainingPlan';
import { computeFitnessInsight, type FitnessInsight } from '@/lib/platform/fitness-integrator';
import { loadTrainingState, sessionsThisWeek, protocolById } from '@/lib/platform/training-protocol-engine';

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

// 批次 40:按月历史趋势曲线(多年)
function Sparkline({ series }: { series: Array<{ ym: string; v: number }> }) {
  const vals = series.map((s) => s.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 100;
  const H = 26;
  const pts = series.map((s, i) => {
    const x = series.length > 1 ? (i / (series.length - 1)) * W : 0;
    const y = H - ((s.v - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="26" preserveAspectRatio="none" style={{ marginTop: '0.35rem', overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke="var(--portal-blue-deep)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={W} cy={H - ((vals[vals.length - 1] - min) / range) * H} r="2" fill="var(--portal-blue-deep)" />
    </svg>
  );
}

function MetricCard({ m, dict }: { m: HealthMetric; dict: string }) {
  const delta = m.prev != null && m.prev !== 0 ? m.latest - m.prev : null;
  const deltaPct = m.prev != null && m.prev !== 0 ? Math.round(((m.latest - m.prev) / Math.abs(m.prev)) * 100) : null;
  const hasTrend = (m.series?.length ?? 0) >= 3;
  return (
    <div className="nesio-health-card">
      <span className="nesio-health-card-label">{L(dict, m.label[0], m.label[1])}</span>
      <span className="nesio-health-card-value">{fmt(m.latest, m.decimals)}<span className="nesio-health-card-unit">{m.unit}</span></span>
      {delta != null && deltaPct != null ? (
        <span className={`nesio-health-card-delta${delta > 0 ? ' up' : delta < 0 ? ' down' : ''}`}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '—'} {L(dict, '较上次', 'vs last')} {delta > 0 ? '+' : ''}{fmt(delta, m.decimals)}
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
