'use client';

/**
 * MetricDetailSheet — 指标详情(健康镜头 C 屏,2026-07-29)。核心卖点屏。
 *
 * 「空腹血糖 6.8」这个数字本身没什么用。有用的是:
 *   · 这三年它怎么走的(长曲线);
 *   · 相对参考区间在哪(绿带);
 *   · **从吃药那天起有没有变**(用药起始日的虚线竖线叠在曲线上)。
 * 第三条是全屏最值钱的一根线,它依赖 health.med 的 startedAt —— 所以录入那一步
 * 才必须老老实实记起始日,不能编。
 *
 * 下面「同期发生」把用药/症状/就诊按时间对齐:曲线拐弯那阵子还发生了什么,
 * 一屏就能对上。不做因果判断,只做时间对齐 —— 判因果是医生的事。
 */

import { useMemo } from 'react';
import NesioSheet from '../ui/NesioSheet';
import LabCurve, { type MedMark } from './LabCurve';
import {
  healthSignals, labSeries, SELF_PERSON_KEY,
  HEALTH_MED, HEALTH_SYMPTOM, HEALTH_VISIT,
  type HealthMedPayload,
} from '@/lib/health/health-signals';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

export default function MetricDetailSheet({
  metric, personKey = SELF_PERSON_KEY, onClose,
}: { metric: string | null; personKey?: string; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const points = useMemo(() => (metric ? labSeries(metric, personKey) : []), [metric, personKey]);

  const meds: MedMark[] = useMemo(() => {
    if (!metric) return [];
    return healthSignals({ personKey, types: [HEALTH_MED] })
      .map((s) => s.payload as unknown as HealthMedPayload)
      .filter((p): p is HealthMedPayload & { startedAt: string } => Boolean(p?.name && p.startedAt))
      .map((p) => ({ name: p.name, startedAt: p.startedAt }));
  }, [metric, personKey]);

  // 「同期发生」:曲线时间窗内的用药/症状/就诊,按时间倒序。
  const alongside = useMemo(() => {
    if (!metric || points.length < 1) return [];
    const from = points[0].date;
    const to = points[points.length - 1].date;
    return healthSignals({ personKey, types: [HEALTH_MED, HEALTH_SYMPTOM, HEALTH_VISIT] })
      .map((s) => ({ id: s.id, type: s.type, day: s.occurredAt.slice(0, 10), title: s.title }))
      .filter((e) => e.day >= from && e.day <= to)
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, 12);
  }, [metric, personKey, points]);

  if (!metric) return null;

  const last = points[points.length - 1];
  const unit = last?.unit || '';
  const off = last && (last.flag === 'high' || last.flag === 'low');
  const kindLabel = (type: string) =>
    type === HEALTH_MED ? t('用药', 'Med')
      : type === HEALTH_SYMPTOM ? t('症状', 'Symptom')
        : t('就诊', 'Visit');

  return (
    <NesioSheet variant="bottom" elevated open onOpenChange={(n) => { if (!n) onClose(); }}
      card={false} className="nesio-settings-sheet-card" ariaLabel={metric}>
      <h2 className="nesio-settings-sheet-title">{metric}</h2>
      <div className="nesio-settings-sheet-body">

        {points.length === 0 ? (
          <p className="nesio-insights-empty">{t('这个指标还没有记录。', 'No readings for this metric yet.')}</p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-h2, 1.5rem)', fontWeight: 'var(--weight-bold, 700)', color: off ? 'var(--status-gentle)' : 'var(--portal-ink)' }}>
                {last.value}
              </span>
              <span className="nesio-rel-rec-sub">{unit}</span>
              {(last.low != null || last.high != null) && (
                <span className="nesio-rel-rec-sub">{t(`参考 ${last.low ?? ''}–${last.high ?? ''}`, `ref ${last.low ?? ''}–${last.high ?? ''}`)}</span>
              )}
            </div>

            <div style={{ marginTop: 'var(--space-2)' }}>
              <LabCurve points={points} unit={unit} meds={meds} height={150} />
            </div>

            <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-2) 0 0' }}>
              {meds.length > 0
                ? t('绿色带是参考区间;竖虚线是开始吃药的日子。', 'Green band = reference range; dashed lines = when a medication started.')
                : t('绿色带是参考区间。记下在用药的起始日,这里就会画出竖虚线。', 'Green band = reference range. Log a medication start date to see it marked here.')}
            </p>

            <p className="nesio-rel-rec-sub" style={{ display: 'block', marginTop: 'var(--space-1)' }}>
              {t(`${points.length} 次记录 · ${points[0].date} 起`, `${points.length} readings · since ${points[0].date}`)}
            </p>

            {/* 全部读数,新的在前 */}
            <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>{t('每次读数', 'Readings')}</p>
            <div className="nesio-rel-rec-list">
              {[...points].reverse().map((p, i) => (
                <div key={i} className="nesio-rel-rec-row">
                  <div className="nesio-rel-rec-main">
                    <span className="nesio-rel-rec-title" style={{ color: p.flag === 'high' || p.flag === 'low' ? 'var(--status-gentle)' : 'var(--portal-ink)' }}>
                      {p.value}{unit ? ` ${unit}` : ''}
                    </span>
                    <span className="nesio-rel-rec-sub">{p.date}</span>
                  </div>
                </div>
              ))}
            </div>

            {alongside.length > 0 && (
              <>
                <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>{t('同期发生', 'Around the same time')}</p>
                <div className="nesio-rel-timeline">
                  {alongside.map((e) => (
                    <div key={e.id} className="nesio-rel-tl-row">
                      <span className="nesio-rel-tl-date">{e.day.slice(5)}</span>
                      <span className="nesio-rel-tl-text">{kindLabel(e.type)} · {e.title}</span>
                    </div>
                  ))}
                </div>
                <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>
                  {t('只按时间对齐,不代表互为因果。', 'Aligned by time only — not a causal claim.')}
                </p>
              </>
            )}
          </>
        )}

        <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
          {t('健康信息参考,不作诊断 · 仅本机', 'For reference, not a diagnosis · on this device')}
        </p>
      </div>
    </NesioSheet>
  );
}
