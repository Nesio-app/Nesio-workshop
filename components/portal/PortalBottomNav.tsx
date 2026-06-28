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
}

export default function PortalBottomNav({
  activeSurface,
  onToday,
  onTell,
  onAsk,
  onMemory,
}: PortalBottomNavProps) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  function clearLongPressTimer() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function startLongPress() {
    longPressFired.current = false;
    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onAsk?.();
    }, 520);
  }

  function finishLongPress() {
    clearLongPressTimer();
  }

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

      {/* Nesio center button */}
      <button
        type="button"
        className={`nesio-bottom-nav-center${activeSurface === 'tell' ? ' nesio-bottom-nav-center--active' : ''}`}
        onPointerDown={startLongPress}
        onPointerUp={finishLongPress}
        onPointerCancel={finishLongPress}
        onPointerLeave={finishLongPress}
        onClick={() => {
          if (longPressFired.current) {
            longPressFired.current = false;
            return;
          }
          onTell();
        }}
        aria-label="告诉 Nesio；长按提问"
        aria-expanded={activeSurface === 'tell'}
      >
        <img
          src="/icons/treasurebox-pwa-192.png"
          alt=""
          className="nesio-bottom-nav-center-icon"
          aria-hidden
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
