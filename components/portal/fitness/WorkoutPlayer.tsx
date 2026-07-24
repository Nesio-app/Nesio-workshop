'use client';

/**
 * WorkoutPlayer — 跟练播放器(批次 46,Slice 2)。
 * 逐个动作带你练:动作名 + 要点(cues)+ 神经提示(neural)+ 组数/次数 +
 * 组间休息倒计时 + 秒数动作计时;全部完成 → 打卡(记训练 + 赚积分)。
 * 全局挂在 Portal,任意入口 dispatch `nesio-start-workout`(detail=session)启动。
 */

import { useEffect, useRef, useState } from 'react';
import { exerciseById, exerciseAnimFrames, MUSCLE_LABEL } from '@/lib/portal/exercise-library';
import { catalogExerciseByIdSync, loadExerciseCatalog, catalogGifSrc } from '@/lib/portal/exercise-catalog';
import ExerciseFigure from './ExerciseFigure';
import ExerciseGif from './ExerciseGif';
import { skillById } from '@/lib/life-domain/assets/skill-inventory';
import { logSession } from '@/lib/platform/training-protocol-engine';
import { earnPoints, POINTS_PER_FITNESS_SESSION } from '@/lib/platform/rewards-engine';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { useSheetDismiss } from '@/lib/portal/use-sheet-dismiss';

export interface PlayerStep {
  exerciseId: string;
  sets: number;
  reps: number;
  unit: 'reps' | 'sec';
  restSec?: number;
}
export interface PlayerSession {
  name: string;
  steps: PlayerStep[];
  protocolId?: string;
  sessionId?: string;
}

function resolve(id: string, dict: string): { name: string; muscles?: Array<{ n: string; t: 'p' | 's' }>; cues?: string[]; neural?: string[]; animFrames?: string[]; animFps?: number; animPingpong?: boolean; gif?: string } {
  const ex = exerciseById(id);
  if (ex) {
    const animFrames = exerciseAnimFrames(ex);
    return { name: ex.name, muscles: ex.muscles, cues: ex.cues, neural: ex.neural, animFrames, animFps: ex.anim?.fps, animPingpong: ex.anim?.pingpong };
  }
  const cat = catalogExerciseByIdSync(id);
  if (cat) return { name: cat.nameZh || cat.name, muscles: cat.target ? [{ n: cat.target, t: 'p' }] : undefined, cues: cat.cues, gif: cat.media ? catalogGifSrc(cat.media) : undefined };
  const sk = skillById(id);
  if (sk) return { name: dict === 'en' ? sk.name.en : sk.name.zh };
  return { name: id };
}

