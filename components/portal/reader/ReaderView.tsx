'use client';

/**
 * ReaderView — 内置阅读器(批次 26 起;设计稿「阅读器·多功能版/聚焦版」对齐重做)。
 *
 * 两种模式,头部一键切:
 *  · 多功能版(默认)—— 暖纸宋体正文 + 封面图/来源徽章/署名/标签/相关记忆 + 底部动作栏(圈选/问念念/收进记忆)。
 *  · 聚焦版(沉浸)—— 只剩正文:去封面/标签/相关/底栏,字更大行更疏,左侧一道细进度,点一下唤出最小控制。
 * 划词浮层:收进记忆 / 问念念 / 高亮 / 复制。「圈选」= 进入选读:划到哪高亮到哪。
 *
 * 功能以现有为准:收进记忆=ingestLifeNode、问念念=聊天(nesio-ask-text)、复制=剪贴板、
 * 高亮=本地标记(reader-highlights)、字号/目录/搜本书 沿用。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ReaderBook } from '@/lib/portal/adhd-reader';
import { getReaderProgress, setReaderProgress } from '@/lib/portal/reader-store-idb';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { loadHighlights, toggleHighlight, addHighlight, segmentParagraph, READER_HIGHLIGHTS_EVENT } from '@/lib/portal/reader-highlights';
import { IconBox, IconTarget, IconHelpCircle } from '../icons';
import NesioSheet from '../ui/NesioSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const FONT_SCALES = [0.9, 1, 1.15, 1.3];
const BM_KEY = 'nesio-reader-bookmarks-v1';
type Mode = 'full' | 'focus';
interface Bookmark { p: number; text: string }

/** 阅读器可选元信息(多功能版用):来源徽章 / 署名 / 标签 / 相关记忆 / 封面。 */
export interface ReaderMeta {
  kicker?: string;        // 头部小标题「每日日报 · 07/13」
  subtitle?: string;      // 头部副标「念念写的 · 收进来」
  byline?: string;        // 署名行(不给则按字数估阅读时长)
  coverGradient?: string; // 封面占位渐变(给了才显示封面)
  coverBadge?: string;    // 封面徽章「邮件 · Your Day Ahead」
  tags?: string[];
  related?: Array<{ text: string }>;
}

