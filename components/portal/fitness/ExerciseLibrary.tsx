'use client';

/**
 * ExerciseLibrary — 动作库(批次 46,Slice 3)。筛选 + 自由组合。
 * 部位走**左侧竖栏**(2026-07-28,用户标注 图5);器械 / 动作模式仍是横向 chip。
 * 卡片展开看要点+神经提示;「加入」攒成草稿,「开始跟练」直接练 或「存为训练」存到健康页。
 *
 * 部位栏是一根轴管两个库(精选 18 的 MuscleTag + 扩展 1324 的 bodyPart),
 * 映射和它的不变量在 lib/portal/exercise-parts.ts。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  filterExercises, EQUIP_LABEL, MOVE_LABEL, DIFF_LABEL,
  type Exercise, type MoveTag,
} from '@/lib/portal/exercise-library';
import {
  loadExerciseCatalog, filterCatalog, catalogGifSrc, CATALOG_EQUIP_LABEL, CATALOG_PART_LABEL,
  type CatalogExercise,
} from '@/lib/portal/exercise-catalog';
import { BODY_PARTS, EQUIP_AXIS, catalogInPart, catalogInEquip, musclesOfPart, equipsOfKey } from '@/lib/portal/exercise-parts';
import { workoutDisplayName } from '@/lib/portal/workout-name';
import ExerciseGif from './ExerciseGif';

const CATALOG_RENDER_CAP = 40; // 一次最多渲染 40 张,避免上千卡片卡死主线程
import { saveWorkout, type WorkoutItem } from '@/lib/portal/workout-store';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import type { PlayerStep } from './WorkoutPlayer';
import { useSheetDismiss } from '@/lib/portal/use-sheet-dismiss';
import { useSheetDrag } from '../use-sheet-drag';

const HOLD_IDS = new Set(['side-plank', 'deadbug', 'prone-swimmer', 'cat-cow', '9090']);
function defaultItem(ex: Exercise): WorkoutItem {
  return HOLD_IDS.has(ex.id) ? { exerciseId: ex.id, sets: 3, reps: 30, unit: 'sec' } : { exerciseId: ex.id, sets: 3, reps: 10, unit: 'reps' };
}

const MOVES: MoveTag[] = ['squat', 'hinge', 'push', 'pull', 'core_s', 'mobility'];

export default function ExerciseLibrary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  // 部位 = 左侧栏(图5)。一根轴同时管精选 18 和扩展 1324 —— 映射在 exercise-parts.ts。
  const [part, setPart] = useState<string>('all');
  // 器械也是一根轴管两个库(精选 4 类 + 扩展 28 类)—— 之前是上下两行都叫「全部器械」。
  const [equip, setEquip] = useState<string>('all');
  const [move, setMove] = useState<MoveTag | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkoutItem[]>([]);
  const [flash, setFlash] = useState('');
  const [catalog, setCatalog] = useState<CatalogExercise[] | null>(null);
  const [catStatus, setCatStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [catErr, setCatErr] = useState('');
  const [q, setQ] = useState('');

  // 2026-07-28(标注 图7「合并」):不再有「精选 18 / 全部 1324」两个模式 ——
  // 一个库、一个搜索框。搜索词或左侧栏选了部位,就把扩展库(1324)懒加载进来,和精选一起出结果。
  // 选部位也要触发:精选 18 个覆盖不到手臂/腿/有氧/颈,不拉扩展库那几项点进去就是空白。
  // ⚠️ 只从 idle 触发一次:失败后停在 error(不是 idle)→ effect 不再自触发,
  //    避免「拉取失败→重触发→再失败」无限循环卡死主线程。重试由按钮显式把 catStatus 拨回 idle。
  const loadCat = () => {
    setCatStatus('loading');
    setCatErr('');
    loadExerciseCatalog()
      .then((doc) => { setCatalog(doc.exercises); setCatStatus('ready'); })
      .catch((e) => { setCatErr(String((e && e.message) || e)); setCatStatus('error'); });
  };
  useEffect(() => {
    if ((!q.trim() && part === 'all') || catalog || catStatus !== 'idle') return;
    loadCat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, part, catalog, catStatus]);

  const catFiltered = useMemo(() => {
    if (!catalog) return [];
    return filterCatalog(catalog, q)
      .filter((e) => catalogInPart(e, part))
      .filter((e) => catalogInEquip(e, equip));
  }, [catalog, q, part, equip]);

  useSheetDismiss(open, onClose);
  const { handleProps, cardStyle, expanded: sheetExpanded } = useSheetDrag(onClose);

  if (!open) return null;

  const qq = q.trim().toLowerCase();
  // 精选库按部位筛:一个部位可能对应多个肌群标签(臀髋 = glute + hip),所以逐个取并集。
  const wantMuscles = musclesOfPart(part);
  const wantEquips = equipsOfKey(equip);
  const list = filterExercises({ move })
    .filter((ex) => wantMuscles === 'all' || wantMuscles.some((m) => ex.tags.includes(m)))
    .filter((ex) => wantEquips === 'all' || wantEquips.some((g) => ex.equip.includes(g)))
    .filter((ex) => !qq || `${ex.name} ${ex.cues.join(' ')} ${ex.muscles.map((m) => m.n).join(' ')}`.toLowerCase().includes(qq));
  // 扩展库什么时候露面:搜索了,或者选了部位(精选覆盖不到的部位全靠它)。
  // 但选了「动作模式」就不露 —— 扩展库那 1324 条没有模式标注(category 字段其实是部位的副本),
  // 硬接上去等于把没筛过的结果混进筛过的列表里,比不显示更误导。
  const showCatalog = (Boolean(qq) || part !== 'all') && move === 'all';
  const inDraft = (id: string) => draft.some((d) => d.exerciseId === id);

  const toggleDraft = (ex: Exercise) => {
    setDraft((prev) => prev.some((d) => d.exerciseId === ex.id) ? prev.filter((d) => d.exerciseId !== ex.id) : [...prev, defaultItem(ex)]);
  };
  const toggleDraftId = (id: string) => {
    setDraft((prev) => prev.some((d) => d.exerciseId === id) ? prev.filter((d) => d.exerciseId !== id) : [...prev, { exerciseId: id, sets: 3, reps: 10, unit: 'reps' }]);
  };

  const startPlay = () => {
    if (!draft.length) return;
    const steps: PlayerStep[] = draft.map((d) => ({ ...d, restSec: 45 }));
    window.dispatchEvent(new CustomEvent('nesio-start-workout', { detail: { name: workoutDisplayName(draft, L(dict, '自定义训练', 'Custom workout'), dict === 'en' ? 'en' : 'zh'), steps } }));
    // 开练后收起动作库、清草稿(和 save 一致),否则 WorkoutPlayer 关掉后动作库还开着、草稿还在。
    setDraft([]);
    onClose();
  };

  const save = () => {
    if (!draft.length) return;
    saveWorkout({ name: workoutDisplayName(draft, L(dict, '自定义训练', 'Custom workout'), dict === 'en' ? 'en' : 'zh'), items: draft });
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
      <div className={`nesio-settings-sheet-card${sheetExpanded ? ' nesio-sheet--expanded' : ''}`} style={cardStyle}>
        <div className="nesio-sheet-handle" {...handleProps} />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{L(dict, '动作库', 'Exercise library')}</h2>
        </div>
        <div className="nesio-settings-sheet-body">
          {/* 2026-07-28 UI 精修(标注 图6/图7):
              ① 「精选 18 / 全部 1324」两个 chip 合并 —— 一个库一个搜索框,搜到什么算什么;
              ② 「三维筛选 · 点动作看要点 · 加入自由组合」说明行删掉(chip 自己会说话);
              ③ 标签不再一个一个颜色(见 globals.css .nesio-xlib-tag)。 */}
          <input
            className="nesio-xlib-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={L(dict, '搜动作 / 部位 / 器械 / 要点', 'Search name / part / gear / cue')}
            aria-label={L(dict, '搜索动作', 'Search exercises')}
          />

          {/* 器械 / 动作模式仍是横向 chip;部位那一轴挪到左侧栏(图5)。 */}
          <div className="nesio-xlib-filter">
            {chip(equip === 'all', L(dict, '全部器械', 'All gear'), () => setEquip('all'), 'e-all')}
            {EQUIP_AXIS.map((g) => chip(equip === g.key, L(dict, g.zh, g.en), () => setEquip(g.key), `e-${g.key}`))}
          </div>
          <div className="nesio-xlib-filter">
            {chip(move === 'all', L(dict, '所有模式', 'All patterns'), () => setMove('all'), 'v-all')}
            {MOVES.map((v) => chip(move === v, L(dict, MOVE_LABEL[v][0], MOVE_LABEL[v][1]), () => setMove(v), `v-${v}`))}
          </div>

          <div className="nesio-xlib-split">
          {/* 左侧部位栏。粘在顶上单独滚,右边翻卡片时它不动 —— 换部位不用先滚回顶。 */}
          <nav className="nesio-xlib-rail" aria-label={L(dict, '按部位筛选', 'Filter by body part')}>
            <button
              type="button"
              className={`nesio-xlib-rail-btn${part === 'all' ? ' is-active' : ''}`}
              aria-current={part === 'all' ? 'true' : undefined}
              onClick={() => setPart('all')}
            >{L(dict, '全部', 'All')}</button>
            {BODY_PARTS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`nesio-xlib-rail-btn${part === p.key ? ' is-active' : ''}`}
                aria-current={part === p.key ? 'true' : undefined}
                onClick={() => setPart(p.key)}
              >{L(dict, p.zh, p.en)}</button>
            ))}
          </nav>

          <div className="nesio-xlib-main">
          {move !== 'all' && (
            <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>
              {L(dict, '动作模式只有精选动作标注了,这次先不带完整库。', 'Only the curated moves carry pattern tags — the full library sits this one out.')}
            </p>
          )}
          {list.length === 0 && !showCatalog && <p className="nesio-freeze-empty">{L(dict, '没有匹配的动作,换个筛选', 'No match — adjust filters')}</p>}
          <div className="nesio-xlib-cards">
            {list.map((ex) => {
              const expanded = openId === ex.id;
              return (
                <div key={ex.id} className={`nesio-xlib-card${inDraft(ex.id) ? ' is-picked' : ''}`}>
                  <button type="button" className="nesio-xlib-card-head" onClick={() => setOpenId(expanded ? null : ex.id)}>
                    <div className="nesio-xlib-card-info">
                      <span className="nesio-xlib-name">{ex.name}</span>
                      <div className="nesio-xlib-tags">
                        {ex.muscles.slice(0, 2).map((m, i) => <span key={i} className="nesio-xlib-tag">{m.n}</span>)}
                        <span className="nesio-xlib-tag">{L(dict, EQUIP_LABEL[ex.equip[0]][0], EQUIP_LABEL[ex.equip[0]][1])}</span>
                        {ex.move.slice(0, 1).map((v) => <span key={v} className="nesio-xlib-tag">{L(dict, MOVE_LABEL[v][0], MOVE_LABEL[v][1])}</span>)}
                        <span className="nesio-xlib-tag">{L(dict, DIFF_LABEL[ex.diff][0], DIFF_LABEL[ex.diff][1])}</span>
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

          {/* 扩展库(1324)接在精选后面 —— 同一个库,不用切模式。 */}
          {showCatalog && (
            <>
              {catStatus === 'loading' && <p className="nesio-freeze-empty">{L(dict, '正在把完整动作库载进来…', 'Loading the full library…')}</p>}
              {catStatus === 'error' && (
                <div className="nesio-exfig--error" style={{ aspectRatio: 'auto', padding: '1rem' }}>
                  <span className="nesio-exfig-msg">{L(dict, '完整动作库没载进来', 'Library did not load')}{catErr ? `（${catErr}）` : ''}</span>
                  <button type="button" className="nesio-exfig-retry" onClick={loadCat}>{L(dict, '重试', 'Retry')}</button>
                </div>
              )}
              {catalog && (
                <>
                  {/* 部位和器械两根轴都在上面了 —— 这里原来还各有一行 chip,
                      同一件事两个控件、选了这个不影响那个,是「割裂」的典型。 */}
                  <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>
                    {L(dict, `完整库还有 ${catFiltered.length} 个${catFiltered.length > CATALOG_RENDER_CAP ? `（显示前 ${CATALOG_RENDER_CAP}，再具体一点缩小范围）` : ''}`, `${catFiltered.length} more in the full library${catFiltered.length > CATALOG_RENDER_CAP ? ` (first ${CATALOG_RENDER_CAP}, refine to narrow)` : ''}`)}
                  </p>
                  {catFiltered.length === 0 && list.length === 0 && <p className="nesio-freeze-empty">{L(dict, '没搜到,换个词或筛选', 'No match — try another term')}</p>}
                  <div className="nesio-xlib-cards">
                    {catFiltered.slice(0, CATALOG_RENDER_CAP).map((ex) => {
                      const expanded = openId === ex.id;
                      const picked = inDraft(ex.id);
                      return (
                        <div key={ex.id} className={`nesio-xlib-card${picked ? ' is-picked' : ''}`}>
                          <button type="button" className="nesio-xlib-card-head" onClick={() => setOpenId(expanded ? null : ex.id)}>
                            <div className="nesio-xlib-card-info">
                              <span className="nesio-xlib-name">{ex.nameZh || ex.name}</span>
                              <div className="nesio-xlib-tags">
                                <span className="nesio-xlib-tag">{CATALOG_PART_LABEL[ex.bodyPart] || ex.bodyPart}</span>
                                <span className="nesio-xlib-tag">{CATALOG_EQUIP_LABEL[ex.equipment] || ex.equipment}</span>
                                {ex.target && <span className="nesio-xlib-tag">{ex.target}</span>}
                              </div>
                            </div>
                          </button>
                          {ex.cues[0] && <p className="nesio-xlib-cue">{ex.cues[0]}</p>}
                          {expanded && (
                            <div className="nesio-xlib-detail">
                              <ExerciseGif src={catalogGifSrc(ex.media)} alt={ex.nameZh || ex.name} />
                              {ex.cues.length > 0 && <>
                                <p className="nesio-xlib-detail-label">{L(dict, '技术要点', 'Cues')}</p>
                                <ul>{ex.cues.map((c, i) => <li key={i}>{c}</li>)}</ul>
                              </>}
                            </div>
                          )}
                          <button type="button" className={`nesio-xlib-add${picked ? ' is-picked' : ''}`} onClick={() => toggleDraftId(ex.id)}>
                            {picked ? L(dict, '已加入 ✓', 'Added ✓') : L(dict, '+ 加入', '+ Add')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
          </div>{/* /nesio-xlib-main */}
          </div>{/* /nesio-xlib-split */}
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
