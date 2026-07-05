'use client';

/**
 * ExerciseLibrary — 动作库(批次 46,Slice 3)。Keep 风:三维筛选 + 自由组合。
 * 筛选:肌群 / 器械 / 动作模式;卡片展开看要点+神经提示;「加入」攒成草稿,
 * 「开始跟练」直接练 或「存为训练」存到健康页。移植 fitness/web 的 17 动作。
 */

import { useState } from 'react';
import {
  EXERCISES, filterExercises, MUSCLE_LABEL, EQUIP_LABEL, MOVE_LABEL, DIFF_LABEL,
  type Exercise, type MuscleTag, type Equip, type MoveTag,
} from '@/lib/portal/exercise-library';
import { saveWorkout, type WorkoutItem } from '@/lib/portal/workout-store';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import type { PlayerStep } from './WorkoutPlayer';

const HOLD_IDS = new Set(['side-plank', 'deadbug', 'prone-swimmer', 'cat-cow', '9090']);
function defaultItem(ex: Exercise): WorkoutItem {
  return HOLD_IDS.has(ex.id) ? { exerciseId: ex.id, sets: 3, reps: 30, unit: 'sec' } : { exerciseId: ex.id, sets: 3, reps: 10, unit: 'reps' };
}

const MUSCLES: MuscleTag[] = ['glute', 'hip', 'core', 'back', 'chest', 'shoulder'];
const EQUIPS: Equip[] = ['bodyweight', 'dumbbell', 'bench', 'wall'];
const MOVES: MoveTag[] = ['squat', 'hinge', 'push', 'pull', 'core_s', 'mobility'];

