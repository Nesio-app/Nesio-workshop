'use client';

/**
 * TrainingPlan — 健身页。2026-07-28 按用户给的参考稿(标注 PDF2 图2/图3/图4)整页重做。
 *
 * 参考稿的骨架:问候 → 今天的训练(大卡,一眼知道练什么/多久/多重,一个主按钮)→ 本周进度
 * → 一句今日建议 → 我的训练计划(横滑)→ 更多功能(四格)。旧版是「动作库按钮 + 我的训练列表
 * + 计划 hero + 本阶段训练日」平铺,今天该干什么埋在第四段里。
 *
 * 两处**故意没照抄**参考稿,理由写在这里免得以后又被加回去:
 *   · 「恢复度 92% · 状态极佳」—— 我们没有可信的恢复度数据源(没接 HRV / 睡眠评分)。
 *     宁可不显示也不编一个数,那一格改放本周进度环(真数据)。
 *   · 「AI 今日建议」—— 整条不要(用户 2026-07-28 明确说不需要)。参考稿那格的位置留给本周进度。
 *
 * 数值(约多少分钟 / 几个动作 / 强度 / 本周 N 次 / 今天练哪个)全部来自
 * fitness-home-core 的纯函数 —— 一条都不编。
 *
 * 2026-07-28 同批:训练日可改(标注 图8「训练计划目前是硬编码不可修改」)。
 * 种子计划仍只读,用户的改动落在 training-overrides 叠加层上,随时可「恢复默认」。
 */

