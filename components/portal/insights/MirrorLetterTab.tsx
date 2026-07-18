'use client';

/**
 * 多面镜(v1 规格 §2.3 · 设计稿「念念 · 给你的信」)——认知 tab 的主体。
 *
 * 整屏只留一封信:念念选一面镜子读你的本地档案(批量导入已剔除),用第二人称写给你。
 * 镜子 / 月份 / 主题收成三枚 filter;往期信折叠成右上「往期」按钮 → 存档抽屉。
 * 信下方两颗动作:存入记忆(幂等落库) / 重写(重生成)。只回看不预测,任意时段都能生成。
 * 老友免费试读,其余四面镜 Pro(dispatch nesio-pro-gate)。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getLifeGraph, isBulkImported } from '@/lib/portal/life-graph';
import { getMirrorProfile } from '@/lib/portal/mirror-profile';
import { summarizeForLivingModel } from '@/lib/platform/living-model';
import { loadProfileSettings, portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { isPro } from '@/lib/portal/entitlement';
import {
  MIRRORS,
  MIRROR_TOPICS,
  currentMonthKey,
  recentMonthKeys,
  mirrorLetterKey,
  loadMirrorLetter,
  saveMirrorLetter,
  loadMirrorFeedback,
  saveMirrorFeedback,
  recentFeedbackSamples,
  listMirrorLetters,
  type MirrorId,
  type MirrorLetter,
} from '@/lib/portal/mirror-letters';
import { persistMirrorLetterToMemory } from '@/lib/portal/mirror-letter-persist';
import { track } from '@/lib/portal/telemetry';
import { L } from '@/lib/portal/i18n';
import { usePortalLocale } from '../use-portal-locale';
import { IconHistory, IconBox, IconRefresh, IconCheckCircle } from '../icons';

type LetterError = 'auth' | 'no-key' | 'quota' | 'ai-error' | 'network' | 'thin' | 'save' | null;

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabelOf(monthKey: string, dict: string): string {
  const n = Number(monthKey.slice(5));
  return L(dict, `${n} 月`, MONTHS_EN[n - 1] ?? monthKey);
}

// ── 小组件:filter 下拉(chip 按钮 + 弹层,点空白关闭,始终可退出)──
function FilterDropdown<T extends string>({
  label, value, options, onPick, dict, leading,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string; hint?: string; locked?: boolean }>;
  onPick: (id: T) => void;
  dict: string;
  leading?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <div className="nesio-mirror-filter">
      <button
        type="button"
        className={`nesio-mirror-filter-btn${open ? ' nesio-mirror-filter-btn--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
      >
        {leading}
        <span>{current?.label ?? label}</span>
        <span className="nesio-mirror-filter-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <>
          <button type="button" className="nesio-mirror-filter-backdrop" aria-label={L(dict, '关闭', 'Close')} onClick={() => setOpen(false)} />
          <div className="nesio-mirror-filter-menu" role="listbox">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === value}
                className={`nesio-mirror-filter-opt${o.id === value ? ' nesio-mirror-filter-opt--on' : ''}`}
                onClick={() => { onPick(o.id); setOpen(false); }}
              >
                <span>{o.label}</span>
                {o.locked && <span className="nesio-mirror-chip-lock">Pro</span>}
                {o.hint && !o.locked && <span className="nesio-mirror-filter-hint">{o.hint}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function MirrorLetterTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());

  const [mirrorId, setMirrorId] = useState<MirrorId>('friend');
  const [month, setMonth] = useState<string>(currentMonthKey());
  // 图3:除了按月,允许自定义任意时间段(month 存成 `custom:from:to`)
  const [customMode, setCustomMode] = useState(false);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [topic, setTopic] = useState<string>('all');
  const [letter, setLetter] = useState<MirrorLetter | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LetterError>(null);
  const [feedback, setFeedback] = useState<Record<string, 'yes' | 'no'>>({});
  const [nodeCount, setNodeCount] = useState(0);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [archive, setArchive] = useState<MirrorLetter[]>([]);

  const isCustomRange = month.startsWith('custom:');
  const monthLabel = isCustomRange ? month.split(':').slice(1).join(' – ') : monthLabelOf(month, dict);
  const activeMirror = MIRRORS.find((m) => m.id === mirrorId) ?? MIRRORS[0];

  function pickMonth(id: string) {
    if (id === '__custom__') { setCustomMode(true); return; }
    setCustomMode(false);
    setMonth(id);
  }
  function setRange(from: string, to: string) {
    setRangeFrom(from); setRangeTo(to);
    if (from && to && from <= to) setMonth(`custom:${from}:${to}`);
  }
  const activeTopic = MIRROR_TOPICS.find((t) => t.id === topic) ?? MIRROR_TOPICS[0];

  useEffect(() => {
    setFeedback(loadMirrorFeedback());
    try { setNodeCount(getLifeGraph().filter((n) => !isBulkImported(n)).length); } catch { /* ignore */ }
    setArchive(listMirrorLetters());
  }, []);

  // 切镜子/月/主题:先取该三元组的本地缓存,没有就等用户点「写这封信」(不自动打云)
  useEffect(() => {
    setLetter(loadMirrorLetter(month, mirrorId, topic));
    setError(null);
    setSaved(false);
  }, [month, mirrorId, topic]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      // 批量导入剔出证据;再按所选月份把档案裁到那一个月(「任意时段都能生成」)
      const all = getLifeGraph().filter((n) => !isBulkImported(n));
      const monthNodes = month.startsWith('custom:')
        ? (() => { const [, f, t] = month.split(':'); const end = `${t}T23:59:59`; return all.filter((n) => typeof n.createdAt === 'string' && n.createdAt.slice(0, 10) >= f && n.createdAt <= end); })()
        : all.filter((n) => typeof n.createdAt === 'string' && n.createdAt.slice(0, 7) === month);
      const nodes = monthNodes.length >= 10 ? monthNodes : all; // 该段太薄则回落全档,由服务端门槛兜底
      const summary = summarizeForLivingModel({ nodes, mirrorProfile: getMirrorProfile(), previousInsights: [] });
      const res = await fetch('/api/portal/mirror-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mirrorId,
          locale: dict,
          monthLabel,
          focusTopic: topic === 'all' ? '' : L(dict, activeTopic.name, activeTopic.nameEn),
          nodeCount: summary.nodeCount,
          typeBreakdown: summary.typeBreakdown,
          topDomains: summary.topDomains,
          recentSample: summary.recentSample,
          completionRate: summary.completionRate,
          topHour: summary.topHour,
          dominantDomains: summary.dominantDomains,
          userName: loadProfileSettings().displayName,
          feedbackSamples: recentFeedbackSamples(),
        }),
      });
      if (res.status === 401) { setError('auth'); return; }
      const data = await res.json() as { ok?: boolean; paragraphs?: Array<{ text: string; evidence: string[]; confidence: number }>; reason?: string };
      if (data.reason === 'no_api_key') { setError('no-key'); return; }
      if (data.reason === 'quota') { setError('quota'); return; }
      if (data.reason === 'insufficient_data') { setError('thin'); return; }
      if (data.reason === 'api_error' || !data.ok || !data.paragraphs?.length) { setError('ai-error'); return; }
      const next: MirrorLetter = {
        mirrorId,
        month,
        topic,
        generatedAt: new Date().toISOString(),
        paragraphs: data.paragraphs.map((p, i) => ({ id: `p${i}`, text: p.text, evidence: p.evidence, confidence: p.confidence })),
      };
      saveMirrorLetter(next);
      setLetter(next);
      setArchive(listMirrorLetters());
      track('mirror_letter_generated', { mirror: mirrorId });
    } catch {
      setError('network');
    } finally {
      setLoading(false);
    }
  }, [mirrorId, dict, month, monthLabel, topic, activeTopic]);

  function pickMirror(id: MirrorId) {
    const def = MIRRORS.find((m) => m.id === id);
    if (def && !def.freePreview && !isPro()) {
      window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'mirror_letter' } }));
      return;
    }
    setMirrorId(id);
  }

  function verdict(paragraphId: string, v: 'yes' | 'no') {
    const key = `${mirrorLetterKey(month, mirrorId, topic)}:${paragraphId}`;
    saveMirrorFeedback(key, v);
    setFeedback((prev) => ({ ...prev, [key]: v }));
  }

  function saveToMemory() {
    if (!letter) return;
    try {
      const title = `${L(dict, '多面镜', 'Mirror')} · ${monthLabel} · ${L(dict, activeMirror.name, activeMirror.nameEn)}`;
      persistMirrorLetterToMemory(letter, {
        title,
        mirrorName: L(dict, activeMirror.name, activeMirror.nameEn),
        topicLabel: L(dict, activeTopic.name, activeTopic.nameEn),
      });
      setSaved(true);
      setError(null);
      track('mirror_letter_saved', { mirror: mirrorId });
      window.setTimeout(() => setSaved(false), 2400);
    } catch {
      setError('save');
    }
  }

  function openArchived(l: MirrorLetter) {
    setMirrorId(l.mirrorId);
    setMonth(l.month);
    if (l.month.startsWith('custom:')) { const [, f, t] = l.month.split(':'); setCustomMode(true); setRangeFrom(f); setRangeTo(t); }
    else setCustomMode(false);
    setTopic(l.topic || 'all');
    setArchiveOpen(false);
  }

  const errorText = error === 'auth'
    ? L(dict, '登录后,念念每月给你写一封信。', 'Sign in and Nessa will write you a letter each month.')
    : error === 'no-key'
      ? L(dict, '还没接上 AI(部署里配一个 AI key 即可),信写不出来。', 'AI is not connected yet (set an AI key in your deployment).')
      : error === 'quota'
        ? L(dict, 'AI 免费额度暂时用完了(服务端需配 ANTHROPIC_API_KEY 或给 Gemini 开付费)——不是你的问题。', 'The free AI quota is used up for now (server needs ANTHROPIC_API_KEY or paid Gemini) — not your fault.')
      : error === 'thin'
        ? L(dict, '这个月能读到的还不多 —— 记满 10 条,信才有的可写。', 'Not much to read this month yet — the letter needs at least 10 notes.')
        : error === 'network'
          ? L(dict, '网络异常,这封信没送到,点重试。', 'Network issue — the letter did not arrive. Tap retry.')
          : error === 'save'
            ? L(dict, '这封信没能存进记忆,再点一次试试。', 'Could not save it to memory — tap again to retry.')
          : error === 'ai-error'
            ? L(dict, '这次没写出来(AI 忙或稍有波动),点重试。', 'Could not write it this time (AI busy) — tap retry.')
            : '';

  const mirrorOptions = useMemo(
    () => MIRRORS.map((m) => ({
      id: m.id,
      label: L(dict, m.name, m.nameEn),
      hint: L(dict, m.desc, m.descEn),
      locked: !m.freePreview && !isPro(),
    })),
    [dict],
  );
  const monthOptions = useMemo(
    () => [...recentMonthKeys(6).map((k) => ({ id: k, label: monthLabelOf(k, dict) })), { id: '__custom__', label: L(dict, '自定义时段…', 'Custom range…') }],
    [dict],
  );
  const topicOptions = useMemo(
    () => MIRROR_TOPICS.map((t) => ({ id: t.id, label: L(dict, t.name, t.nameEn) })),
    [dict],
  );

  return (
    <div className="nesio-mirror-tab">
      {/* 顶栏:三枚 filter(镜子/月/主题)+ 往期按钮 */}
      <div className="nesio-mirror-topbar">
        <div className="nesio-mirror-filters">
          <FilterDropdown
            label={L(dict, '镜子', 'Mirror')} value={mirrorId} options={mirrorOptions} onPick={pickMirror} dict={dict}
            leading={<span className="nesio-mirror-filter-dot" aria-hidden />}
          />
          <FilterDropdown label={L(dict, '月份', 'Month')} value={customMode || isCustomRange ? '__custom__' : month} options={monthOptions} onPick={pickMonth} dict={dict} />
          <FilterDropdown label={L(dict, '主题', 'Topic')} value={topic} options={topicOptions} onPick={setTopic} dict={dict} />
        </div>
        <button
          type="button"
          className="nesio-mirror-archive-btn"
          onClick={() => { setArchive(listMirrorLetters()); setArchiveOpen(true); }}
          aria-label={L(dict, '往期的信', 'Past letters')}
        >
          <IconHistory size={15} />
          <span>{L(dict, '往期', 'Past')}</span>
          {archive.length > 0 && <span className="nesio-mirror-archive-count">{archive.length}</span>}
        </button>
      </div>

      {/* 图3:自定义任意时间段(不限每月) */}
      {(customMode || isCustomRange) && (
        <div className="nesio-mirror-range">
          <input type="date" value={rangeFrom} max={rangeTo || undefined}
            onChange={(e) => setRange(e.target.value, rangeTo)} aria-label={L(dict, '开始日期', 'From')} />
          <span aria-hidden>—</span>
          <input type="date" value={rangeTo} min={rangeFrom || undefined}
            onChange={(e) => setRange(rangeFrom, e.target.value)} aria-label={L(dict, '结束日期', 'To')} />
        </div>
      )}

      {/* 信纸 */}
      {letter ? (
        <>
          <div className="nesio-mirror-letter">
            {letter.paragraphs.map((p) => {
              const key = `${mirrorLetterKey(month, mirrorId, topic)}:${p.id}`;
              const v = feedback[key];
              return (
                <div key={p.id} className="nesio-mirror-para">
                  <p className="nesio-mirror-para-text">{p.text}</p>
                  {p.evidence.length > 0 && (
                    <div className="nesio-mirror-evidence">
                      {p.evidence.map((e, i) => (
                        <span key={i} className="nesio-mirror-evidence-chip">{e}</span>
                      ))}
                    </div>
                  )}
                  <div className="nesio-mirror-verdict">
                    <button
                      type="button"
                      className={`nesio-mirror-verdict-btn${v === 'yes' ? ' nesio-mirror-verdict-btn--yes' : ''}`}
                      onClick={() => verdict(p.id, 'yes')}
                    >{L(dict, '说得对', 'Spot on')}</button>
                    <button
                      type="button"
                      className={`nesio-mirror-verdict-btn${v === 'no' ? ' nesio-mirror-verdict-btn--no' : ''}`}
                      onClick={() => verdict(p.id, 'no')}
                    >{L(dict, '不像我', 'Not me')}</button>
                  </div>
                </div>
              );
            })}
            <p className="nesio-mirror-sign">
              —— {L(dict, activeMirror.name, activeMirror.nameEn)} · {monthLabel} · {L(dict, activeTopic.name, activeTopic.nameEn)}
            </p>
          </div>

          {/* 信下方:存入记忆 / 重写 */}
          <div className="nesio-mirror-actions">
            <button type="button" className="nesio-mirror-action nesio-mirror-action--primary" onClick={saveToMemory} disabled={loading}>
              {saved ? <IconCheckCircle size={16} /> : <IconBox size={16} />}
              {saved ? L(dict, '已存入记忆', 'Saved to Memory') : L(dict, '存入记忆', 'Save to Memory')}
            </button>
            <button type="button" className="nesio-mirror-action" onClick={() => void generate()} disabled={loading}>
              <IconRefresh size={16} />
              {loading ? L(dict, '重写中…', 'Rewriting…') : L(dict, '重写', 'Rewrite')}
            </button>
          </div>
          {errorText && <p className="nesio-mirror-error">{errorText}</p>}
        </>
      ) : (
        <div className="nesio-mirror-empty">
          {loading ? (
            <p className="nesio-mirror-writing">{L(dict, `${L(dict, activeMirror.name, activeMirror.nameEn)}正在读你${monthLabel}的记录…`, `${L(dict, activeMirror.name, activeMirror.nameEn)} is reading through your ${monthLabel}…`)}</p>
          ) : (
            <>
              {errorText && <p className="nesio-mirror-error">{errorText}</p>}
              <button type="button" className="nesio-mirror-action nesio-mirror-action--primary" onClick={() => void generate()} disabled={nodeCount < 10 && !error}>
                {nodeCount < 10 && !error
                  ? L(dict, `已亲手记 ${nodeCount} / 10 条,记满后开写(通讯录等批量导入不算)`, `${nodeCount} / 10 hand-written notes — starts at 10 (bulk imports like contacts don't count)`)
                  : L(dict, '写这封信', 'Write the letter')}
              </button>
            </>
          )}
        </div>
      )}

      {/* 页脚诚实声明 */}
      <p className="nesio-mirror-note">{L(dict, '只回看,不预测 · 任意时段都能生成', 'Looks back, never predicts · generate for any period')}</p>

      {/* 往期存档抽屉。portal 到 body:此 Tab 可能渲染在 Vaul(transform)卡片内,
          position:fixed 会被 transform 祖先困住;portal 出去 + 容器 z-948(压过洞察卡 901)
          + pointer-events:auto(绕 Vaul 的 body pointer-events:none)才正确浮在最上。 */}
      {archiveOpen && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 948, pointerEvents: 'auto' }}>
          <button type="button" className="nesio-mirror-drawer-scrim" aria-label={L(dict, '关闭', 'Close')} onClick={() => setArchiveOpen(false)} />
          <div className="nesio-mirror-drawer" role="dialog" aria-label={L(dict, '往期的信', 'Past letters')}>
            <div className="nesio-mirror-drawer-head">
              <span className="nesio-mirror-drawer-title">{L(dict, `往期的信 · ${archive.length} 封`, `Past letters · ${archive.length}`)}</span>
              <button type="button" className="nesio-mirror-drawer-close" onClick={() => setArchiveOpen(false)} aria-label={L(dict, '关闭', 'Close')}>×</button>
            </div>
            {archive.length === 0 ? (
              <p className="nesio-mirror-drawer-empty">{L(dict, '还没有存下的信 —— 写一封,它就会出现在这里。', 'No letters yet — write one and it lands here.')}</p>
            ) : (
              <div className="nesio-mirror-drawer-list">
                {archive.map((l) => {
                  const m = MIRRORS.find((x) => x.id === l.mirrorId);
                  const t = MIRROR_TOPICS.find((x) => x.id === (l.topic || 'all'));
                  const isCurrent = l.mirrorId === mirrorId && l.month === month && (l.topic || 'all') === topic;
                  return (
                    <button key={mirrorLetterKey(l.month, l.mirrorId, l.topic || 'all')} type="button" className="nesio-mirror-drawer-item" onClick={() => openArchived(l)}>
                      <span className="nesio-mirror-drawer-item-icon" aria-hidden><IconHistory size={15} /></span>
                      <span className="nesio-mirror-drawer-item-body">
                        <span className="nesio-mirror-drawer-item-title">
                          {monthLabelOf(l.month, dict)} · {L(dict, m?.name ?? '', m?.nameEn ?? '')} · {L(dict, t?.name ?? '', t?.nameEn ?? '')}
                        </span>
                        <span className="nesio-mirror-drawer-item-snip">
                          {isCurrent ? L(dict, '当前这封', 'Current') : (l.paragraphs[0]?.text.slice(0, 22) ?? '')}
                        </span>
                      </span>
                      <span className="nesio-mirror-drawer-item-date">
                        {new Date(l.generatedAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric' })}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
