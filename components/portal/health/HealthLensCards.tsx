'use client';

/**
 * HealthLensCards — 健康镜头 A 屏三卡(2026-07-29)。
 *
 * 三张卡对应三类 Signal,全部读**主事实表**(不是那包旧 blob):
 *   ① 指标趋势 —— 迷你曲线 + 参考区间绿带 + 最新值;点开看长曲线(C 屏)。
 *   ② 在用药物 —— 今日已服 / 待服。
 *   ③ 就诊时间线 —— 最近几次去了哪儿。
 *
 * 一条都没有时整块不渲染 —— 空卡片比没有卡片更糟(占地方、还得读一遍才知道是空的)。
 * 入口(「记一条」)由外层给,不藏在这里面。
 *
 * 配色:偏离参考区间一律 amber(--status-gentle)。**不用红** —— 日常偏高不是风险,
 * --status-risk 只留给真实安全/到期风险(配色红线)。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  healthSignals, labSeries, personKeyOf, SELF_PERSON_KEY,
  HEALTH_LAB, HEALTH_MED, HEALTH_VISIT,
  type HealthLabPayload, type HealthMedPayload, type HealthVisitPayload,
} from '@/lib/health/health-signals';
import { isMedTaken, setMedTaken, takenCount, MED_LOG_EVENT } from '@/lib/health/med-log';
import LabCurve, { type LabPoint, type MedMark } from './LabCurve';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

interface MetricRow { name: string; unit: string; points: LabPoint[] }

const MAX_METRICS = 4;
const MAX_VISITS = 4;

function fmtDay(d: string, dict: string): string {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return d.slice(0, 10);
  return t.toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function HealthLensCards({
  personKey = SELF_PERSON_KEY, onOpenMetric,
}: { personKey?: string; onOpenMetric?: (name: string) => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [meds, setMeds] = useState<HealthMedPayload[]>([]);
  const [visits, setVisits] = useState<Array<{ id: string; date: string; title: string; note?: string }>>([]);
  const [tick, setTick] = useState(0);            // 打卡后重算「今日已服」
  const [logErr, setLogErr] = useState<string | null>(null);

  const rebuild = useCallback(() => {
    // ① 指标:按「有几次记录」排,多的在前 —— 只有一个点画不出趋势,那才是真正没意义的卡。
    const names = new Map<string, string>();
    for (const s of healthSignals({ personKey, types: [HEALTH_LAB] })) {
      const p = s.payload as unknown as HealthLabPayload;
      if (p?.name) names.set(p.name.trim().toLowerCase(), p.name.trim());
    }
    const rows: MetricRow[] = [];
    for (const display of names.values()) {
      const pts = labSeries(display, personKey);
      if (pts.length < 1) continue;
      rows.push({ name: display, unit: pts[pts.length - 1]?.unit || '', points: pts });
    }
    rows.sort((a, b) => b.points.length - a.points.length);
    setMetrics(rows.slice(0, MAX_METRICS));

    // ② 在用药:停了的不算「在用」
    const m = healthSignals({ personKey, types: [HEALTH_MED] })
      .map((s) => s.payload as unknown as HealthMedPayload)
      .filter((p) => p?.name && !p.stoppedAt);
    setMeds(m);

    // ③ 就诊:近的在前。bug3 p41:医生 / 保险 / 价格也显示出来 —— 不然填了看不见,等于没填。
    const v = healthSignals({ personKey, types: [HEALTH_VISIT] }).map((s) => {
      const p = s.payload as unknown as HealthVisitPayload;
      const money = typeof p?.price === 'number' && Number.isFinite(p.price)
        ? `${p.currency === 'USD' || !p.currency ? '$' : ''}${p.price}`
        : '';
      return {
        id: s.id, date: s.occurredAt, title: s.title,
        note: [p?.doctor, p?.insurance, money, p?.note].filter(Boolean).join(' · ') || undefined,
      };
    });
    setVisits(v.slice(0, MAX_VISITS));
  }, [personKey]);

  useEffect(() => {
    rebuild();
    const onUpdate = () => rebuild();
    const onLog = () => setTick((n) => n + 1);
    window.addEventListener('nesio-life-graph-updated', onUpdate);
    window.addEventListener(MED_LOG_EVENT, onLog);
    return () => {
      window.removeEventListener('nesio-life-graph-updated', onUpdate);
      window.removeEventListener(MED_LOG_EVENT, onLog);
    };
  }, [rebuild]);

  if (!metrics.length && !meds.length && !visits.length) return null;

  const medNames = meds.map((m) => m.name);
  const done = takenCount(medNames);
  void tick; // 打卡事件驱动重渲染

  // 用药起始日 → 曲线上的虚线竖线。「吃药后有没有用」全靠这条线。
  const medMarks: MedMark[] = meds
    .filter((m) => m.startedAt)
    .map((m) => ({ name: m.name, startedAt: m.startedAt as string }));

  const toggleMed = (name: string) => {
    const next = !isMedTaken(name);
    if (setMedTaken(name, next)) setLogErr(null);
    else setLogErr(t('这一下没记上 —— 本机存储写不进,过会儿再试。', "Couldn't record that — local storage write failed."));
  };

  return (
    <>
      {/* ① 指标趋势 */}
      {metrics.length > 0 && (
        <div style={{ marginTop: '0.8rem' }}>
          <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{t('指标趋势', 'Trends')}</p>
          {metrics.map((m) => {
            const last = m.points[m.points.length - 1];
            const off = last.flag === 'high' || last.flag === 'low';
            return (
              <div key={m.name} className="nesio-health-card" style={{ gridColumn: '1 / -1', marginBottom: '0.5rem' }}>
                <button type="button" onClick={() => onOpenMetric?.(m.name)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 0, padding: 0, cursor: onOpenMetric ? 'pointer' : 'default' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                    <span className="nesio-health-card-label">{m.name}</span>
                    <span style={{ fontWeight: 'var(--weight-semibold, 600)', color: off ? 'var(--status-gentle)' : 'var(--portal-ink)' }}>
                      {last.value}{m.unit ? ` ${m.unit}` : ''}
                    </span>
                  </div>
                  {m.points.length >= 2
                    ? <LabCurve points={m.points} unit={m.unit} meds={medMarks} height={72} />
                    : <p className="nesio-settings-option-hint" style={{ margin: '0.3rem 0 0' }}>{t('只有一次记录 —— 再记一次就能看出走向。', 'Only one reading — log another to see a trend.')}</p>}
                  <span className="nesio-health-card-range">
                    {[
                      fmtDay(last.date, dict),
                      last.low != null || last.high != null ? t(`参考 ${last.low ?? ''}–${last.high ?? ''}`, `ref ${last.low ?? ''}–${last.high ?? ''}`) : '',
                      m.points.length > 1 ? t(`${m.points.length} 次记录`, `${m.points.length} readings`) : '',
                    ].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ② 在用药物 */}
      {meds.length > 0 && (
        <div style={{ marginTop: '0.8rem' }}>
          <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>
            {t(`在用药物 · 今天 ${done}/${meds.length}`, `Medications · ${done}/${meds.length} today`)}
          </p>
          <div className="nesio-rel-rec-list">
            {meds.map((m) => {
              const taken = isMedTaken(m.name);
              return (
                <div key={m.name} className="nesio-rel-rec-row">
                  <div className="nesio-rel-rec-main">
                    <span className="nesio-rel-rec-title">{m.name}</span>
                    <span className="nesio-rel-rec-sub">
                      {[m.dose, m.freq, m.startedAt ? t(`${fmtDay(m.startedAt, dict)} 起`, `since ${fmtDay(m.startedAt, dict)}`) : ''].filter(Boolean).join(' · ')
                        || t('还没填剂量和频次', 'No dose or frequency yet')}
                    </span>
                  </div>
                  <button type="button" onClick={() => toggleMed(m.name)}
                    aria-pressed={taken}
                    style={{ flexShrink: 0, padding: '0.3rem 0.7rem', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
                      fontSize: 'var(--text-xs)',
                      border: `1px solid ${taken ? 'transparent' : 'var(--portal-line)'}`,
                      background: taken ? 'var(--status-go-soft)' : 'transparent',
                      color: taken ? 'var(--status-go)' : 'var(--portal-muted)' }}>
                    {taken ? t('吃过了', 'Taken') : t('今天吃了', 'Take')}
                  </button>
                </div>
              );
            })}
          </div>
          {/* 红线:打卡写失败必须看得见,不许打个勾然后数据没了 */}
          {logErr && <p className="nesio-rel-detail-err" role="alert" style={{ marginTop: '0.4rem' }}>{logErr}</p>}
        </div>
      )}

      {/* ③ 就诊时间线 */}
      {visits.length > 0 && (
        <div style={{ marginTop: '0.8rem' }}>
          <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{t('就诊', 'Visits')}</p>
          <div className="nesio-rel-timeline">
            {visits.map((v) => (
              <div key={v.id} className="nesio-rel-tl-row">
                <span className="nesio-rel-tl-date">{fmtDay(v.date, dict)}</span>
                <span className="nesio-rel-tl-text">{[v.title, v.note].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** 供外层判断「这个人有没有健康镜头数据」—— 没有就别给入口以外的东西。 */
export function hasLensData(personKey = SELF_PERSON_KEY): boolean {
  return healthSignals({ personKey }).length > 0;
}

export { personKeyOf };
