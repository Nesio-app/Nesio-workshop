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
import { loadWorkouts, deleteWorkout, logWorkoutSession, loadWorkoutHistory, WORKOUTS_UPDATED, type Workout } from '@/lib/portal/workout-store';
import { workoutDisplayName, resolveExerciseName } from '@/lib/portal/workout-name';
import { loadExerciseCatalog } from '@/lib/portal/exercise-catalog';
import { loadLastWorkout, FOCUS_OPTIONS, type LastWorkoutRecord } from '@/lib/portal/workout-generate';

const ExerciseLibrary = dynamic(() => import('../fitness/ExerciseLibrary'), { ssr: false });
const WorkoutGenSheet = dynamic(() => import('../fitness/WorkoutGenSheet'), { ssr: false });

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
  const [genOpen, setGenOpen] = useState(false);
  const [lastRec, setLastRec] = useState<LastWorkoutRecord | null>(null);
  // 换计划二次确认(QA:一点就跳选择页,像把进度清了 —— 其实打卡记录都在,但得说清楚再动)
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [, setCatTick] = useState(0); // 扩展库动作名要等 catalog 载入内存才解析得出 → 载好后 bump 重渲染
  useEffect(() => {
    setSt(loadTrainingState());
    setWorkouts(loadWorkouts());
    setLastRec(loadLastWorkout());
    const on = () => { setWorkouts(loadWorkouts()); setLastRec(loadLastWorkout()); };
    window.addEventListener(WORKOUTS_UPDATED, on);
    return () => window.removeEventListener(WORKOUTS_UPDATED, on);
  }, []);
  // 「我的训练」若含扩展库动作(名字解析不出)→ 按需把 catalog 载进内存,让卡片/开练都显真名(含旧训练)。
  useEffect(() => {
    if (!workouts.some((w) => w.items.some((it) => !resolveExerciseName(it.exerciseId)))) return;
    let alive = true;
    loadExerciseCatalog().then(() => { if (alive) setCatTick((n) => n + 1); }).catch(() => {});
    return () => { alive = false; };
  }, [workouts]);
  if (!st) return null;
  const dictLocale: 'zh' | 'en' = dict === 'en' ? 'en' : 'zh';
  const nameOf = (w: Workout) => workoutDisplayName(w.items, w.name, dictLocale);

  const active = st.activeProtocolId ? protocolById(st.activeProtocolId) : undefined;

  // 回溯小签:上次练了什么 · 多久前(没历史不显示,不施压)
  const lastHint = (() => {
    if (!lastRec?.focus) return null;
    const label = FOCUS_OPTIONS.find(([k]) => k === lastRec.focus);
    if (!label) return null;
    const days = Math.max(0, Math.floor((Date.now() - Date.parse(`${lastRec.date}T00:00:00`)) / 86_400_000));
    const when = days === 0 ? L(dict, '今天', 'today') : days === 1 ? L(dict, '昨天', 'yesterday') : days === 2 ? L(dict, '前天', '2 days ago') : L(dict, `${days} 天前`, `${days} days ago`);
    return L(dict, `上次练了 ${label[1]} · ${when}`, `Last: ${label[2]} · ${when}`);
  })();

  // 动作库入口 + 我的自定义训练(两个分支都渲染)
  const fitnessTop = (
    <>
      {/* 「今天练什么」两问生成入口(借 workout.lol 之形;决策疲劳最小的路径排最前) */}
      <div className="nesio-fin-card" style={{ marginTop: '1rem' }}>
        <span className="nesio-fin-card-name">{L(dict, '今天练什么', 'What to train today')}</span>
        <p className="nesio-fin-card-meta" style={{ marginTop: '0.15rem' }}>
          {L(dict, '说说手边有什么器械、想练哪块,给你配一套,直接开练。', 'Tell it your equipment and focus — get a set, start right away.')}
        </p>
        {lastHint && (
          <span style={{ display: 'inline-block', fontSize: '0.68rem', color: 'var(--status-gentle)', background: 'var(--status-gentle-soft)', borderRadius: 999, padding: '0.15rem 0.55rem', marginTop: '0.4rem' }}>
            {lastHint}
          </span>
        )}
        <div style={{ display: 'flex', marginTop: '0.6rem' }}>
          <button type="button" className="nesio-fin-review-accept" style={{ flex: 1 }} onClick={() => setGenOpen(true)}>{L(dict, '配一套', 'Put a set together')}</button>
        </div>
      </div>
      <button type="button" className="nesio-routine-brief-preset" style={{ marginTop: '0.6rem' }} onClick={() => setLibOpen(true)}>
        {L(dict, '+ 动作库 · 自由组合训练(精选 18 + 全部 1324,带演示图)', '+ Exercise library · build your own (18 curated + 1324 all, with demos)')}
      </button>
      {workouts.length > 0 && (
        <>
          <p className="nesio-settings-section-label">{L(dict, '我的训练', 'My workouts')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {workouts.map((w) => (
              <div key={w.id} className="nesio-fin-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div style={{ minWidth: 0 }}>
                  <span className="nesio-fin-card-name">{nameOf(w)}</span>
                  <p className="nesio-fin-card-meta" style={{ marginTop: '0.15rem' }}>{L(dict, `${w.items.length} 个动作`, `${w.items.length} moves`)}</p>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                  <button type="button" className="nesio-fin-review-accept" onClick={() => startWorkout(nameOf(w), w.items.map((it) => ({ ...it, restSec: 45 })))}>{L(dict, '开始跟练', 'Start')}</button>
                  <button type="button" className="nesio-routine-delete" aria-label={L(dict, '删除', 'Delete')} onClick={() => { deleteWorkout(w.id); setWorkouts(loadWorkouts()); }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {/* 只在打开时挂载:避免动作库的挂载副作用(hook/懒加载)拖累健身 tab 首屏。 */}
      {libOpen && <ExerciseLibrary open onClose={() => setLibOpen(false)} />}
      {genOpen && <WorkoutGenSheet open onClose={() => { setGenOpen(false); setLastRec(loadLastWorkout()); }} />}
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
  // 「做过了」当天防重复(修「一天连点 N 次白赚积分、还把负荷统计灌假」)
  const todayKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const doneToday = new Set(st.log.filter((e) => e.date === todayKey).map((e) => e.sessionId));
  // 计划周期走完如实说(修「4 周计划第 8 周界面一模一样」)
  const weeksElapsed = st.startedAt ? Math.floor((Date.now() - Date.parse(st.startedAt)) / (7 * 86_400_000)) : 0;
  const planLapsed = weeksElapsed >= protocolWeeks(active);
  const recentDone = loadWorkoutHistory().slice(0, 3);
  const logDone = (sid: string, sname: string) => {
    if (doneToday.has(sid)) return;
    setSt(logSession(active.id, sid));
    logWorkoutSession(sname, protocolById(active.id)?.phases.flatMap((p) => p.sessions).find((s) => s.id === sid)?.items.length ?? 0);
    earnPoints(POINTS_PER_FITNESS_SESSION, 'fitness', dict === 'en' ? `Training: ${sname}` : `训练完成:${sname}`);
    setEarned(POINTS_PER_FITNESS_SESSION);
    setTimeout(() => setEarned(null), 2400);
  };
  const switchPlan = () => {
    if (!confirmSwitch) { setConfirmSwitch(true); setTimeout(() => setConfirmSwitch(false), 4000); return; }
    setConfirmSwitch(false);
    const s = { ...st, activeProtocolId: null, startedAt: null };
    saveTrainingState(s); setSt(s);
  };

  return (
    <div>
      {fitnessTop}
      <div className="nesio-fin-recur-hero" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
          <span className="nesio-fin-recur-hero-l">{L(dict, active.name.zh, active.name.en)}</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--portal-blue-deep)' }}>{L(dict, `本周 ${doneThisWeek}/${active.sessionsPerWeek} 次 · ${phase.name.zh}`, `${doneThisWeek}/${active.sessionsPerWeek} this week · ${phase.name.en}`)}</span>
        </div>
        <button type="button" onClick={switchPlan} style={{ flexShrink: 0, fontSize: '0.72rem', color: confirmSwitch ? 'var(--status-gentle)' : 'var(--portal-blue-deep)', background: 'none', border: `1px solid ${confirmSwitch ? 'var(--status-gentle)' : 'var(--portal-accent-border)'}`, borderRadius: 999, padding: '0.25rem 0.6rem', cursor: 'pointer' }}>{confirmSwitch ? L(dict, '再点一次确认(打卡记录会保留)', 'Tap again to confirm (log is kept)') : L(dict, '换计划', 'Change')}</button>
      </div>

      {planLapsed && (
        <p className="nesio-settings-option-hint" style={{ marginTop: '0.5rem', color: 'var(--status-gentle)' }}>
          {L(dict, `这个计划的 ${protocolWeeks(active)} 周周期走完了 —— 可以换个计划,或按当前阶段再走一轮。`, `The ${protocolWeeks(active)}-week cycle is complete — switch plans, or run this phase again.`)}
        </p>
      )}

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
                <button type="button" className="nesio-routine-day-preset" onClick={() => logDone(s.id, L(dict, s.name.zh, s.name.en))} disabled={doneToday.has(s.id)} style={doneToday.has(s.id) ? { opacity: 0.55 } : undefined}>{doneToday.has(s.id) ? L(dict, '今天已打卡', 'Logged today') : L(dict, '做过了', 'Done')}</button>
              </div>
            </div>
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontSize: '0.8rem', color: 'var(--portal-muted)', lineHeight: 1.7 }}>
              {s.items.map((it, i) => <li key={i}>{fmtItem(it, dict)}</li>)}
            </ul>
          </div>
        ))}
      </div>

      {recentDone.length > 0 && (
        <p className="nesio-settings-option-hint" style={{ marginTop: '0.7rem' }}>
          {/* 完成历史含全部来源(计划打卡/自定义/生成)—— 不再只认计划 */}
          {L(dict, '最近打卡:', 'Recent: ')}{recentDone.map((e) => `${e.date.slice(5)} ${e.name}`).join(' · ')}
        </p>
      )}
    </div>
  );
}
