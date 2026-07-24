'use client';

/**
 * TrainingPlan — 训练计划 UI(批次 40)。用 lib/platform/training-protocol-engine 的结构。
 * 没选计划 → 列出计划库挑一个;选了 → 显示当前阶段的训练日 + 打卡 + 本周进度。
 * 纯执行,不做分析(体能状态/负荷是另一层)。
 */

import { useEffect, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import dynamic from 'next/dynamic';
import {
  PROTOCOL_LIBRARY, protocolById, exerciseById, protocolWeeks,
  loadTrainingState, startProtocol, logSession, sessionsThisWeek, saveTrainingState, toRunSteps,
  type TrainingState, type TrainingProtocol, type ExercisePrescription,
} from '@/lib/platform/training-protocol-engine';
import { earnPoints, POINTS_PER_FITNESS_SESSION } from '@/lib/platform/rewards-engine';
import { loadWorkouts, deleteWorkout, WORKOUTS_UPDATED, type Workout } from '@/lib/portal/workout-store';

const ExerciseLibrary = dynamic(() => import('../fitness/ExerciseLibrary'), { ssr: false });

function startWorkout(name: string, steps: Array<{ exerciseId: string; sets: number; reps: number; unit: 'reps' | 'sec'; restSec?: number }>, protocolId?: string, sessionId?: string) {
  window.dispatchEvent(new CustomEvent('nesio-start-workout', { detail: { name, steps, protocolId, sessionId } }));
}

const GOAL_LABEL: Record<TrainingProtocol['goal'], [string, string]> = {
  strength: ['力量', 'Strength'], hypertrophy: ['增肌', 'Hypertrophy'], endurance: ['耐力', 'Endurance'], general: ['综合', 'General'],
};

function currentPhase(p: TrainingProtocol, startedAt: string | null) {
  if (!startedAt) return p.phases[0];
  const weeksElapsed = Math.floor((Date.now() - Date.parse(startedAt)) / (7 * 86_400_000));
  let acc = 0;
  for (const ph of p.phases) { acc += ph.weeks; if (weeksElapsed < acc) return ph; }
  return p.phases[p.phases.length - 1];
}

function fmtItem(it: ExercisePrescription, dict: string): string {
  const ex = exerciseById(it.exerciseId);
  const name = ex ? L(dict, ex.name.zh, ex.name.en) : it.exerciseId;
  const dose = it.unit === 'min' ? `${it.reps} ${L(dict, '分钟', 'min')}` : `${it.sets}×${it.reps}`;
  return `${name} · ${dose}${it.intensity ? ` · ${it.intensity}` : ''}`;
}

export default function TrainingPlan() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [st, setSt] = useState<TrainingState | null>(null);
  const [earned, setEarned] = useState<number | null>(null);
  const [libOpen, setLibOpen] = useState(false);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  useEffect(() => {
    setSt(loadTrainingState());
    setWorkouts(loadWorkouts());
    const on = () => setWorkouts(loadWorkouts());
    window.addEventListener(WORKOUTS_UPDATED, on);
    return () => window.removeEventListener(WORKOUTS_UPDATED, on);
  }, []);
  if (!st) return null;

  const active = st.activeProtocolId ? protocolById(st.activeProtocolId) : undefined;

  // 动作库入口 + 我的自定义训练(两个分支都渲染)
  const fitnessTop = (
    <>
      <button type="button" className="nesio-routine-brief-preset" style={{ marginTop: '1rem' }} onClick={() => setLibOpen(true)}>
        {L(dict, '+ 动作库 · 自由组合训练(精选 18 + 全部 1324,带演示图)', '+ Exercise library · build your own (18 curated + 1324 all, with demos)')}
      </button>
      {workouts.length > 0 && (
        <>
          <p className="nesio-settings-section-label">{L(dict, '我的训练', 'My workouts')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {workouts.map((w) => (
              <div key={w.id} className="nesio-fin-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div style={{ minWidth: 0 }}>
                  <span className="nesio-fin-card-name">{w.name}</span>
                  <p className="nesio-fin-card-meta" style={{ marginTop: '0.15rem' }}>{L(dict, `${w.items.length} 个动作`, `${w.items.length} moves`)}</p>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                  <button type="button" className="nesio-fin-review-accept" onClick={() => startWorkout(w.name, w.items.map((it) => ({ ...it, restSec: 45 })))}>{L(dict, '开始跟练', 'Start')}</button>
                  <button type="button" className="nesio-routine-delete" aria-label={L(dict, '删除', 'Delete')} onClick={() => { deleteWorkout(w.id); setWorkouts(loadWorkouts()); }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <ExerciseLibrary open={libOpen} onClose={() => setLibOpen(false)} />
    </>
  );

  if (!active) {
    return (
      <div>
        {fitnessTop}
        <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>{L(dict, '训练计划', 'Training plan')}</p>
        <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '选一个计划开始;每次训练打个卡,记录你的执行。', 'Pick a plan to start; check in after each session.')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
          {PROTOCOL_LIBRARY.map((p) => (
            <button key={p.id} type="button" className="nesio-fin-card" style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--portal-line)', width: '100%' }} onClick={() => setSt(startProtocol(p.id))}>
              <span className="nesio-fin-card-name">{L(dict, p.name.zh, p.name.en)}</span>
              <p className="nesio-fin-card-meta" style={{ marginTop: '0.25rem' }}>{L(dict, GOAL_LABEL[p.goal][0], GOAL_LABEL[p.goal][1])} · {L(dict, `每周 ${p.sessionsPerWeek} 练`, `${p.sessionsPerWeek}×/wk`)} · {L(dict, `${protocolWeeks(p)} 周`, `${protocolWeeks(p)}wk`)}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const phase = currentPhase(active, st.startedAt);
  const doneThisWeek = sessionsThisWeek(st);
  const recentLog = st.log.slice(0, 3);
  const logDone = (sid: string, sname: string) => {
    setSt(logSession(active.id, sid));
    earnPoints(POINTS_PER_FITNESS_SESSION, 'fitness', dict === 'en' ? `Training: ${sname}` : `训练完成:${sname}`);
    setEarned(POINTS_PER_FITNESS_SESSION);
    setTimeout(() => setEarned(null), 2400);
  };
  const switchPlan = () => { const s = { ...st, activeProtocolId: null, startedAt: null }; saveTrainingState(s); setSt(s); };

  return (
    <div>
      {fitnessTop}
      <div className="nesio-fin-recur-hero" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
          <span className="nesio-fin-recur-hero-l">{L(dict, active.name.zh, active.name.en)}</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--portal-blue-deep)' }}>{L(dict, `本周 ${doneThisWeek}/${active.sessionsPerWeek} 次 · ${phase.name.zh}`, `${doneThisWeek}/${active.sessionsPerWeek} this week · ${phase.name.en}`)}</span>
        </div>
        <button type="button" onClick={switchPlan} style={{ flexShrink: 0, fontSize: '0.72rem', color: 'var(--portal-blue-deep)', background: 'none', border: '1px solid var(--portal-accent-border)', borderRadius: 999, padding: '0.25rem 0.6rem', cursor: 'pointer' }}>{L(dict, '换计划', 'Change')}</button>
      </div>

      {earned != null && (
        <div className="nesio-rewards-flash" style={{ marginTop: '0.6rem' }}>
          {L(dict, `训练打卡 +${earned} 积分 · 到冷冻仓兑换奖励`, `Session logged +${earned} pts · redeem in the vault`)}
        </div>
      )}

      <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>{L(dict, '本阶段的训练日', 'Sessions this phase')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {phase.sessions.map((s) => (
          <div key={s.id} className="nesio-fin-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
              <span className="nesio-fin-card-name">{L(dict, s.name.zh, s.name.en)}</span>
              <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                <button type="button" className="nesio-fin-review-accept" onClick={() => startWorkout(L(dict, s.name.zh, s.name.en), toRunSteps(s.items), active.id, s.id)}>{L(dict, '开始跟练', 'Start')}</button>
                <button type="button" className="nesio-routine-day-preset" onClick={() => logDone(s.id, L(dict, s.name.zh, s.name.en))}>{L(dict, '做过了', 'Done')}</button>
              </div>
            </div>
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontSize: '0.8rem', color: 'var(--portal-muted)', lineHeight: 1.7 }}>
              {s.items.map((it, i) => <li key={i}>{fmtItem(it, dict)}</li>)}
            </ul>
          </div>
        ))}
      </div>

      {recentLog.length > 0 && (
        <p className="nesio-settings-option-hint" style={{ marginTop: '0.7rem' }}>
          {L(dict, '最近打卡:', 'Recent: ')}{recentLog.map((e) => `${e.date.slice(5)} ${L(dict, active.phases.flatMap((p) => p.sessions).find((s) => s.id === e.sessionId)?.name.zh || e.sessionId, active.phases.flatMap((p) => p.sessions).find((s) => s.id === e.sessionId)?.name.en || e.sessionId)}`).join(' · ')}
        </p>
      )}
    </div>
  );
}
