'use client';

/**
 * ReaderView — 阅读器(批次 26 起,批次 32 加「多功能版」)。
 *
 * 两种模式,顶部一键切:
 *  · 多功能版(默认)—— 正常段落排版 + 目录 + 听(TTS)+ 书签 + 搜本书 + 字号(像微信读书)
 *  · 聚焦版 —— 神经友好瀑布流:每行一个要点 + 卡拉OK 焦点遮罩
 * 两种模式都能划词「存为笔记」进记忆。邮件正文经引擎脱水后同样能读。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSheetDismiss } from '@/lib/portal/use-sheet-dismiss';
import { flatLines, type FlatLine, type ReaderBook } from '@/lib/portal/adhd-reader';
import { getReaderProgress, setReaderProgress } from '@/lib/portal/reader-store-idb';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const FONT_SCALES = [0.9, 1, 1.15, 1.3];
const BM_KEY = 'nesio-reader-bookmarks-v1';
type Mode = 'full' | 'focus';
type TtsState = 'idle' | 'loading' | 'playing';
interface Bookmark { p: number; text: string }

const HEADING_RE = /^(第[一二三四五六七八九十百千零\d]+[章篇节部回]|chapter\s|part\s|#{1,3}\s|[#＃])/i;

export default function ReaderView({ book, rawText, onClose }: { book: ReaderBook; rawText?: string; onClose: () => void }) {
  useSheetDismiss(onClose);
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const lines = useMemo<FlatLine[]>(() => flatLines(book), [book]);

  const [mode, setMode] = useState<Mode>('full');
  const [active, setActive] = useState(() => Math.min(getReaderProgress(book.id).line || 0, Math.max(0, lines.length - 1)));
  const [fontStep, setFontStep] = useState(1);
  const [mask, setMask] = useState(true);
  const [openBubble, setOpenBubble] = useState<number | null>(null);
  const [selText, setSelText] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [tts, setTts] = useState<TtsState>('idle');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
    try { return (JSON.parse(localStorage.getItem(BM_KEY) || '{}')[book.id] as Bookmark[]) || []; } catch { return []; }
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const restoredRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 多功能版正文:优先原始文本(保留段落),否则从脱水书重组。
  const paras = useMemo(() => {
    const text = (rawText || book.chapters.flatMap((ch) => [ch.title, ...ch.sections.flatMap((s) => s.lines.filter((l) => l.text).map((l) => l.text as string))]).join('\n\n')).trim();
    const byDouble = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
    return byDouble.length > 1 ? byDouble : text.split(/\n/).map((s) => s.trim()).filter(Boolean);
  }, [rawText, book]);
  const isHeading = (s: string) => s.length <= 40 && HEADING_RE.test(s);
  const toc = useMemo(() => paras.map((b, i) => ({ i, b })).filter((x) => isHeading(x.b)).slice(0, 80), [paras]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q.length < 2 ? [] : paras.map((b, i) => ({ i, b })).filter((x) => x.b.toLowerCase().includes(q)).slice(0, 50);
  }, [query, paras]);

  const readSelection = useCallback(() => {
    const s = typeof window !== 'undefined' ? window.getSelection() : null;
    const t = s && !s.isCollapsed ? s.toString().trim() : '';
    setSelText(t.length >= 2 ? t : '');
  }, []);

  function saveNote() {
    const text = selText.trim();
    if (!text) return;
    ingestLifeNode({
      name: text.slice(0, 60), type: 'preference', source: 'manual', confidence: 1, rawInput: text,
      tags: ['笔记', '摘录', book.title.slice(0, 24)], attributes: { origin: '阅读摘录', fromArticle: book.title }, relations: [],
    });
    setNoteSaved(true);
    window.getSelection()?.removeAllRanges();
    setSelText('');
    setTimeout(() => setNoteSaved(false), 1600);
  }

  const commitActive = useCallback((idx: number) => {
    setActive(idx);
    setReaderProgress(book.id, { line: idx, percent: lines.length ? Math.round((idx / lines.length) * 100) : 0 });
  }, [book.id, lines.length]);

  useEffect(() => {
    if (restoredRef.current || !scrollRef.current || mode !== 'focus') return;
    restoredRef.current = true;
    scrollRef.current.querySelector<HTMLElement>(`[data-line="${active}"]`)?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const onScroll = useCallback(() => {
    if (mode !== 'focus' || !mask || rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const container = scrollRef.current;
      if (!container) return;
      const anchor = container.getBoundingClientRect().top + 120;
      let best = 0, minD = Infinity;
      container.querySelectorAll<HTMLElement>('[data-line]').forEach((el) => {
        const d = Math.abs(el.getBoundingClientRect().top - anchor);
        if (d < minD) { minD = d; best = Number(el.dataset.line); }
      });
      commitActive(best);
    });
  }, [mode, mask, commitActive]);

  function stopTts() { audioRef.current?.pause(); audioRef.current = null; if (typeof window !== 'undefined') window.speechSynthesis?.cancel(); }
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); stopTts(); }, []);

  function browserTts(text: string) {
    if (typeof window === 'undefined' || !window.speechSynthesis) { setTts('idle'); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 3000));
    u.lang = /[一-鿿]/.test(text) ? 'zh-CN' : 'en-US';
    u.onend = () => setTts('idle');
    window.speechSynthesis.speak(u);
    setTts('playing');
  }
  async function toggleTts() {
    if (tts === 'playing') { stopTts(); setTts('idle'); return; }
    setTts('loading');
    const text = paras.join(' ').slice(0, 4000);
    try {
      const res = await fetch('/api/portal/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: 'nova', speed: 1.05 }) });
      if (res.ok && res.headers.get('content-type')?.includes('audio')) {
        const url = URL.createObjectURL(await res.blob());
        const a = new Audio(url); audioRef.current = a;
        a.onended = () => { setTts('idle'); URL.revokeObjectURL(url); };
        a.onerror = () => browserTts(text);
        await a.play(); setTts('playing'); return;
      }
      browserTts(text);
    } catch { browserTts(text); }
  }

  function jumpToPara(i: number) {
    setTocOpen(false); setSearchOpen(false);
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-p="${i}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
  function addBookmark() {
    const container = scrollRef.current;
    if (!container) return;
    const anchor = container.getBoundingClientRect().top + 80;
    let best = 0, minD = Infinity;
    container.querySelectorAll<HTMLElement>('[data-p]').forEach((el) => {
      const d = Math.abs(el.getBoundingClientRect().top - anchor);
      if (d < minD) { minD = d; best = Number(el.dataset.p); }
    });
    if (bookmarks.some((b) => b.p === best)) return;
    const next = [...bookmarks, { p: best, text: (paras[best] || '').slice(0, 30) }].sort((a, b) => a.p - b.p);
    setBookmarks(next);
    try { const all = JSON.parse(localStorage.getItem(BM_KEY) || '{}'); all[book.id] = next; localStorage.setItem(BM_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  }

  const percent = lines.length ? Math.round((active / lines.length) * 100) : 0;

  return (
    <div className="nesio-rd-overlay" role="dialog" aria-modal="true" aria-label={book.title} style={{ ['--nesio-rd-scale' as string]: String(FONT_SCALES[fontStep]) }}>
      <div className="nesio-rd-topbar">
        <button type="button" className="nesio-rd-btn" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        <div className="nesio-rd-head-mid">
          <p className="nesio-rd-head-title">{book.title}</p>
          <button type="button" className="nesio-rd-mode" onClick={() => setMode((m) => (m === 'full' ? 'focus' : 'full'))}>
            {mode === 'full' ? L(dict, '多功能版 · 切聚焦', 'Full · to Focus') : L(dict, '聚焦版 · 切多功能', 'Focus · to Full')}
          </button>
        </div>
        <div className="nesio-rd-tools">
          <button type="button" className="nesio-rd-btn" onClick={() => setFontStep((v) => Math.max(0, v - 1))} aria-label={L(dict, '缩小字号', 'Smaller')}>A−</button>
          <button type="button" className="nesio-rd-btn" onClick={() => setFontStep((v) => Math.min(FONT_SCALES.length - 1, v + 1))} aria-label={L(dict, '放大字号', 'Bigger')}>A+</button>
          {mode === 'full' ? (
            <>
              <button type="button" className="nesio-rd-btn" onClick={() => { setTocOpen((v) => !v); setSearchOpen(false); }} aria-label={L(dict, '目录', 'Contents')}>☰</button>
              <button type="button" className="nesio-rd-btn" onClick={() => { setSearchOpen((v) => !v); setTocOpen(false); }} aria-label={L(dict, '搜本书', 'Search')}>🔍</button>
              <button type="button" className={`nesio-rd-btn${tts !== 'idle' ? ' is-active' : ''}`} onClick={toggleTts} aria-label={L(dict, '听', 'Listen')}>{tts === 'loading' ? '…' : tts === 'playing' ? '⏸' : L(dict, '听', 'Listen')}</button>
            </>
          ) : (
            <button type="button" className={`nesio-rd-btn${mask ? ' is-active' : ''}`} onClick={() => setMask((v) => !v)} aria-pressed={mask}>{L(dict, '专注', 'Focus')}</button>
          )}
        </div>
      </div>

      <div className="nesio-rd-progress"><div className="nesio-rd-progress-fill" style={{ width: `${percent}%` }} /></div>

      {searchOpen && mode === 'full' && (
        <div className="nesio-rd-search">
          <input className="nesio-rd-search-input" value={query} autoFocus placeholder={L(dict, '在本书里搜…', 'Search this book…')} onChange={(e) => setQuery(e.target.value)} />
          {matches.length > 0 && <span className="nesio-rd-search-cnt">{matches.length}</span>}
        </div>
      )}
      {searchOpen && matches.length > 0 && (
        <div className="nesio-rd-search-results">
          {matches.slice(0, 8).map((m) => (
            <button key={m.i} type="button" className="nesio-rd-search-item" onClick={() => jumpToPara(m.i)}>{m.b.slice(0, 50)}…</button>
          ))}
        </div>
      )}

      <div className="nesio-rd-scroll" ref={scrollRef} onScroll={onScroll} onMouseUp={readSelection} onTouchEnd={readSelection}>
        {mode === 'full' ? (
          <div className="nesio-rd-fullcol">
            {paras.map((p, i) => isHeading(p)
              ? <h3 key={i} data-p={i} className="nesio-rd-h">{p.replace(/^[#＃]+\s*/, '')}</h3>
              : <p key={i} data-p={i} className="nesio-rd-p">{p}</p>)}
            <div className="nesio-rd-end">{L(dict, '— 读完了 —', '— End —')}</div>
          </div>
        ) : (
          <div className={`nesio-rd-col${mask ? ' has-mask' : ''}`}>
            {lines.map((line, i) => {
              const state = !mask ? '' : i < active ? ' is-dim' : i === active ? ' is-act' : '';
              if (line.kind === 'formula') {
                return <div key={i} data-line={i} className={`nesio-rd-line${state}`} onClick={() => commitActive(i)}><div className="nesio-rd-math"><div className="nesio-rd-math-lbl">{L(dict, '公式', 'Formula')}</div>{line.formula || ''}</div></div>;
              }
              return (
                <div key={i} data-line={i} className={`nesio-rd-line${state}`}>
                  <div className="nesio-rd-lt" onClick={() => { if (window.getSelection && !window.getSelection()?.isCollapsed) return; if (line.bubble) { setOpenBubble((v) => (v === i ? null : i)); return; } commitActive(i); }}>
                    {line.tag && <span className="nesio-rd-tag">{line.tag}</span>}
                    {line.text}
                  </div>
                  {line.bubble && openBubble === i && <div className="nesio-rd-bubble"><div className="nesio-rd-bubble-tag">{L(dict, '前情提要', 'Recall')}</div>{line.bubble}</div>}
                </div>
              );
            })}
            <div className="nesio-rd-end">{L(dict, '— 读完了 —', '— End —')}</div>
          </div>
        )}
      </div>

      {/* 目录 / 书签抽屉 */}
      {tocOpen && mode === 'full' && (
        <div className="nesio-rd-drawer">
          <button type="button" className="nesio-rd-drawer-backdrop" onClick={() => setTocOpen(false)} aria-label={L(dict, '关闭', 'Close')} />
          <div className="nesio-rd-drawer-panel">
            <div className="nesio-rd-drawer-head">
              <span>{L(dict, '目录', 'Contents')}</span>
              <button type="button" className="nesio-rd-btn" onClick={addBookmark}>{L(dict, '＋ 加书签', '＋ Bookmark')}</button>
            </div>
            {bookmarks.length > 0 && (
              <>
                <p className="nesio-rd-drawer-label">{L(dict, '书签', 'Bookmarks')}</p>
                {bookmarks.map((b) => <button key={`bm${b.p}`} type="button" className="nesio-rd-drawer-item is-bm" onClick={() => jumpToPara(b.p)}>{b.text}…</button>)}
              </>
            )}
            <p className="nesio-rd-drawer-label">{L(dict, '章节', 'Chapters')}</p>
            {toc.length > 0
              ? toc.map((t) => <button key={t.i} type="button" className="nesio-rd-drawer-item" onClick={() => jumpToPara(t.i)}>{t.b.replace(/^[#＃]+\s*/, '')}</button>)
              : <p className="nesio-rd-drawer-empty">{L(dict, '这篇没有分章节', 'No chapters in this text')}</p>}
          </div>
        </div>
      )}

      {(selText || noteSaved) && (
        <div className="nesio-rd-notebar">
          {noteSaved
            ? <span className="nesio-rd-notebar-ok">{L(dict, '✓ 已存入记忆', '✓ Saved to Memory')}</span>
            : <><span className="nesio-rd-notebar-text">{selText.length > 40 ? `${selText.slice(0, 40)}…` : selText}</span><button type="button" className="nesio-rd-notebar-btn" onClick={saveNote}>{L(dict, '存为笔记', 'Save note')}</button></>}
        </div>
      )}
    </div>
  );
}
