'use client';

/**
 * RoutineDueCards — 到点的例行提醒在 Today 出卡(批次 19)。
 * 每分钟检查一次;完成/今天跳过后当天不再出现,次日自动复活。
 */

import { useEffect, useState } from 'react';
import { dueRoutines, markRoutineDone, ROUTINES_UPDATED_EVENT, type Routine } from '@/lib/portal/routines';
import { IconClock } from '../icons';
import { track } from '@/lib/portal/telemetry';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

export function RoutineDueCards() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [due, setDue] = useState<Routine[]>([]);

  useEffect(() => {
    const read = () => setDue(dueRoutines());
    read();
    const timer = setInterval(read, 60_000);
    window.addEventListener(ROUTINES_UPDATED_EVENT, read);
    return () => { clearInterval(timer); window.removeEventListener(ROUTINES_UPDATED_EVENT, read); };
  }, []);

  if (due.length === 0) return null;

  return (
    <>
      {due.map((r) => (
        <div key={r.id} className="nesio-proactive-card">
          <div className="nesio-proactive-card-inner">
            <span className="nesio-proactive-card-icon"><IconClock size={18} /></span>
            <div className="nesio-proactive-card-text">
              <p className="nesio-proactive-card-title">{r.text}</p>
              <p className="nesio-proactive-card-body">{L(dict, `例行提醒 · ${r.time}`, `Routine · ${r.time}`)}</p>
              <div className="nesio-proactive-card-actions">
                <button
                  type="button"
                  className="nesio-proactive-action-btn"
                  onClick={() => { markRoutineDone(r.id); track('routine_done', {}); }}
                >
                  {L(dict, '完成', 'Done')}
                </button>
                <button
                  type="button"
                  className="nesio-proactive-action-btn nesio-proactive-action-btn--snooze"
                  onClick={() => { markRoutineDone(r.id); track('routine_skip', {}); }}
                >
                  {L(dict, '今天跳过', 'Skip today')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
