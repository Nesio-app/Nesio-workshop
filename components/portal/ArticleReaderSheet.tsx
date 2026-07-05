'use client';

/**
 * ArticleReaderSheet — ADHD 友好的阅读器(批次 24)。
 * 设计:大字、宽行距、窄栏、段落分块;当前段高亮、其余轻度淡出,
 * 减少一眼扫到整屏的压迫感;字号可调。数据是节点里存的 article 全文。
 */

import { useMemo, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

export default function ArticleReaderSheet({ title, article, onClose }: {
  title: string;
  article: string;
  onClose: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [fontStep, setFontStep] = useState(1); // 0 小 / 1 中 / 2 大
  const [focusMode, setFocusMode] = useState(false);
  const [activePara, setActivePara] = useState(0);

  const paragraphs = useMemo(
    () => article.split(/\n{1,}/).map((p) => p.trim()).filter((p) => p.length > 0),
    [article],
  );

  const fontSize = [1.0, 1.15, 1.35][fontStep];

  return (
    <div className="nesio-reader-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="nesio-reader-topbar">
        <button type="button" className="nesio-reader-btn" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        <div className="nesio-reader-tools">
          <button type="button" className="nesio-reader-btn" onClick={() => setFontStep((v) => Math.max(0, v - 1))} aria-label={L(dict, '缩小字号', 'Smaller text')}>A−</button>
          <button type="button" className="nesio-reader-btn" onClick={() => setFontStep((v) => Math.min(2, v + 1))} aria-label={L(dict, '放大字号', 'Bigger text')}>A+</button>
          <button
            type="button"
            className={`nesio-reader-btn${focusMode ? ' is-active' : ''}`}
            onClick={() => setFocusMode((v) => !v)}
          >
            {L(dict, '专注', 'Focus')}
          </button>
        </div>
      </div>

      <div className="nesio-reader-scroll">
        <h1 className="nesio-reader-title" style={{ fontSize: `${fontSize * 1.4}rem` }}>{title}</h1>
        <div className="nesio-reader-body" style={{ fontSize: `${fontSize}rem` }}>
          {paragraphs.map((p, i) => (
            <p
              key={i}
              className={`nesio-reader-para${focusMode ? (i === activePara ? ' is-focus' : ' is-dim') : ''}`}
              onClick={() => setActivePara(i)}
            >
              {p}
            </p>
          ))}
        </div>
        {focusMode && (
          <div className="nesio-reader-focus-nav">
            <button type="button" className="nesio-reader-btn" onClick={() => setActivePara((v) => Math.max(0, v - 1))}>↑</button>
            <span>{activePara + 1} / {paragraphs.length}</span>
            <button type="button" className="nesio-reader-btn" onClick={() => setActivePara((v) => Math.min(paragraphs.length - 1, v + 1))}>↓</button>
          </div>
        )}
      </div>
    </div>
  );
}