export default function WorkoutPlayer({ session, onClose }: { session: PlayerSession; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [idx, setIdx] = useState(0);
  const [setNum, setSetNum] = useState(1);
  const [phase, setPhase] = useState<'work' | 'rest' | 'done'>('work');
  const [countdown, setCountdown] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useSheetDismiss(true, onClose); // 挂载即打开;Escape 关闭 + 焦点回收

  // 训练里若含扩展库动作(不在精选 18 里),按需把 catalog 载进内存,让名字/要点解析出来。
  // 否则从「保存的训练」直接开练、本会话没开过「全部 1324」时,只会显示原始编号(如 0001)。
  const [, setCatTick] = useState(0);
  useEffect(() => {
    if (!session.steps.some((s) => !exerciseById(s.exerciseId) && !catalogExerciseByIdSync(s.exerciseId))) return;
    let alive = true;
    loadExerciseCatalog().then(() => { if (alive) setCatTick((n) => n + 1); }).catch(() => {});
    return () => { alive = false; };
  }, [session]);

  const steps = session.steps;
  const step = steps[idx];
  const ex = step ? resolve(step.exerciseId, dict) : null;

  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  useEffect(() => () => clearTimer(), []);

  // 倒计时通用:到 0 时调用 onEnd
  function runCountdown(sec: number, onEnd: () => void) {
    clearTimer();
    setCountdown(sec);
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c == null) return c;
        if (c <= 1) { clearTimer(); onEnd(); return null; }
        return c - 1;
      });
    }, 1000);
  }

  function nextAfterSet() {
    if (!step) return;
    if (setNum < step.sets) {
      // 组间休息
      setSetNum((n) => n + 1);
      setPhase('rest');
      runCountdown(step.restSec ?? 60, () => setPhase('work'));
    } else if (idx < steps.length - 1) {
      setIdx((i) => i + 1);
      setSetNum(1);
      setPhase('work');
    } else {
      setPhase('done');
    }
  }

  function completeSet() {
    clearTimer();
    setCountdown(null);
    nextAfterSet();
  }

  function skipRest() { clearTimer(); setCountdown(null); setPhase('work'); }

  function finish() {
    if (session.protocolId && session.sessionId) logSession(session.protocolId, session.sessionId);
    earnPoints(POINTS_PER_FITNESS_SESSION, 'fitness', dict === 'en' ? `Workout: ${session.name}` : `跟练完成:${session.name}`);
    onClose();
  }

  if (phase === 'done') {
    return (
      <div className="nesio-wp-overlay">
        <div className="nesio-wp-done">
          <p className="nesio-wp-done-title">{L(dict, '练完了 💪', 'Workout done 💪')}</p>
          <p className="nesio-wp-done-sub">{L(dict, `${steps.length} 个动作 · 打卡 +${POINTS_PER_FITNESS_SESSION} 积分`, `${steps.length} exercises · +${POINTS_PER_FITNESS_SESSION} pts`)}</p>
          <button type="button" className="nesio-wp-primary" onClick={finish}>{L(dict, '完成打卡', 'Log it')}</button>
        </div>
      </div>
    );
  }

  if (!step || !ex) return null;

  return (
    <div className="nesio-wp-overlay" role="dialog" aria-modal aria-label={session.name || L(dict, '跟练', 'Workout')}>
      <div className="nesio-wp-top">
        <span className="nesio-wp-progress">{L(dict, `动作 ${idx + 1}/${steps.length}`, `${idx + 1}/${steps.length}`)}</span>
        <span className="nesio-wp-session">{session.name}</span>
        <button type="button" className="nesio-wp-close" onClick={onClose} aria-label={L(dict, '退出', 'Exit')}>✕</button>
      </div>

      <div className="nesio-wp-body">
        {phase !== 'rest' && ex.animFrames && ex.animFrames.length > 0 && (
          <ExerciseFigure
            frames={ex.animFrames}
            fps={ex.animFps}
            pingpong={ex.animPingpong}
            alt={ex.name}
            className="nesio-wp-figure"
          />
        )}
        {phase !== 'rest' && !ex.animFrames?.length && ex.gif && (
          <ExerciseGif src={ex.gif} alt={ex.name} className="nesio-wp-figure" />
        )}
        <h2 className="nesio-wp-name">{ex.name}</h2>
        {ex.muscles && (
          <div className="nesio-wp-muscles">
            {ex.muscles.map((m, i) => <span key={i} className={`nesio-wp-muscle${m.t === 'p' ? ' is-p' : ''}`}>{m.n}</span>)}
          </div>
        )}

        <div className="nesio-wp-setline">
          {L(dict, `第 ${setNum} / ${step.sets} 组`, `Set ${setNum} / ${step.sets}`)}
          <span className="nesio-wp-target">{step.unit === 'sec' ? L(dict, `${step.reps} 秒`, `${step.reps}s`) : L(dict, `${step.reps} 次`, `×${step.reps}`)}</span>
        </div>

        {phase === 'rest' ? (
          <div className="nesio-wp-rest">
            <p className="nesio-wp-rest-label">{L(dict, '组间休息', 'Rest')}</p>
            <p className="nesio-wp-count">{countdown ?? 0}s</p>
            <button type="button" className="nesio-wp-ghost" onClick={skipRest}>{L(dict, '跳过休息', 'Skip rest')}</button>
          </div>
        ) : (
          <>
            {ex.neural && ex.neural[0] && (
              <div className="nesio-wp-neural">{ex.neural[0]}</div>
            )}
            {ex.cues && ex.cues.length > 0 && (
              <ul className="nesio-wp-cues">
                {ex.cues.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            )}
            {step.unit === 'sec' && countdown != null ? (
              <div className="nesio-wp-count nesio-wp-count--work">{countdown}s</div>
            ) : null}
          </>
        )}
      </div>

      {phase === 'work' && (
        <div className="nesio-wp-actions">
          {step.unit === 'sec' && countdown == null && (
            <button type="button" className="nesio-wp-ghost" onClick={() => runCountdown(step.reps, () => { /* 计时到,等用户点完成 */ })}>
              {L(dict, `计时 ${step.reps}s`, `Time ${step.reps}s`)}
            </button>
          )}
          <button type="button" className="nesio-wp-primary" onClick={completeSet}>
            {setNum < step.sets ? L(dict, '完成这组', 'Set done') : idx < steps.length - 1 ? L(dict, '完成,下一个', 'Done, next') : L(dict, '完成最后一组', 'Finish')}
          </button>
          {idx < steps.length - 1 && (
            <button type="button" className="nesio-wp-ghost" onClick={() => { clearTimer(); setCountdown(null); setIdx((i) => i + 1); setSetNum(1); setPhase('work'); }}>
              {L(dict, '跳过动作', 'Skip')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