const HEADING_RE = /^(第[一二三四五六七八九十百千零\d]+[章篇节部回]|chapter\s|part\s|#{1,3}\s|[#＃])/i;

export default function ReaderView({ book, rawText, meta, onClose }: {
  book: ReaderBook; rawText?: string; meta?: ReaderMeta; onClose: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const docId = book.id;

  const [mode, setMode] = useState<Mode>('full');
  const [fontStep, setFontStep] = useState(1);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [selText, setSelText] = useState('');
  const [selPos, setSelPos] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [markMode, setMarkMode] = useState(false);      // 圈选:选读模式(划到哪高亮到哪)
  const [controls, setControls] = useState(false);      // 聚焦版:点一下唤出最小控制
  const [scrollPct, setScrollPct] = useState(0);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
    try { return (JSON.parse(localStorage.getItem(BM_KEY) || '{}')[docId] as Bookmark[]) || []; } catch { return []; }
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  // 正文:优先原始文本(保留段落),否则从脱水书重组。
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

  // 阅读时长估算(中文 ~ 400 字/分),给默认署名行。
  const readMin = useMemo(() => Math.max(1, Math.round(paras.join('').length / 400)), [paras]);
  const byline = meta?.byline || L(dict, `${readMin} 分钟读完`, `${readMin} min read`);

  useEffect(() => {
    const load = () => setHighlights(loadHighlights(docId));
    load();
    window.addEventListener(READER_HIGHLIGHTS_EVENT, load);
    return () => window.removeEventListener(READER_HIGHLIGHTS_EVENT, load);
  }, [docId]);

  // 恢复上次滚动百分比(尽力而为)。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const p = getReaderProgress(docId).percent || 0;
    if (p > 2) requestAnimationFrame(() => { el.scrollTop = (el.scrollHeight - el.clientHeight) * (p / 100); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const readSelection = useCallback(() => {
    const s = typeof window !== 'undefined' ? window.getSelection() : null;
    const t = s && !s.isCollapsed ? s.toString().trim() : '';
    if (t.length < 2) { setSelText(''); setSelPos(null); return; }
    // 选读模式:直接高亮,不弹菜单
    if (markMode) {
      setHighlights(addHighlight(docId, t));
      s?.removeAllRanges();
      setSelText(''); setSelPos(null);
      flash(L(dict, '已高亮', 'Highlighted'));
      return;
    }
    let pos: { x: number; y: number } | null = null;
    try {
      const r = s!.getRangeAt(0).getBoundingClientRect();
      pos = { x: r.left + r.width / 2, y: r.top };
    } catch { pos = null; }
    setSelText(t);
    setSelPos(pos);
  }, [markMode, docId, dict]);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(''), 1500); }
  function clearSel() { window.getSelection()?.removeAllRanges(); setSelText(''); setSelPos(null); }

  // ── 划词浮层动作(选中态)──
  function saveSelectionToMemory() {
    const text = selText.trim();
    if (!text) return;
    ingestLifeNode({
      name: text.slice(0, 60), type: 'preference', source: 'manual', confidence: 1, rawInput: text,
      tags: ['笔记', '摘录', book.title.slice(0, 24)], attributes: { origin: '阅读摘录', fromArticle: book.title }, relations: [],
    });
    clearSel(); flash(L(dict, '已收进记忆', 'Saved to Memory'));
  }
  function askSelection() {
    const text = selText.trim();
    if (!text) return;
    window.dispatchEvent(new CustomEvent('nesio-ask-text', { detail: { text } }));
    clearSel();
  }
  function highlightSelection() {
    const text = selText.trim();
    if (!text) return;
    const { on } = toggleHighlight(docId, text);
    setHighlights(loadHighlights(docId));
    clearSel(); flash(on ? L(dict, '已高亮', 'Highlighted') : L(dict, '取消高亮', 'Highlight removed'));
  }
  function copySelection() {
    const text = selText.trim();
    if (!text) return;
    try { void navigator.clipboard?.writeText(text); } catch { /* ignore */ }
    clearSel(); flash(L(dict, '已复制', 'Copied'));
  }

  // ── 底部动作栏(文档级)──
  function saveDocToMemory() {
    const text = paras.join('\n\n').trim();
    if (!text) return;
    ingestLifeNode({
      name: book.title.slice(0, 60) || L(dict, '一篇阅读', 'A read'),
      type: 'preference', source: 'manual', confidence: 1, rawInput: text,
      tags: ['笔记', '阅读', book.title.slice(0, 24)],
      attributes: { origin: '阅读收藏', externalId: `read-${docId}` }, relations: [],
    });
    flash(L(dict, '已收进记忆', 'Saved to Memory'));
  }
  function askDoc() {
    window.dispatchEvent(new CustomEvent('nesio-ask-text', { detail: { text: book.title } }));
  }
  function toggleMarkMode() {
    setMarkMode((v) => { const nv = !v; flash(nv ? L(dict, '选读:划到哪高亮到哪', 'Mark mode: select to highlight') : L(dict, '退出选读', 'Mark mode off')); return nv; });
  }

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max > 0 ? Math.min(100, Math.round((el.scrollTop / max) * 100)) : 0;
    setScrollPct(pct);
    setReaderProgress(docId, { line: 0, percent: pct });
    if (selPos) clearSel();
  }, [docId, selPos]);

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
    try { const all = JSON.parse(localStorage.getItem(BM_KEY) || '{}'); all[docId] = next; localStorage.setItem(BM_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  }

  /** 渲染一个段落:按高亮片段切段套 <mark>。 */
  const renderPara = (p: string) => {
    if (!highlights.length) return p;
    return segmentParagraph(p, highlights).map((seg, j) => seg.mark
      ? <mark key={j} className="nesio-rd-mark">{seg.text}</mark>
      : <span key={j}>{seg.text}</span>);
  };

  const isFull = mode === 'full';

  return (
    <NesioSheet
      variant="fullscreen"
      open
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className={`nesio-rd-overlay nesio-rd-overlay--${mode}`}
      style={{ ['--nesio-rd-scale' as string]: String(FONT_SCALES[fontStep]) }}
      ariaLabel={book.title}
    >
      {/* ── 头部 ── */}
      <div className="nesio-rd-topbar">
        <button type="button" className="nesio-rd-btn" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        <div className="nesio-rd-head-mid">
          {isFull && (meta?.kicker || meta?.subtitle) ? (
            <>
              {meta?.kicker && <p className="nesio-rd-head-kicker">{meta.kicker}</p>}
              {meta?.subtitle && <p className="nesio-rd-head-sub">{meta.subtitle}</p>}
            </>
          ) : (
            !isFull ? null : <p className="nesio-rd-head-title">{book.title}</p>
          )}
        </div>
        <div className="nesio-rd-head-right">
          <button type="button" className="nesio-rd-mode" onClick={() => setMode((m) => (m === 'full' ? 'focus' : 'full'))}>
            {isFull ? L(dict, '切聚焦', 'Focus') : L(dict, '切多功能', 'Full')}
          </button>
          {isFull && (
            <div className="nesio-rd-tools" style={{ position: 'relative' }}>
              <button type="button" className={`nesio-rd-btn${toolsOpen ? ' is-active' : ''}`} onClick={() => setToolsOpen((v) => !v)} aria-expanded={toolsOpen} aria-label={L(dict, '阅读选项', 'Reading options')}>Aa</button>
              {toolsOpen && (
                <div className="nesio-rd-tools-menu">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <button type="button" className="nesio-rd-btn" onClick={() => setFontStep((v) => Math.max(0, v - 1))} aria-label={L(dict, '缩小字号', 'Smaller')}>A−</button>
                    <button type="button" className="nesio-rd-btn" onClick={() => setFontStep((v) => Math.min(FONT_SCALES.length - 1, v + 1))} aria-label={L(dict, '放大字号', 'Bigger')}>A+</button>
                  </div>
                  <button type="button" className="nesio-rd-btn" style={{ width: '100%' }} onClick={() => { setTocOpen((v) => !v); setSearchOpen(false); setToolsOpen(false); }}>{L(dict, '目录 / 书签', 'Contents')}</button>
                  <button type="button" className="nesio-rd-btn" style={{ width: '100%' }} onClick={() => { setSearchOpen((v) => !v); setTocOpen(false); setToolsOpen(false); }}>{L(dict, '搜本书', 'Search')}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 进度:多功能=顶部一道;聚焦=左侧一道细进度 */}
      {isFull
        ? <div className="nesio-rd-progress"><div className="nesio-rd-progress-fill" style={{ width: `${scrollPct}%` }} /></div>
        : <div className="nesio-rd-progress-left"><div className="nesio-rd-progress-left-fill" style={{ height: `${scrollPct}%` }} /></div>}

      {searchOpen && isFull && (
        <div className="nesio-rd-search">
          <input className="nesio-rd-search-input" value={query} autoFocus placeholder={L(dict, '在本篇里搜…', 'Search…')} onChange={(e) => setQuery(e.target.value)} />
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

      {/* ── 正文 ── */}
      <div
        className={`nesio-rd-scroll${markMode ? ' is-marking' : ''}`}
        ref={scrollRef} onScroll={onScroll} onMouseUp={readSelection} onTouchEnd={readSelection}
        onClick={() => { if (!isFull && (typeof window === 'undefined' || (window.getSelection()?.isCollapsed ?? true))) setControls((v) => !v); }}
      >
        <div className={`nesio-rd-doc${isFull ? '' : ' nesio-rd-doc--focus'}`}>
          {/* 封面(仅多功能且给了渐变) */}
          {isFull && meta?.coverGradient && (
            <div className="nesio-rd-cover" style={{ background: meta.coverGradient }}>
              {meta.coverBadge && <span className="nesio-rd-cover-badge">{meta.coverBadge}</span>}
            </div>
          )}
          {/* 标题 + 署名(多功能;聚焦只留标题,大字) */}
          <h1 className="nesio-rd-title">{book.title}</h1>
          {isFull && <p className="nesio-rd-byline">{byline}</p>}

          {paras.map((p, i) => {
            // 批次193:parse-url 提取的关键图片以 `![](url)` marker 单独成段 → 渲染成图片。
            const im = /^!\[[^\]]*\]\((https?:\/\/[^)\s]+|data:image\/[^)\s]+)\)$/.exec(p);
            if (im) return (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} data-p={i} className="nesio-rd-img" src={im[1]} alt="" loading="lazy"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            );
            return isHeading(p)
              ? <h3 key={i} data-p={i} className="nesio-rd-h">{p.replace(/^[#＃]+\s*/, '')}</h3>
              : <p key={i} data-p={i} className="nesio-rd-p">{renderPara(p)}</p>;
          })}

          {/* 标签 + 相关记忆(仅多功能) */}
          {isFull && meta?.tags && meta.tags.length > 0 && (
            <div className="nesio-rd-tags">
              {meta.tags.map((t, i) => <span key={i} className="nesio-rd-tag-chip"># {t}</span>)}
            </div>
          )}
          {isFull && meta?.related && meta.related.length > 0 && (
            <div className="nesio-rd-related">
              <p className="nesio-rd-related-h">{L(dict, `相关记忆 · ${meta.related.length}`, `Related · ${meta.related.length}`)}</p>
              {meta.related.slice(0, 3).map((r, i) => (
                <p key={i} className="nesio-rd-related-item"><span className="nesio-rd-related-dot" aria-hidden />{r.text}</p>
              ))}
            </div>
          )}

          <div className="nesio-rd-end">{L(dict, '— 读完了 —', '— End —')}</div>
        </div>
      </div>

      {/* ── 底部动作栏:多功能常驻;聚焦点一下才唤出最小控制 ── */}
      {(isFull || controls) && (
        <div className={`nesio-rd-actionbar${isFull ? '' : ' nesio-rd-actionbar--focus'}`}>
          <button type="button" className={`nesio-rd-action${markMode ? ' is-on' : ''}`} onClick={toggleMarkMode}>
            <span className="nesio-rd-action-ico" aria-hidden><IconTarget size={16} /></span>{L(dict, '圈选', 'Mark')}
          </button>
          <button type="button" className="nesio-rd-action" onClick={askDoc}>
            <span className="nesio-rd-action-ico" aria-hidden><IconHelpCircle size={16} /></span>{L(dict, '问念念', 'Ask')}
          </button>
          <button type="button" className="nesio-rd-action nesio-rd-action--primary" onClick={saveDocToMemory}>
            <span className="nesio-rd-action-ico" aria-hidden><IconBox size={16} /></span>{L(dict, '收进记忆', 'Save')}
          </button>
          {!isFull && (
            <button type="button" className="nesio-rd-action" onClick={() => setFontStep((v) => (v + 1) % FONT_SCALES.length)}>
              <span className="nesio-rd-action-ico" aria-hidden>Aa</span>
            </button>
          )}
        </div>
      )}

      {/* 目录 / 书签抽屉 */}
      {tocOpen && isFull && (
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

      {/* ── 划词浮层:收进记忆 / 问念念 / 高亮 / 复制 ── */}
      {selText && selPos && (
        <div className="nesio-rd-selmenu" style={{ left: `${selPos.x}px`, top: `${Math.max(56, selPos.y - 8)}px` }} role="menu">
          <button type="button" className="nesio-rd-selmenu-item" onClick={saveSelectionToMemory}>{L(dict, '收进记忆', 'Save')}</button>
          <button type="button" className="nesio-rd-selmenu-item" onClick={askSelection}>{L(dict, '问念念', 'Ask')}</button>
          <button type="button" className="nesio-rd-selmenu-item" onClick={highlightSelection}>{L(dict, '高亮', 'Highlight')}</button>
          <button type="button" className="nesio-rd-selmenu-item" onClick={copySelection}>{L(dict, '复制', 'Copy')}</button>
        </div>
      )}

      {toast && <div className="nesio-rd-toast">{toast}</div>}
    </NesioSheet>
  );
}
