'use client';

import { useRef } from 'react';
import NesioMark from './NesioMark';
import type { PortalLocale } from '@/lib/portal/profile';
import { L, t } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';

interface PortalBottomNavProps {
  activeSurface: 'today' | 'tell' | 'memory';
  locale?: PortalLocale;
  onToday: () => void;
  onTell: () => void;
  onAsk?: () => void;
  onInsights: () => void;
  insightsActive?: boolean;
  onChatOpen: () => void;
}

const LONG_PRESS_MS = 450;

export default function PortalBottomNav({
  activeSurface,
  locale = 'zh',
  onToday,
  onTell,
  onInsights,
  insightsActive = false,
  onChatOpen,
}: PortalBottomNavProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const startPress = (e: React.PointerEvent) => {
    e.preventDefault();
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      navigator.vibrate?.(12);
      onChatOpen();
    }, LONG_PRESS_MS);
  };

  const endPress = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!firedRef.current) onTell();
    firedRef.current = false;
  };

  const cancelPress = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    firedRef.current = false;
  };

  return (
    <nav className="nesio-bottom-nav" aria-label={L(portalLocaleToDictionaryLocale(locale), '主导航', 'Main navigation')}>
      {/* Today */}
      <button
        type="button"
        data-tour="today"
        className={`nesio-bottom-nav-btn${activeSurface === 'today' ? ' nesio-bottom-nav-btn--active' : ''}`}
        onClick={onToday}
        aria-label="Today"
        aria-current={activeSurface === 'today' ? 'page' : undefined}
      >
        <svg className="nesio-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="8.25" />
          <path d="M12 7.5V12l3 2.2" />
        </svg>
        <span className="nesio-bottom-nav-label">{t(locale, 'navToday')}</span>
      </button>

      {/* Nesio center button — tap = 输入, long-press = 问一问 */}
      <button
        type="button"
        data-tour="center"
        className="nesio-bottom-nav-center"
        aria-label={L(portalLocaleToDictionaryLocale(locale), '记录 / 问一问', 'Capture / Ask')}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* 批次 13:白底 PWA PNG 换成无底色矢量 logo,昼夜双资产 */}
        <NesioMark className="nesio-bottom-nav-center-icon" />
      </button>

      {/* Insights — 全屏浮层(洞察),非 surface;点开由 Portal 渲染 */}
      <button
        type="button"
        data-tour="insights"
        className={`nesio-bottom-nav-btn${insightsActive ? ' nesio-bottom-nav-btn--active' : ''}`}
        onClick={onInsights}
        aria-label={L(portalLocaleToDictionaryLocale(locale), '洞察', 'Insights')}
        aria-current={insightsActive ? 'page' : undefined}
      >
        {/* 宝盒晶体:多切面钻石,呼应品牌,区别于今天(钟)/记忆(立方) */}
        <svg className="nesio-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 3h12l3 5-9 13L3 8z" />
          <path d="M3 8h18M9 3 7.5 8 12 21M15 3l1.5 5L12 21" />
        </svg>
        <span className="nesio-bottom-nav-label">{t(locale, 'navInsights')}</span>
      </button>
    </nav>
  );
}
