'use client';

/**
 * MedicationPanel — 健康页「用药」独立版面(Bug.pdf #14/#15)。
 * 今日打卡 + 历史记录 + 成员切换(与家人/人物打通)。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  healthSignals, SELF_PERSON_KEY, HEALTH_MED,
  type HealthMedPayload,
} from '@/lib/health/health-signals';
import { isMedTaken, setMedTaken, takenCount, loadMedLog, medKey, MED_LOG_EVENT } from '@/lib/health/med-log';
import { buildRelationships } from '@/lib/portal/relationships';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import Button from '../ui/Button';
import HealthRecordSheet from './HealthRecordSheet';

function fmtDay(d: string, dict: string): string {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return d.slice(0, 10);
  return t.toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function MedicationPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);
  const [personKey, setPersonKey] = useState(SELF_PERSON_KEY);
  const [meds, setMeds] = useState<HealthMedPayload[]>([]);
  const [history, setHistory] = useState<HealthMedPayload[]>([]);
  const [tick, setTick] = useState(0);
  const [logErr, setLogErr] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [checkInDay, setCheckInDay] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const medLog = useMemo(() => loadMedLog(), [tick, personKey]);

  const people = useMemo(() => {
    try {
      const rels = buildRelationships(getLifeGraph())
        .sort((a, b) => (a.closeness === 'core' ? -1 : 1) - (b.closeness === 'core' ? -1 : 1))
        .slice(0, 12);
      return [{ key: SELF_PERSON_KEY, name: t('我', 'Me') }, ...rels.map((r) => ({ key: r.key, name: r.name }))];
    } catch {
      return [{ key: SELF_PERSON_KEY, name: t('我', 'Me') }];
    }
  }, [t]);

  const rebuild = useCallback(() => {
    const all = healthSignals({ personKey, types: [HEALTH_MED] })
      .map((s) => s.payload as unknown as HealthMedPayload)
      .filter((p) => p?.name);
    setMeds(all.filter((p) => !p.stoppedAt));
    setHistory(all.slice().sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '')));
  }, [personKey]);

  useEffect(() => {
    rebuild();
    const onMed = () => { rebuild(); setTick((n) => n + 1); };
    window.addEventListener(MED_LOG_EVENT, onMed);
    window.addEventListener('nesio-life-graph-updated', onMed);
    return () => {
      window.removeEventListener(MED_LOG_EVENT, onMed);
      window.removeEventListener('nesio-life-graph-updated', onMed);
    };
  }, [rebuild]);

  const done = takenCount(meds.map((m) => m.name), checkInDay);
  const whoLabel = people.find((p) => p.key === personKey)?.name || t('我', 'Me');

  const monthLabel = calMonth.y === new Date().getFullYear() && calMonth.m === new Date().getMonth()
    ? t('本月', 'This month')
    : new Date(calMonth.y, calMonth.m, 1).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'long' });
  const daysInMonth = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
  const firstDow = new Date(calMonth.y, calMonth.m, 1).getDay();
  const calCells: Array<{ day: number; ymd: string; taken: number } | null> = [];
  for (let i = 0; i < firstDow; i++) calCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd = `${calMonth.y}-${String(calMonth.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const names = medLog[ymd] || [];
    calCells.push({ day: d, ymd, taken: meds.length ? names.filter((n) => meds.some((m) => medKey(m.name) === n)).length : names.length });
  }

  function shiftCalMonth(delta: number) {
    setCalMonth(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  const checkInLabel = checkInDay === (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })()
    ? t('今天', 'Today')
    : fmtDay(checkInDay, dict);

  return (
    <div className="nesio-health-dash" style={{ paddingTop: 'var(--space-2)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>
          {t('成员', 'Person')}
          <select
            value={personKey}
            onChange={(e) => setPersonKey(e.target.value)}
            style={{ marginLeft: 'var(--space-2)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-ink)' }}
          >
            {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </label>
        <Button variant="primary" size="sm" onClick={() => setRecordOpen(true)}>{t('记一种药', 'Log medication')}</Button>
      </div>

      {(meds.length > 0 || history.length > 0) && (
        <section style={{ marginBottom: 'var(--space-4)' }}>
          <div className="nesio-fin-monthbar" style={{ marginBottom: 'var(--space-2)' }}>
            <button type="button" className="nesio-fin-monthnav" onClick={() => shiftCalMonth(-1)} aria-label={t('上一月', 'Previous month')}>‹</button>
            <span className="nesio-fin-month">{monthLabel}</span>
            <button type="button" className="nesio-fin-monthnav" onClick={() => shiftCalMonth(1)} aria-label={t('下一月', 'Next month')}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-1)', marginBottom: 'var(--space-1)' }} role="grid" aria-label={t('用药打卡日历', 'Medication calendar')}>
            {['日', '一', '二', '三', '四', '五', '六'].map((w, i) => (
              <span key={w} style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{dict === 'en' ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'][i] : w}</span>
            ))}
            {calCells.map((c, i) => (
              c ? (
                <button
                  key={c.ymd}
                  type="button"
                  onClick={() => setCheckInDay(c.ymd)}
                  title={c.taken > 0 ? t(`${c.day}日 · 已服 ${c.taken} 种`, `Day ${c.day} · ${c.taken} taken`) : t(`${c.day}日 · 点开打卡`, `Day ${c.day} · tap to check in`)}
                  style={{
                    position: 'relative', aspectRatio: '1', borderRadius: 'var(--radius-sm)',
                    border: c.ymd === checkInDay ? '1.5px solid var(--portal-accent)' : '1px solid var(--portal-line)',
                    background: c.taken > 0 ? 'var(--status-go-soft)' : c.ymd === checkInDay ? 'var(--portal-accent-soft)' : 'transparent',
                    color: 'var(--portal-ink)', fontSize: 'var(--text-xs)', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  }}
                >
                  {c.day}
                  {c.taken > 0 && meds.length > 0 && c.taken >= meds.length && (
                    <i style={{ position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)', width: 5, height: 5, borderRadius: '50%', background: 'var(--status-go)' }} aria-hidden />
                  )}
                </button>
              ) : <span key={`e-${i}`} aria-hidden />
            ))}
          </div>
        </section>
      )}

      {meds.length === 0 && history.length === 0 ? (
        <p className="nesio-insights-empty">
          {t(`${whoLabel}还没有用药记录 —— 点「记一种药」开始。`, `No medications for ${whoLabel} yet — tap Log medication.`)}
        </p>
      ) : (
        <>
          {meds.length > 0 && (
            <section style={{ marginBottom: 'var(--space-4)' }}>
              <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>
                {t(`${checkInLabel}在吃 · ${done}/${meds.length}`, `Active ${checkInLabel} · ${done}/${meds.length}`)}
              </h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {meds.map((m) => {
                  const taken = isMedTaken(m.name, checkInDay);
                  return (
                    <li key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)', background: 'var(--portal-accent-soft)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ fontSize: 'var(--text-body)' }}>{m.name}</strong>
                        {(m.dose || m.freq) && (
                          <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                            {[m.dose, m.freq].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                      <Button
                        variant={taken ? 'secondary' : 'primary'}
                        size="sm"
                        onClick={() => {
                          const ok = setMedTaken(m.name, !taken, checkInDay);
                          if (!ok) setLogErr(t('打卡没存上,再试一次。', "Couldn't save — try again."));
                          else { setLogErr(null); setTick((n) => n + 1); }
                        }}
                      >
                        {taken ? t('已服', 'Taken') : t('吃过了', 'Mark taken')}
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {logErr && <p role="alert" style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--status-gentle)' }}>{logErr}</p>}
            </section>
          )}

          {history.length > 0 && (
            <section>
              <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>
                {t('历史记录', 'History')}
              </h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {history.map((m) => (
                  <li key={`${m.name}-${m.startedAt}`} style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                      <strong>{m.name}</strong>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                        {m.stoppedAt
                          ? t(`停于 ${fmtDay(m.stoppedAt, dict)}`, `Stopped ${fmtDay(m.stoppedAt, dict)}`)
                          : t('在用', 'Active')}
                      </span>
                    </div>
                    <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                      {t('起始', 'Started')} {m.startedAt ? fmtDay(m.startedAt, dict) : '—'}
                      {[m.dose, m.freq].filter(Boolean).length ? ` · ${[m.dose, m.freq].filter(Boolean).join(' · ')}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <HealthRecordSheet
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        initialKind="med"
        onSaved={() => { setRecordOpen(false); rebuild(); }}
      />
    </div>
  );
}
