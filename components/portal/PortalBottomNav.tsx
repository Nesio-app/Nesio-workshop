'use client';

import { useRef } from 'react';
import type { PortalLocale } from '@/lib/portal/profile';
import { L, t } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';

interface PortalBottomNavProps {
  activeSurface: 'today' | 'tell' | 'memory';
  locale?: PortalLocale;
  onToday: () => void;
  onTell: () => void;
  onAsk?: () => void;
  onMemory: () => void;
  onChatOpen: () => void;
}

const LONG_PRESS_MS = 450;

export default function PortalBottomNav({
  activeSurface,
  locale = 'zh',
  onToday,
  onTell,
  onMemory,
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
        className="nesio-bottom-nav-center"
        aria-label={L(portalLocaleToDictionaryLocale(locale), '记录 / 问一问', 'Capture / Ask')}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
      >
        <img
          src="/icons/treasurebox-pwa-192.png"
          alt=""
          className="nesio-bottom-nav-center-icon"
          aria-hidden
          draggable={false}
        />
      </button>

      {/* Memory */}
      <button
        type="button"
        className={`nesio-bottom-nav-btn${activeSurface === 'memory' ? ' nesio-bottom-nav-btn--active' : ''}`}
        onClick={onMemory}
        aria-label="Memory"
        aria-current={activeSurface === 'memory' ? 'page' : undefined}
      >
        <svg className="nesio-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 8.2 12 4l8 4.2M4 8.2v9L12 21l8-3.8v-9M4 8.2 12 12.4l8-4.2M12 12.4V21" />
        </svg>
        <span className="nesio-bottom-nav-label">{t(locale, 'navMemory')}</span>
      </button>
    </nav>
  );
}
