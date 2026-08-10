'use client';

/**
 * ExperimentCheckinCard — 进行中实验的 Today 打卡卡(批次 5:入口浅化)。
 * 此前打卡藏在 洞察→分析→我的实验 三层深处;现在有进行中且今天未记录的
 * 实验时,打卡直接出现在 Today 首屏,点开即快选记录(步进/点按,无手动打字)。
 * 图15:壳统一 nesio-proactive-card + Button size=sm。
 */

import { useEffect, useState } from 'react';
import {
  LogPanel,
  loadExperiments,
  saveExperiments,
  type Experiment,
} from '../NesioExperiment';
import { IconTarget } from '../icons';
import { track } from '@/lib/portal/telemetry';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { localDayKey } from '@/lib/portal/local-day';
import Button from '../ui/Button';

export function ExperimentCheckinCard() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [exp, setExp] = useState<Experiment | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [justLogged, setJustLogged] = useState(false);

  useEffect(() => {
    const read = () => {
      const today = localDayKey();
      const active = loadExperiments().find(
        (e) => !e.concluded && !e.dataPoints.some((p) => p.date === today),
      );
      setExp(active ?? null);
    };
    read();
    window.addEventListener('nesio-experiments-updated', read);
    return () => window.removeEventListener('nesio-experiments-updated', read);
  }, []);

  if (!exp && !justLogged) return null;

  if (justLogged) {
    return (
      <div className="nesio-proactive-card">
        <div className="nesio-proactive-card-inner">
          <span className="nesio-proactive-card-icon"><IconTarget size={18} /></span>
          <div className="nesio-proactive-card-text">
            <p className="nesio-proactive-card-title">{L(dict, '今天已打卡', 'Checked in for today')}</p>
            <p className="nesio-proactive-card-body">{L(dict, '数据已记入实验,坚持就会看到规律。', 'Logged. Keep going and the pattern will show.')}</p>
          </div>
        </div>
      </div>
    );
  }

  function handleLog(iv: number, dv: number, note: string) {
    if (!exp) return;
    const all = loadExperiments();
    const target = all.find((e) => e.id === exp.id);
    if (!target) return;
    target.dataPoints.push({ date: localDayKey(), iv, dv, ...(note ? { note } : {}) });
    saveExperiments(all);
    track('experiment_checkin', { from: 'today_card' });
    window.dispatchEvent(new CustomEvent('nesio-experiments-updated'));
    setJustLogged(true);
    setTimeout(() => setJustLogged(false), 4000);
  }

  return (
    <div className="nesio-proactive-card">
      <div className="nesio-proactive-card-inner">
        <span className="nesio-proactive-card-icon"><IconTarget size={18} /></span>
        <div className="nesio-proactive-card-text">
          <p className="nesio-proactive-card-title">{L(dict, '实验打卡', 'Experiment check-in')} · {exp!.name}</p>
          {!expanded && (
            <>
              <p className="nesio-proactive-card-body">
                {L(dict, `第 ${exp!.dataPoints.length + 1} / ${exp!.targetDays} 天,今天还没记录。`, `Day ${exp!.dataPoints.length + 1} / ${exp!.targetDays} — not logged yet today.`)}
              </p>
              <div className="nesio-proactive-card-actions">
                <Button size="sm" variant="secondary" onClick={() => setExpanded(true)}>
                  {L(dict, '30 秒打卡', '30-second check-in')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
      {/* 批次 8:日志面板占满整卡宽,不再挤在图标右侧的窄栏里 */}
      {expanded && (
        <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
          <LogPanel exp={exp!} onLog={handleLog} />
        </div>
      )}
    </div>
  );
}
