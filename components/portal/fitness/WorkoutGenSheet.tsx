'use client';

/**
 * WorkoutGenSheet — 「今天练什么」两问生成入口(借 workout.lol 之形;UI 稿 artifact 11a114ae)。
 * 两屏一个 sheet:① 器械(多选,答一次记住)+ 部位(回溯建议预选)+ 量;② 草稿(逐行可换)。
 * 生成是确定性规则抽样(workout-generate),不是 AI;开练走现有 nesio-start-workout,
 * 存训练走现有 workout-store。目录加载失败显式失败态 + 重试(异步红线)。
 */

import { useEffect, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  loadExerciseCatalog, catalogGifSrc, CATALOG_EQUIP_LABEL, type CatalogExercise,
} from '@/lib/portal/exercise-catalog';
import {
  EQUIP_OPTIONS, FOCUS_OPTIONS, TARGET_LABEL, generateWorkout, swapAlternative, estimateMinutes,
  loadEquipPref, saveEquipPref, loadLastWorkout, suggestNextFocus,
  type GenEquip, type GenFocus, type GeneratedItem,
} from '@/lib/portal/workout-generate';
import { saveWorkout } from '@/lib/portal/workout-store';
import ExerciseGif from './ExerciseGif';

export default function WorkoutGenSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [step, setStep] = useState<'ask' | 'draft'>('ask');
  const [equips, setEquips] = useState<GenEquip[]>(['body']);
  const [focus, setFocus] = useState<GenFocus>('balanced');
  const [suggested, setSuggested] = useState<GenFocus | null>(null);
  const [count, setCount] = useState<4 | 6>(6);
  const [catalog, setCatalog] = useState<CatalogExercise[] | null>(null);
  const [items, setItems] = useState<GeneratedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [savedToMine, setSavedToMine] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('ask'); setErr(''); setNote(''); setSavedToMine(false); setItems([]);
    setEquips(loadEquipPref());
    const last = loadLastWorkout();
    const sug = suggestNextFocus(last?.focus ?? null);
    setFocus(sug);
    setSuggested(last?.focus ? sug : null);
  }, [open]);

  const toggleEquip = (k: GenEquip) => {
    setEquips((prev) => {
      const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
      return next.length ? next : prev; // 至少留一个,配套才有池
    });
  };

  async function generate() {
    setBusy(true); setErr(''); setNote(''); setSavedToMine(false);
    try {
      const doc = await loadExerciseCatalog();
      setCatalog(doc.exercises);
      saveEquipPref(equips);
      const out = generateWorkout(doc.exercises, { equips, focus, count });
      if (out.length === 0) {
        setErr(t('这些器械下配不出这个部位的一套 —— 换个器械或部位再试试。', 'No moves match this focus with that equipment — try different picks.'));
      } else {
        setItems(out);
        setStep('draft');
      }
    } catch {
      setErr(t('动作库没加载出来 —— 检查网络,点「配一套看看」重试。', 'Could not load the exercise catalog — check network and tap again to retry.'));
    } finally {
      setBusy(false);
    }
  }

  function swapAt(i: number) {
    if (!catalog) return;
    const next = swapAlternative(catalog, items, i, { equips });
    if (!next) { setNote(t('这个肌群在当前器械下没有更多可换的了。', 'No more alternatives for this muscle with current equipment.')); return; }
    setNote(''); setSavedToMine(false);
    setItems((prev) => prev.map((it, j) => (j === i ? next : it)));
  }

  const focusLabel = FOCUS_OPTIONS.find(([k]) => k === focus);
  const genName = focusLabel ? L(dict, focusLabel[1], focusLabel[2]) : '';

  function startNow() {
    window.dispatchEvent(new CustomEvent('nesio-start-workout', {
      detail: {
        name: genName,
        steps: items.map((it) => ({ exerciseId: it.exercise.id, sets: it.sets, reps: it.reps, unit: it.unit, restSec: 45 })),
      },
    }));
    onClose();
  }

  function saveToMine() {
    saveWorkout({ name: genName, items: items.map((it) => ({ exerciseId: it.exercise.id, sets: it.sets, reps: it.reps, unit: it.unit })) });
    setSavedToMine(true);
  }

  const chip = (on: boolean, gentle = false): React.CSSProperties => ({
    border: gentle ? '1px dashed var(--status-gentle)' : '1px solid var(--portal-line)',
    borderRadius: 'var(--radius-sm)', padding: '5px 11px', fontSize: 'var(--text-xs)',
    fontFamily: 'var(--font-sans)', cursor: 'pointer',
    background: on ? (gentle ? 'var(--status-gentle-soft)' : 'var(--portal-accent-soft-md)') : 'transparent',
    color: on ? (gentle ? 'var(--status-gentle)' : 'var(--portal-accent)') : 'var(--portal-muted)',
    ...(on && !gentle ? { borderColor: 'transparent' } : {}), fontWeight: on ? 700 : 400,
  });
  const qLabel: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', margin: '0 0 6px' };
  const memo: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', opacity: 0.85, margin: '4px 0 0' };

  return (
    <NesioSheet variant="bottom" open={open} onOpenChange={(o) => { if (!o) onClose(); }} ariaLabel={t('今天练什么', 'What to train today')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-4) var(--space-6)' }}>
        {step === 'ask' && (
          <>
            <p style={{ fontSize: 'var(--text-h3)', fontWeight: 700, margin: 0 }}>{t('今天练什么', 'What to train today')}</p>
            <div>
              <p style={qLabel}>{t('手边有什么器械(可多选)', 'Equipment on hand (multi)')}</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {EQUIP_OPTIONS.map(([k, zh, en]) => (
                  <button key={k} type="button" style={chip(equips.includes(k))} onClick={() => toggleEquip(k)}>{L(dict, zh, en)}</button>
                ))}
              </div>
              <p style={memo}>{t('记住了,下次默认带上,随时改。', 'Remembered — preselected next time, change anytime.')}</p>
            </div>
            <div>
              <p style={qLabel}>{t('想练哪块', 'Focus')}</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {FOCUS_OPTIONS.map(([k, zh, en]) => (
                  <button key={k} type="button" style={chip(focus === k, suggested === k && focus === k)} onClick={() => setFocus(k)}>
                    {L(dict, zh, en)}{suggested === k ? t(' · 建议', ' · suggested') : ''}
                  </button>
                ))}
              </div>
              {suggested && <p style={memo}>{t('按上次练的部位轮着来 —— 只是建议,点别的就换。', 'Rotated from your last session — just a suggestion.')}</p>}
            </div>
            <div>
              <p style={qLabel}>{t('练多少', 'How much')}</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" style={chip(count === 4)} onClick={() => setCount(4)}>{t('轻一点 · 4 个动作', 'Light · 4 moves')}</button>
                <button type="button" style={chip(count === 6)} onClick={() => setCount(6)}>{t('标准 · 6 个动作', 'Standard · 6 moves')}</button>
              </div>
            </div>
            {err && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-risk)', margin: 0 }}>{err}</p>}
            <button type="button" onClick={() => { void generate(); }} disabled={busy}
              style={{ border: 'none', borderRadius: 'var(--radius-sm)', padding: '12px', fontSize: 'var(--text-body)', fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', background: 'var(--portal-accent)', color: '#fff', opacity: busy ? 0.6 : 1 }}>
              {busy ? t('配着呢…', 'Putting it together…') : t('配一套看看', 'Put a set together')}
            </button>
            <button type="button" onClick={onClose}
              style={{ border: 'none', background: 'none', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)', cursor: 'pointer', padding: 4 }}>
              {t('先不练', 'Not now')}
            </button>
            <p style={{ ...memo, textAlign: 'center', margin: 0 }}>{t('按器械和肌群从动作库里规则抽样 —— 不是 AI,换到满意为止。', 'Rule-based sampling from the catalog — not AI; swap until it fits.')}</p>
          </>
        )}

        {step === 'draft' && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 'var(--text-h3)', fontWeight: 700, margin: 0 }}>{genName}</p>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                {t(`${items.length} 个动作 · 约 ${estimateMinutes(items)} 分钟`, `${items.length} moves · ~${estimateMinutes(items)} min`)}
              </span>
            </div>
            <div>
              {items.map((it, i) => (
                <div key={it.exercise.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 2px', borderBottom: i < items.length - 1 ? '1px solid var(--portal-line)' : 'none' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', background: 'var(--portal-accent-soft)', flexShrink: 0 }}>
                    <ExerciseGif src={catalogGifSrc(it.exercise.media)} alt="" />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.exercise.nameZh && dict !== 'en' ? it.exercise.nameZh : it.exercise.name}</p>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', margin: '2px 0 0' }}>
                      {TARGET_LABEL[it.exercise.target] ? L(dict, TARGET_LABEL[it.exercise.target][0], TARGET_LABEL[it.exercise.target][1]) : it.exercise.target}
                      {' · '}
                      {CATALOG_EQUIP_LABEL[it.exercise.equipment] || it.exercise.equipment}
                    </p>
                  </div>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {it.unit === 'sec' ? `${it.sets}×${it.reps}s` : `${it.sets}×${it.reps}`}
                  </span>
                  <button type="button" onClick={() => swapAt(i)} aria-label={t('换一个', 'Swap')} title={t('换一个(同肌群)', 'Swap (same muscle)')}
                    style={{ flexShrink: 0, border: '1px solid var(--portal-line)', background: 'none', borderRadius: 'var(--radius-pill)', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--portal-accent)', cursor: 'pointer' }}>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M2 5a5 5 0 0 1 9-2m1 6a5 5 0 0 1-9 2M11 1v2.5H8.5M3 13v-2.5h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            {note && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--status-gentle)', margin: 0 }}>{note}</p>}
            {err && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-risk)', margin: 0 }}>{err}</p>}
            <button type="button" onClick={startNow}
              style={{ border: 'none', borderRadius: 'var(--radius-sm)', padding: '12px', fontSize: 'var(--text-body)', fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', background: 'var(--portal-accent)', color: '#fff' }}>
              {t('开始跟练', 'Start now')}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={saveToMine} disabled={savedToMine}
                style={{ flex: 1, border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', padding: '10px', fontSize: 'var(--text-sm)', fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', background: 'transparent', color: savedToMine ? 'var(--status-go)' : 'var(--portal-accent)' }}>
                {savedToMine ? t('已存入「我的训练」', 'Saved to My workouts') : t('存为我的训练', 'Save to mine')}
              </button>
              <button type="button" onClick={() => { void generate(); }} disabled={busy}
                style={{ flex: 1, border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', padding: '10px', fontSize: 'var(--text-sm)', fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', background: 'transparent', color: 'var(--portal-accent)', opacity: busy ? 0.6 : 1 }}>
                {busy ? t('配着呢…', 'Working…') : t('整套重配', 'Redo the set')}
              </button>
            </div>
            <button type="button" onClick={() => { setStep('ask'); setNote(''); setErr(''); }}
              style={{ border: 'none', background: 'none', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)', cursor: 'pointer', padding: 4 }}>
              {t('← 改器械 / 部位', '← Change equipment / focus')}
            </button>
          </>
        )}
      </div>
    </NesioSheet>
  );
}
