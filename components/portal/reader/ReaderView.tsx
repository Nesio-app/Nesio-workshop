'use client';

/**
 * ReaderView — 神经友好瀑布流阅读器(批次 26,移植自 reading-ios)。
 *
 * 渲染一本 ReaderBook:每行一个逻辑要点、bionic 首字加粗、卡拉OK 焦点遮罩
 * (当前行成卡高亮,已读行淡出),动作句打 ⚡ 标,前情提要泡泡点开,公式独立成卡。
 * 去掉了原版的积分/多巴胺商店/知识对撞等游戏化 —— Nesio 只要「友好读我的内容」。
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flatLines, type FlatLine, type ReaderBook } from '@/lib/portal/adhd-reader';
import { getReaderProgress, setReaderProgress } from '@/lib/portal/reader-store-idb';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const FONT_SCALES = [0.9, 1, 1.15];

/** bionic 加粗:中文整字加粗,英文单词前 ~45% 加粗,数字/标点加粗。 */
function BionicText({ text }: { text: string }) {
  const tokens = useMemo(
    () => text.match(/[一-鿿]|[a-zA-Z]+(?:'[a-z]+)?|\d+(?:\.\d+)?%?|[^\s]/g) || [text],
    [text],
  );
  return (
    <>
      {tokens.map((tok, i) => {
        if (/^[一-鿿]$/.test(tok)) {
          return <span key={i} className="nesio-rd-bb">{tok}</span>;
        }
        if (/^[a-zA-Z]/.test(tok)) {
          const cut = Math.max(1, Math.ceil(tok.length * 0.45));
          return (
            <Fragment key={i}>
              <span className="nesio-rd-bb">{tok.slice(0, cut)}</span>
              <span className="nesio-rd-bn">{tok.slice(cut)}</span>
            </Fragment>
          );
        }
        return <span key={i} className="nesio-rd-bb">{tok}</span>;
      })}
    </>
  );
}

export default function ReaderView({ book, onClose }: { book: ReaderBook; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const lines = useMemo<FlatLine[]>(() => flatLines(book), [book]);

  const [active, setActive] = useState(() => Math.min(getReaderProgress(book.id).line || 0, Math.max(0, lines.length - 1)));
  const [fontStep, setFontStep] = useState(1);
  const [mask, setMask] = useState(true); // 卡拉OK 焦点遮罩
  const [openBubble, setOpenBubble] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const restoredRef = useRef(false);

  const commitActive = useCallback((idx: number) => {
    setActive(idx);
    const percent = lines.length ? Math.round((idx / lines.length) * 100) : 0;
    setReaderProgress(book.id, { line: idx, percent });
  }, [book.id, lines.length]);

  // 恢复上次阅读位置:滚到已存的行
  useEffect(() => {
    if (restoredRef.current || !scrollRef.current) return;
    restoredRef.current = true;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 滚动时按「离锚点最近」推进当前行(卡拉OK 效果)
  const onScroll = useCallback(() => {
    if (!mask) return;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const container = scrollRef.current;
      if (!container) return;
      const anchor = container.getBoundingClientRect().top + 120;
      let best = 0;
      let minD = Infinity;
      container.querySelectorAll<HTMLElement>('[data-line]').forEach((el) => {
        const d = Math.abs(el.getBoundingClientRect().top - anchor);
        if (d < minD) {
          minD = d;
          best = Number(el.dataset.line);
        }
      });
      commitActive(best);
    });
  }, [mask, commitActive]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const cur = lines[active];
  const chapterLabel = cur ? `${cur.chapterTitle}${cur.sectionTitle ? ` · ${cur.sectionTitle}` : ''}` : '';
  const percent = lines.length ? Math.round((active / lines.length) * 100) : 0;

  return (
    <div
      className="nesio-rd-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={book.title}
      style={{ ['--nesio-rd-scale' as string]: String(FONT_SCALES[fontStep]) }}
    >
      <div className="nesio-rd-topbar">
        <button type="button" className="nesio-rd-btn" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        <div className="nesio-rd-head-mid">
          <p className="nesio-rd-head-title">{book.title}</p>
          <p className="nesio-rd-head-sub">{chapterLabel || `${percent}%`}</p>
        </div>
        <div className="nesio-rd-tools">
          <button type="button" className="nesio-rd-btn" onClick={() => setFontStep((v) => Math.max(0, v - 1))} aria-label={L(dict, '缩小字号', 'Smaller text')}>A−</button>
          <button type="button" className="nesio-rd-btn" onClick={() => setFontStep((v) => Math.min(2, v + 1))} aria-label={L(dict, '放大字号', 'Bigger text')}>A+</button>
          <button
            type="button"
            className={`nesio-rd-btn${mask ? ' is-active' : ''}`}
            onClick={() => setMask((v) => !v)}
            aria-pressed={mask}
          >
            {L(dict, '专注', 'Focus')}
          </button>
        </div>
      </div>

      <div className="nesio-rd-progress"><div className="nesio-rd-progress-fill" style={{ width: `${percent}%` }} /></div>

      <div className="nesio-rd-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className={`nesio-rd-col${mask ? ' has-mask' : ''}`}>
          {lines.map((line, i) => {
            const state = !mask ? '' : i < active ? ' is-dim' : i === active ? ' is-act' : '';
            if (line.kind === 'formula') {
              return (
                <div key={i} data-line={i} className={`nesio-rd-line${state}`} onClick={() => commitActive(i)}>
                  <div className="nesio-rd-math">
                    <div className="nesio-rd-math-lbl">{L(dict, '公式', 'Formula')}</div>
                    {line.formula || ''}
                  </div>
                </div>
              );
            }
            return (
              <div key={i} data-line={i} className={`nesio-rd-line${state}`}>
                <div
                  className="nesio-rd-lt"
                  onClick={() => {
                    if (line.bubble) { setOpenBubble((v) => (v === i ? null : i)); return; }
                    commitActive(i);
                  }}
                >
                  {line.tag && <span className="nesio-rd-tag">{line.tag}</span>}
                  <BionicText text={line.text || ''} />
                </div>
                {line.bubble && openBubble === i && (
                  <div className="nesio-rd-bubble">
                    <div className="nesio-rd-bubble-tag">{L(dict, '前情提要', 'Recall')}</div>
                    {line.bubble}
                  </div>
                )}
              </div>
            );
          })}
          <div className="nesio-rd-end">{L(dict, '— 读完了 —', '— End —')}</div>
        </div>
      </div>
    </div>
  );
}
