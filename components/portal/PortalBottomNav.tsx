'use client';

import { useRef } from 'react';
import type { PortalLocale } from '@/lib/portal/profile';

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
    <nav className="nesio-bottom-nav" aria-label="主导航">
      {/* Today */}
      <button
        type="button"
        className={`nesio-bottom-nav-btn${activeSurface === 'today' ? ' nesio-bottom-nav-btn--active' : ''}`}
        onClick={onToday}
        aria-label="Today"
        aria-current={activeSurface === 'today' ? 'page' : undefined}
      >
        <svg className="nesio-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="9.5" />
          <polyline points="12 6.5 12 12 15.5 15.5" />
        </svg>
        <span className="nesio-bottom-nav-label">Today</span>
      </button>

      {/* Nesio center button — tap = 输入, long-press = 问一问 */}
      <button
        type="button"
        className="nesio-bottom-nav-center"
        aria-label="记录 / 问一问"
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
        <svg className="nesio-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M21 8.5L12 3 3 8.5v7L12 21l9-5.5z" />
          <path d="M12 3v18M3 8.5l9 5.5 9-5.5" />
        </svg>
        <span className="nesio-bottom-nav-label">Memory</span>
      </button>
    </nav>
  );
}