import { useEffect, useMemo, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import dynamic from 'next/dynamic';
import {
  PROTOCOL_LIBRARY, protocolById, exerciseById, protocolWeeks,
  loadTrainingState, startProtocol, logSession, saveTrainingState, toRunSteps,
  type TrainingState, type TrainingProtocol, type ExercisePrescription,
} from '@/lib/platform/training-protocol-engine';
import {
  estimateSessionMinutes, sessionIntensity, weekDots, doneThisWeek,
  pickTodaySessionIndex, weekIndex, dayKey, pickPhaseIndex,
} from '@/lib/platform/fitness-home-core';
import { earnPoints, POINTS_PER_FITNESS_SESSION } from '@/lib/platform/rewards-engine';
import { loadWorkouts, deleteWorkout, WORKOUTS_UPDATED, type Workout } from '@/lib/portal/workout-store';
import { workoutDisplayName, resolveExerciseName } from '@/lib/portal/workout-name';
import { loadExerciseCatalog } from '@/lib/portal/exercise-catalog';
import {
  loadOverrides, mergeProtocol, hasOverrides, setSessionItems, hideSession, resetSession, resetProtocol,
  clampSets, clampReps, TRAINING_OVERRIDES_UPDATED,
  type TrainingOverrides, type OverrideItem, type MergeProtocol,
} from '@/lib/platform/training-overrides';
import { EXERCISES } from '@/lib/portal/exercise-library';
import { IconBox, IconHistory, IconTrendingUp, IconPlay, IconClock, IconActivity, IconTarget } from '../icons';

const ExerciseLibrary = dynamic(() => import('../fitness/ExerciseLibrary'), { ssr: false });

function startWorkout(name: string, steps: Array<{ exerciseId: string; sets: number; reps: number; unit: 'reps' | 'sec'; restSec?: number }>, protocolId?: string, sessionId?: string) {
  window.dispatchEvent(new CustomEvent('nesio-start-workout', { detail: { name, steps, protocolId, sessionId } }));
}

const GOAL_LABEL: Record<TrainingProtocol['goal'], [string, string]> = {
  strength: ['力量', 'Strength'], hypertrophy: ['增肌', 'Hypertrophy'], endurance: ['耐力', 'Endurance'], general: ['综合', 'General'],
};
const INTENSITY_LABEL = {
  light: ['轻', 'Light'], moderate: ['中等强度', 'Moderate'], hard: ['较重', 'Hard'],
} as const;
const DOW_ZH = ['一', '二', '三', '四', '五', '六', '日'];
const DOW_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// 阶段选法搬进 fitness-home-core 当唯一事实源了(今天页也要用同一个)。
function currentPhase(p: TrainingProtocol, startedAt: string | null) {
  return p.phases[pickPhaseIndex(p.phases, startedAt, new Date())];
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
  const [openWorkoutId, setOpenWorkoutId] = useState<string | null>(null); // 图8:点开看这套训练的动作
  const [showAllSessions, setShowAllSessions] = useState(false);
  // 图8:训练日可改 —— 用户的改动存叠加层,种子计划不动
  const [ov, setOv] = useState<TrainingOverrides>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState('');
  const [, setCatTick] = useState(0); // 扩展库动作名要等 catalog 载入内存才解析得出 → 载好后 bump 重渲染

  useEffect(() => {
    setSt(loadTrainingState());
    setWorkouts(loadWorkouts());
    const on = () => setWorkouts(loadWorkouts());
    window.addEventListener(WORKOUTS_UPDATED, on);
    setOv(loadOverrides());
    const onOv = () => setOv(loadOverrides());
    window.addEventListener(TRAINING_OVERRIDES_UPDATED, onOv);
    return () => {
      window.removeEventListener(WORKOUTS_UPDATED, on);
      window.removeEventListener(TRAINING_OVERRIDES_UPDATED, onOv);
    };
  }, []);
  // 「我的训练」若含扩展库动作(名字解析不出)→ 按需把 catalog 载进内存,让卡片/开练都显真名(含旧训练)。
  useEffect(() => {
    if (!workouts.some((w) => w.items.some((it) => !resolveExerciseName(it.exerciseId)))) return;
    let alive = true;
    loadExerciseCatalog().then(() => { if (alive) setCatTick((n) => n + 1); }).catch(() => {});
    return () => { alive = false; };
  }, [workouts]);

  const dictLocale: 'zh' | 'en' = dict === 'en' ? 'en' : 'zh';
  const nameOf = (w: Workout) => workoutDisplayName(w.items, w.name, dictLocale);
  const seed = st?.activeProtocolId ? protocolById(st.activeProtocolId) : undefined;
  // 显示用的计划 = 种子 + 用户改写。种子本身永远不被改脏(mergeProtocol 是纯函数)。
  const active = useMemo(
    () => (seed ? (mergeProtocol(seed as unknown as MergeProtocol, ov) as unknown as TrainingProtocol) : undefined),
    [seed, ov],
  );

  // ── 全部数字在这里算一次,别处只管显示 ──
  const derived = useMemo(() => {
    if (!st || !active) return null;
    const today = new Date();
    const phase = currentPhase(active, st.startedAt);
    const ids = phase.sessions.map((s) => s.id);
    const idx = pickTodaySessionIndex(ids, st.log, today, active.id);
    return {
      phase,
      todaySession: phase.sessions[idx] ?? phase.sessions[0],
      dots: weekDots(st.log, today, active.id),
      done: doneThisWeek(st.log, today, active.id),
      week: Math.min(weekIndex(st.startedAt, today), protocolWeeks(active)),
      totalWeeks: protocolWeeks(active),
      doneToday: st.log.some((e) => e.date.slice(0, 10) === dayKey(today)),
    };
  }, [st, active]);

  if (!st) return null;

  const logDone = (sid: string, sname: string) => {
    if (!active) return;
    setSt(logSession(active.id, sid));
    earnPoints(POINTS_PER_FITNESS_SESSION, 'fitness', dict === 'en' ? `Training: ${sname}` : `训练完成:${sname}`);
    setEarned(POINTS_PER_FITNESS_SESSION);
    setTimeout(() => setEarned(null), 2400);
  };
  const switchPlan = () => { const s = { ...st, activeProtocolId: null, startedAt: null }; saveTrainingState(s); setSt(s); };

  /** 所有改写都走这里:写不进本机存储就把话说明白,不假装成功。 */
  const commit = (ok: boolean) => {
    if (ok) { setSaveErr(''); setOv(loadOverrides()); }
    else setSaveErr(L(dict, '没改成 —— 本机存储写不进(隐私模式或空间满了)。', 'Could not save — local storage is unavailable.'));
  };

  // ── 更多(参考稿底部四格)—— 只放真有的入口,不摆没实现的功能 ──
  const moreGrid = (
    <>
      <p className="nesio-fit-sec">{L(dict, '更多', 'More')}</p>
      <div className="nesio-fit-more">
        <button type="button" className="nesio-fit-more-cell" onClick={() => setLibOpen(true)}>
          <IconBox size={18} />
          <span className="t">{L(dict, '动作库', 'Exercises')}</span>
          <span className="s">{L(dict, '自由组合一套', 'Build your own')}</span>
        </button>
        <button type="button" className="nesio-fit-more-cell" onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-insights', { detail: { tab: 'health' } }))}>
          <IconTrendingUp size={18} />
          <span className="t">{L(dict, '身体数据', 'Body data')}</span>
          <span className="s">{L(dict, '看趋势', 'Trends')}</span>
        </button>
        <button type="button" className="nesio-fit-more-cell" onClick={() => window.dispatchEvent(new CustomEvent('nesio-memory-search', { detail: { query: L(dict, '训练', 'training') } }))}>
          <IconHistory size={18} />
          <span className="t">{L(dict, '练过的', 'History')}</span>
          <span className="s">{L(dict, '在记忆里', 'In memories')}</span>
        </button>
        <button type="button" className="nesio-fit-more-cell" onClick={switchPlan} disabled={!active}>
          <IconTarget size={18} />
          <span className="t">{L(dict, '换个计划', 'Switch plan')}</span>
          <span className="s">{active ? L(dict, active.name.zh, active.name.en) : L(dict, '还没选', 'None yet')}</span>
        </button>
      </div>
      {libOpen && <ExerciseLibrary open onClose={() => setLibOpen(false)} />}
    </>
  );

  // ── 我存的训练(动作库自由组合存下来的)—— 图8:点开看细节,删除收进展开区 ──
  const myWorkouts = workouts.length > 0 ? (
    <>
      <p className="nesio-fit-sec">{L(dict, '我存的训练', 'My workouts')}</p>
      <div className="nesio-fit-list">
        {workouts.map((w) => {
          const open = openWorkoutId === w.id;
          return (
            <div key={w.id} className="nesio-fit-row">
              <div className="nesio-fit-row-head">
                <button type="button" className="nesio-fit-row-main" aria-expanded={open} onClick={() => setOpenWorkoutId(open ? null : w.id)}>
                  <span className="n">{nameOf(w)}</span>
                  <span className="m">{L(dict, `${w.items.length} 个动作`, `${w.items.length} moves`)} · {open ? L(dict, '收起', 'hide') : L(dict, '看细节', 'details')}</span>
                </button>
                <button type="button" className="nesio-fit-go" onClick={() => startWorkout(nameOf(w), w.items.map((it) => ({ ...it, restSec: 45 })))}>{L(dict, '开始', 'Start')}</button>
              </div>
              {open && (
                <>
                  <ul className="nesio-fit-items">
                    {w.items.map((it, i) => (
                      <li key={i}>{resolveExerciseName(it.exerciseId) || it.exerciseId} · {it.sets}×{it.reps}{it.unit === 'sec' ? L(dict, ' 秒', 's') : ''}</li>
                    ))}
                  </ul>
                  <button type="button" className="nesio-fit-del" onClick={() => { deleteWorkout(w.id); setOpenWorkoutId(null); setWorkouts(loadWorkouts()); }}>
                    {L(dict, '删掉这套训练', 'Delete this workout')}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  ) : null;

  // ── 还没选计划:先挑一个 ──
  if (!active || !derived) {
    return (
      <div className="nesio-fit">
        <p className="nesio-fit-hello">{L(dict, '先挑一个计划,今天就能开始。', 'Pick a plan — you can start today.')}</p>
        <p className="nesio-fit-sec">{L(dict, '训练计划', 'Training plans')}</p>
        <div className="nesio-fit-list">
          {PROTOCOL_LIBRARY.map((p) => (
            <button key={p.id} type="button" className="nesio-fit-plan-pick" onClick={() => setSt(startProtocol(p.id))}>
              <span className="n">{L(dict, p.name.zh, p.name.en)}</span>
              <span className="m">
                {L(dict, GOAL_LABEL[p.goal][0], GOAL_LABEL[p.goal][1])} · {L(dict, `每周 ${p.sessionsPerWeek} 练`, `${p.sessionsPerWeek}×/wk`)} · {L(dict, `${protocolWeeks(p)} 周`, `${protocolWeeks(p)}wk`)}
              </span>
            </button>
          ))}
        </div>
        {myWorkouts}
        {moreGrid}
      </div>
    );
  }

  const { phase, todaySession, dots, done, week, totalWeeks, doneToday } = derived;
  const mins = estimateSessionMinutes(todaySession.items);
  const intensity = sessionIntensity(todaySession.items);
  const pct = Math.min(100, Math.round((done / active.sessionsPerWeek) * 100));
  const todayName = L(dict, todaySession.name.zh, todaySession.name.en);

  return (
    <div className="nesio-fit">
      {/* ① 问候(参考稿顶部)—— 只说真的:今天练没练 */}
      <p className="nesio-fit-hello">
        {doneToday ? L(dict, '今天练过了。', 'You trained today.') : L(dict, '今天是训练的好日子。', 'Good day to train.')}
      </p>

      {/* ② 今天的训练:练什么 / 多久 / 多重,一个主按钮 */}
      <section className="nesio-fit-today">
        <div className="nesio-fit-today-top">
          <span className="nesio-fit-tag">{L(dict, GOAL_LABEL[active.goal][0], GOAL_LABEL[active.goal][1])}</span>
          <button type="button" className="nesio-fit-adjust" onClick={switchPlan}>{L(dict, '调整计划', 'Adjust')}</button>
        </div>
        <h3 className="nesio-fit-today-name">{todayName}</h3>
        <div className="nesio-fit-facts">
          <span><IconClock size={14} />{L(dict, `约 ${mins} 分钟`, `~${mins} min`)}</span>
          <span><IconBox size={14} />{L(dict, `${todaySession.items.length} 个动作`, `${todaySession.items.length} moves`)}</span>
          <span><IconActivity size={14} />{L(dict, INTENSITY_LABEL[intensity][0], INTENSITY_LABEL[intensity][1])}</span>
        </div>
        <ul className="nesio-fit-items">
          {todaySession.items.slice(0, 3).map((it, i) => <li key={i}>{fmtItem(it, dict)}</li>)}
          {todaySession.items.length > 3 && <li className="more">{L(dict, `还有 ${todaySession.items.length - 3} 个`, `+${todaySession.items.length - 3} more`)}</li>}
        </ul>
        <div className="nesio-fit-today-acts">
          <button type="button" className="nesio-fit-start" onClick={() => startWorkout(todayName, toRunSteps(todaySession.items), active.id, todaySession.id)}>
            <IconPlay size={16} />{L(dict, '开始跟练', 'Start')}
          </button>
          <button type="button" className="nesio-fit-ghost" onClick={() => logDone(todaySession.id, todayName)}>{L(dict, '做过了', 'Done')}</button>
        </div>
      </section>

      {earned != null && <div className="nesio-rewards-flash">{L(dict, `训练打卡 +${earned} 积分`, `Session logged +${earned} pts`)}</div>}

      {/* ③ 本周进度:环 + 七天点。参考稿那格是「恢复度 92%」—— 没有可信数据源,换成这个真数据 */}
      <section className="nesio-fit-week">
        <div className="nesio-fit-ring" style={{ ['--pct' as string]: `${pct}%` }} role="img"
          aria-label={L(dict, `本周 ${done} / ${active.sessionsPerWeek} 次`, `${done} of ${active.sessionsPerWeek} this week`)}>
          <span className="v">{done}<i>/{active.sessionsPerWeek}</i></span>
        </div>
        <div className="nesio-fit-week-body">
          <div className="nesio-fit-week-head">
            <span className="l">{L(dict, '本周', 'This week')}</span>
            <span className="r">{L(dict, `${phase.name.zh} · 第 ${week} / ${totalWeeks} 周`, `${phase.name.en} · week ${week} of ${totalWeeks}`)}</span>
          </div>
          <div className="nesio-fit-dots">
            {dots.map((d, i) => (
              <span key={d.key} className={`nesio-fit-dot${d.done ? ' is-done' : ''}${d.isToday ? ' is-today' : ''}`}>
                <i>{dict === 'en' ? DOW_EN[i] : DOW_ZH[i]}</i>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ④ 这个阶段的训练日:默认横滑一排,「看全部」摊成列表 */}
      <div className="nesio-fit-sec-row">
        <p className="nesio-fit-sec">{L(dict, '这个阶段的训练日', 'Sessions this phase')}</p>
        <button type="button" className="nesio-fit-more-link" onClick={() => setShowAllSessions((v) => !v)}>
          {showAllSessions ? L(dict, '收起', 'Less') : L(dict, '看全部 ›', 'See all ›')}
        </button>
      </div>
      <div className={showAllSessions ? 'nesio-fit-list' : 'nesio-fit-rail'}>
        {phase.sessions.map((s) => {
          const m = estimateSessionMinutes(s.items);
          const isToday = s.id === todaySession.id;
          const nm = L(dict, s.name.zh, s.name.en);
          return (
            <div key={s.id} className={`nesio-fit-card${isToday ? ' is-today' : ''}`}>
              <div className="nesio-fit-card-head">
                <span className="n">{nm}</span>
                {isToday && <span className="nesio-fit-tag">{L(dict, '今天', 'Today')}</span>}
              </div>
              <span className="m">{L(dict, `约 ${m} 分钟 · ${s.items.length} 个动作`, `~${m} min · ${s.items.length} moves`)}</span>
              <ul className="nesio-fit-items">
                {s.items.slice(0, 3).map((it, i) => <li key={i}>{fmtItem(it, dict)}</li>)}
              </ul>
              <div className="nesio-fit-card-acts">
                <button type="button" className="nesio-fit-go" onClick={() => startWorkout(nm, toRunSteps(s.items), active.id, s.id)}>{L(dict, '开始', 'Start')}</button>
                <button type="button" className="nesio-fit-ghost sm" onClick={() => logDone(s.id, nm)}>{L(dict, '做过了', 'Done')}</button>
                {/* 图8「训练计划目前是硬编码不可修改」:每个训练日都能改 */}
                <button type="button" className="nesio-fit-ghost sm" onClick={() => setEditId(editId === s.id ? null : s.id)}>
                  {editId === s.id ? L(dict, '收起', 'Close') : L(dict, '改', 'Edit')}
                </button>
              </div>
              {editId === s.id && (
                <SessionEditor
                  protocolId={active.id}
                  sessionId={s.id}
                  items={s.items as OverrideItem[]}
                  edited={!!ov[`${active.id}:${s.id}`]}
                  dict={dict}
                  onCommit={commit}
                  onClose={() => setEditId(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {saveErr && <p className="nesio-fit-err" role="alert">{saveErr}</p>}
      {hasOverrides(active.id, ov) && (
        <button type="button" className="nesio-fit-reset" onClick={() => {
          if (!confirm(L(dict, '把这个计划恢复成默认?你改过的组数/动作都会还原。', 'Reset this plan to default? Your edits will be undone.'))) return;
          commit(resetProtocol(active.id));
        }}>{L(dict, '恢复计划默认', 'Reset plan to default')}</button>
      )}

      {myWorkouts}
      {moreGrid}
    </div>
  );
}

/**
 * SessionEditor — 改一个训练日(2026-07-28,标注 图8)。
 * 能做:每个动作 ± 组数 / ± 次数、删动作、从内置动作库加一个、删掉整个训练日、恢复这天的默认。
 * 每次改动立刻落盘(叠加层),失败通过 onCommit(false) 往上冒 —— 不静默吞。
 */
function SessionEditor({ protocolId, sessionId, items, edited, dict, onCommit, onClose }: {
  protocolId: string; sessionId: string; items: OverrideItem[]; edited: boolean;
  dict: string; onCommit: (ok: boolean) => void; onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const write = (next: OverrideItem[]) => onCommit(setSessionItems(protocolId, sessionId, next));

  const bump = (i: number, field: 'sets' | 'reps', delta: number) => {
    const next = items.map((it, k) => {
      if (k !== i) return it;
      return field === 'sets'
        ? { ...it, sets: clampSets(it.sets + delta) }
        : { ...it, reps: clampReps(it.reps + delta, it.unit) };
    });
    write(next);
  };

  return (
    <div className="nesio-fit-edit">
      {items.map((it, i) => {
        const ex = exerciseById(it.exerciseId);
        const name = ex ? L(dict, ex.name.zh, ex.name.en) : it.exerciseId;
        return (
          <div key={`${it.exerciseId}-${i}`} className="nesio-fit-edit-row">
            <span className="n">{name}</span>
            <div className="stp">
              <button type="button" onClick={() => bump(i, 'sets', -1)} aria-label={L(dict, '少一组', 'One less set')}>−</button>
              <span>{it.sets}{L(dict, ' 组', ' sets')}</span>
              <button type="button" onClick={() => bump(i, 'sets', 1)} aria-label={L(dict, '多一组', 'One more set')}>+</button>
            </div>
            <div className="stp">
              <button type="button" onClick={() => bump(i, 'reps', -1)} aria-label={L(dict, '减', 'Less')}>−</button>
              <span>{it.reps}{it.unit === 'min' ? L(dict, ' 分钟', 'min') : L(dict, ' 次', '')}</span>
              <button type="button" onClick={() => bump(i, 'reps', 1)} aria-label={L(dict, '加', 'More')}>+</button>
            </div>
            <button type="button" className="del" onClick={() => write(items.filter((_, k) => k !== i))}
              aria-label={L(dict, '删掉这个动作', 'Remove exercise')}>✕</button>
          </div>
        );
      })}

      {adding ? (
        <div className="nesio-fit-edit-pick">
          {EXERCISES.filter((e) => !items.some((it) => it.exerciseId === e.id)).slice(0, 24).map((e) => (
            <button key={e.id} type="button" onClick={() => { write([...items, { exerciseId: e.id, sets: 3, reps: 10 }]); setAdding(false); }}>
              {e.name}
            </button>
          ))}
          <button type="button" className="cancel" onClick={() => setAdding(false)}>{L(dict, '取消', 'Cancel')}</button>
        </div>
      ) : (
        <button type="button" className="nesio-fit-edit-add" onClick={() => setAdding(true)}>{L(dict, '+ 加个动作', '+ Add exercise')}</button>
      )}

      <div className="nesio-fit-edit-foot">
        {edited && (
          <button type="button" onClick={() => { onCommit(resetSession(protocolId, sessionId)); onClose(); }}>
            {L(dict, '恢复这天的默认', 'Reset this day')}
          </button>
        )}
        <button type="button" className="danger" onClick={() => {
          if (!confirm(L(dict, '把这个训练日从计划里去掉?', 'Remove this session from the plan?'))) return;
          onCommit(hideSession(protocolId, sessionId));
          onClose();
        }}>{L(dict, '不练这天', 'Drop this day')}</button>
      </div>
    </div>
  );
}