export default function ExerciseLibrary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [muscle, setMuscle] = useState<MuscleTag | 'all'>('all');
  const [equip, setEquip] = useState<Equip | 'all'>('all');
  const [move, setMove] = useState<MoveTag | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkoutItem[]>([]);
  const [flash, setFlash] = useState('');

  if (!open) return null;

  const list = filterExercises({ muscle, equip, move });
  const inDraft = (id: string) => draft.some((d) => d.exerciseId === id);

  const toggleDraft = (ex: Exercise) => {
    setDraft((prev) => prev.some((d) => d.exerciseId === ex.id) ? prev.filter((d) => d.exerciseId !== ex.id) : [...prev, defaultItem(ex)]);
  };

  const startPlay = () => {
    if (!draft.length) return;
    const steps: PlayerStep[] = draft.map((d) => ({ ...d, restSec: 45 }));
    window.dispatchEvent(new CustomEvent('nesio-start-workout', { detail: { name: L(dict, '自由组合', 'Custom set'), steps } }));
  };

  const save = () => {
    if (!draft.length) return;
    saveWorkout({ name: `${L(dict, '自定义', 'Custom')} · ${draft.length}${L(dict, ' 动作', '')}`, items: draft });
    setFlash(L(dict, '已存到健康页', 'Saved to Health'));
    setDraft([]);
    setTimeout(() => setFlash(''), 1800);
  };

  const chip = <T extends string>(active: boolean, label: string, onClick: () => void, key: string) => (
    <button key={key} type="button" className={`nesio-xlib-chip${active ? ' is-active' : ''}`} onClick={onClick}>{label}</button>
  );

  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '动作库', 'Exercise library')}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{L(dict, '动作库', 'Exercise library')}</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        </div>
        <div className="nesio-settings-sheet-body">
          <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '三维筛选 · 点动作看要点 · 加入自由组合', 'Filter by 3 axes · tap for cues · combine freely')}</p>

          {/* 三维筛选 */}
          <div className="nesio-xlib-filter">
            {chip(muscle === 'all', L(dict, '全部肌群', 'All muscles'), () => setMuscle('all'), 'm-all')}
            {MUSCLES.map((m) => chip(muscle === m, L(dict, MUSCLE_LABEL[m][0], MUSCLE_LABEL[m][1]), () => setMuscle(m), `m-${m}`))}
          </div>
          <div className="nesio-xlib-filter">
            {chip(equip === 'all', L(dict, '全部器械', 'All gear'), () => setEquip('all'), 'e-all')}
            {EQUIPS.map((e) => chip(equip === e, L(dict, EQUIP_LABEL[e][0], EQUIP_LABEL[e][1]), () => setEquip(e), `e-${e}`))}
          </div>
          <div className="nesio-xlib-filter">
            {chip(move === 'all', L(dict, '所有模式', 'All patterns'), () => setMove('all'), 'v-all')}
            {MOVES.map((v) => chip(move === v, L(dict, MOVE_LABEL[v][0], MOVE_LABEL[v][1]), () => setMove(v), `v-${v}`))}
          </div>

          {/* 卡片 */}
          {list.length === 0 && <p className="nesio-freeze-empty">{L(dict, '没有匹配的动作,换个筛选', 'No match — adjust filters')}</p>}
          <div className="nesio-xlib-cards">
            {list.map((ex) => {
              const expanded = openId === ex.id;
              return (
                <div key={ex.id} className={`nesio-xlib-card${inDraft(ex.id) ? ' is-picked' : ''}`}>
                  <button type="button" className="nesio-xlib-card-head" onClick={() => setOpenId(expanded ? null : ex.id)}>
                    <div className="nesio-xlib-card-info">
                      <span className="nesio-xlib-name">{ex.name}</span>
                      <div className="nesio-xlib-tags">
                        {ex.muscles.slice(0, 2).map((m, i) => <span key={i} className="nesio-xlib-tag tm">{m.n}</span>)}
                        <span className="nesio-xlib-tag te">{L(dict, EQUIP_LABEL[ex.equip[0]][0], EQUIP_LABEL[ex.equip[0]][1])}</span>
                        {ex.move.slice(0, 1).map((v) => <span key={v} className="nesio-xlib-tag tv">{L(dict, MOVE_LABEL[v][0], MOVE_LABEL[v][1])}</span>)}
                        <span className={`nesio-xlib-tag td-${ex.diff}`}>{L(dict, DIFF_LABEL[ex.diff][0], DIFF_LABEL[ex.diff][1])}</span>
                      </div>
                    </div>
                  </button>
                  <p className="nesio-xlib-cue">{ex.neural[0] || ex.cues[0]}</p>
                  {expanded && (
                    <div className="nesio-xlib-detail">
                      <p className="nesio-xlib-detail-label">{L(dict, '技术要点', 'Cues')}</p>
                      <ul>{ex.cues.map((c, i) => <li key={i}>{c}</li>)}</ul>
                      {ex.warnings.length > 0 && <>
                        <p className="nesio-xlib-detail-label">{L(dict, '常见错误', 'Watch out')}</p>
                        <ul>{ex.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                      </>}
                      {ex.mods.length > 0 && <>
                        <p className="nesio-xlib-detail-label">{L(dict, '变式', 'Variations')}</p>
                        <ul>{ex.mods.map((m, i) => <li key={i}>{m}</li>)}</ul>
                      </>}
                    </div>
                  )}
                  <button type="button" className={`nesio-xlib-add${inDraft(ex.id) ? ' is-picked' : ''}`} onClick={() => toggleDraft(ex)}>
                    {inDraft(ex.id) ? L(dict, '已加入 ✓', 'Added ✓') : L(dict, '+ 加入', '+ Add')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* 草稿底栏 */}
        {(draft.length > 0 || flash) && (
          <div className="nesio-xlib-draftbar">
            {flash ? <span className="nesio-xlib-draft-count">{flash}</span> : <>
              <span className="nesio-xlib-draft-count">{L(dict, `已选 ${draft.length} 个`, `${draft.length} picked`)}</span>
              <button type="button" className="nesio-xlib-draft-save" onClick={save}>{L(dict, '存为训练', 'Save')}</button>
              <button type="button" className="nesio-xlib-draft-play" onClick={startPlay}>{L(dict, '开始跟练', 'Start')}</button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
