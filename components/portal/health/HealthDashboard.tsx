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

function MetricCard({ m, dict }: { m: HealthMetric; dict: string }) {
  const delta = m.prev != null && m.prev !== 0 ? m.latest - m.prev : null;
  const deltaPct = m.prev != null && m.prev !== 0 ? Math.round(((m.latest - m.prev) / Math.abs(m.prev)) * 100) : null;
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
      <p className="nesio-insights-empty">
        {L(dict,
          '还没有健康数据。到「设置 → 数据接入 → Apple Health」直接上传导出的 zip(或 export.xml),就会解析出步数、心率、睡眠、血氧、体重等指标。',
          'No health data yet. Go to Settings → Data sources → Apple Health and drop the exported zip (or export.xml) to parse steps, heart rate, sleep, SpO₂, weight and more.')}
      </p>
    );
  }

  const importedLabel = new Date(data.importedAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' });

  return (
    <div className="nesio-health-dash">
      <p className="nesio-health-updated">{L(dict, `${data.metrics.length} 项指标 · 锻炼 ${data.workouts} 次 · 导入于 ${importedLabel}`, `${data.metrics.length} metrics · ${data.workouts} workouts · imported ${importedLabel}`)}</p>
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
