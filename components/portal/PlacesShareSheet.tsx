'use client';

/**
 * PlacesShareSheet — 足迹成就卡预览 + 「分享到」。
 *
 * 展示原创分享卡(灰粉浅 / 夜深 可切,同一套 token),点「分享」弹出目的地面板。
 * 存图走 SVG 序列化 → canvas 光栅化 → PNG(色值已内联,不含 var(),不联网、不含实时定位)。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import PlacesShareCard, { SHARE_CARD_W, SHARE_CARD_H } from './PlacesShareCard';
import ShareToSheet from './ShareToSheet';
import { resolveShareTokens, type PlacesShareStats, type ShareCardColors } from '@/lib/portal/places-share';

export default function PlacesShareSheet({ stats, onClose }: { stats: PlacesShareStats; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const svgRef = useRef<SVGSVGElement>(null);
  const [theme, setTheme] = useState<'day' | 'night'>(() => {
    if (typeof document === 'undefined') return 'day';
    return document.documentElement.getAttribute('data-portal-theme') === 'night' ? 'night' : 'day';
  });
  const [colors, setColors] = useState<ShareCardColors>(() => resolveShareTokens(theme));
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => { setColors(resolveShareTokens(theme)); }, [theme]);

  const shareText = useMemo(
    () => L(dict, `我的足迹 · ${stats.year} 起:去过 ${stats.countries} 国 · ${stats.continents} 洲。#Nesio`,
      `Where I've been since ${stats.year}: ${stats.countries} countries · ${stats.continents} continents. #Nesio`),
    [dict, stats],
  );

  async function rasterize(): Promise<Blob | null> {
    const svg = svgRef.current;
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
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((b) => resolve(b), 'image/png');
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
          <div className="nesio-placeshare-seg" role="tablist" aria-label={L(dict, '主题', 'Theme')}>
            <button type="button" role="tab" aria-selected={theme === 'day'}
              className={`nesio-placeshare-seg-btn${theme === 'day' ? ' is-active' : ''}`} onClick={() => setTheme('day')}>
              {L(dict, '灰粉', 'Light')}
            </button>
            <button type="button" role="tab" aria-selected={theme === 'night'}
              className={`nesio-placeshare-seg-btn${theme === 'night' ? ' is-active' : ''}`} onClick={() => setTheme('night')}>
              {L(dict, '夜', 'Dark')}
            </button>
          </div>
          <button type="button" className="nesio-placeshare-x" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="nesio-placeshare-cardwrap" style={{ aspectRatio: `${SHARE_CARD_W} / ${SHARE_CARD_H}` }}>
          <PlacesShareCard ref={svgRef} stats={stats} colors={colors} />
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
      />
    </div>
  );
}
