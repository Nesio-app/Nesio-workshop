'use client';

/**
 * PlacesShareSheet — 足迹成就卡预览 + 「分享到」。
 *
 * 多个模版横滑切换(灰粉浅 / 夜深,同一套 token);卡片文案随设置语言。
 * 存图:SVG 序列化 → canvas 光栅化 → JPG(色值已内联,不含 var(),不联网、不含实时定位),
 * 优先走系统分享(iOS 可「存储图像」到相册),不行再下载。
 */

import { useMemo, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import PlacesShareCard, { SHARE_CARD_W, SHARE_CARD_H } from './PlacesShareCard';
import ShareToSheet from './ShareToSheet';
import { resolveShareTokens, type PlacesShareStats } from '@/lib/portal/places-share';

const TEMPLATES = ['day', 'night'] as const;

export default function PlacesShareSheet({ stats, onClose }: { stats: PlacesShareStats; onClose: () => void }) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const zh = locale === 'zh';
  const cardRefs = useRef<(SVGSVGElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startTheme = typeof document !== 'undefined' && document.documentElement.getAttribute('data-portal-theme') === 'night' ? 1 : 0;
  const [idx, setIdx] = useState(startTheme);
  const [shareOpen, setShareOpen] = useState(false);

  const colorsAll = useMemo(() => TEMPLATES.map((t) => resolveShareTokens(t)), []);

  const shareText = useMemo(
    () => (zh ? `我的足迹 · ${stats.year} 起:去过 ${stats.countries} 国 · ${stats.continents} 洲。#Nesio`
      : `Where I've been since ${stats.year}: ${stats.countries} countries · ${stats.continents} continents. #Nesio`),
    [zh, stats],
  );

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== idx && i >= 0 && i < TEMPLATES.length) setIdx(i);
  }

  async function rasterize(): Promise<Blob | null> {
    const svg = cardRefs.current[idx];
    if (!svg || typeof window === 'undefined') return null;
    try {
      const xml = new XMLSerializer().serializeToString(svg);
      const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
      const scale = 3;
      return await new Promise<Blob | null>((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = SHARE_CARD_W * scale;
            canvas.height = SHARE_CARD_H * scale;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(null); return; }
            ctx.fillStyle = colorsAll[idx].cardBg; // JPG 无透明 —— 卡底铺满,圆角处不发黑
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
          } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
    } catch { return null; }
  }

  return (
    <div className="nesio-placeshare-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '分享足迹', 'Share your footprint')}>
      <button type="button" className="nesio-placeshare-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-placeshare-body">
        <div className="nesio-placeshare-toolbar">
          <span className="nesio-placeshare-hint">{L(dict, '左右滑动换模版', 'Swipe for more templates')}</span>
          <button type="button" className="nesio-placeshare-x" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {/* 横滑模版轮播 */}
        <div className="nesio-placeshare-cards" ref={scrollRef} onScroll={onScroll}>
          {TEMPLATES.map((t, i) => (
            <div className="nesio-placeshare-slide" key={t} style={{ aspectRatio: `${SHARE_CARD_W} / ${SHARE_CARD_H}` }}>
              <PlacesShareCard ref={(el) => { cardRefs.current[i] = el; }} stats={stats} colors={colorsAll[i]} zh={zh} />
            </div>
          ))}
        </div>
        <div className="nesio-placeshare-dots" aria-hidden>
          {TEMPLATES.map((t, i) => <span key={t} className={`nesio-placeshare-dot${i === idx ? ' is-on' : ''}`} />)}
        </div>

        <button type="button" className="nesio-placeshare-cta" onClick={() => setShareOpen(true)}>
          {L(dict, '分享', 'Share')}
        </button>
      </div>

      <ShareToSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        getBlob={rasterize}
        shareText={shareText}
        link="https://nesio.app"
        fileBase={`nesio-places-${stats.year}`}
        mime="image/jpeg"
      />
    </div>
  );
}
