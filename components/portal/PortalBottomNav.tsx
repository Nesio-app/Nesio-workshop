'use client';

import Link from 'next/link';
import { withBase } from '@/lib/portal/paths';
import { t } from '@/lib/portal/i18n';
import { loadProfileSettings } from '@/lib/portal/profile';
import type { PortalLocale } from '@/lib/portal/profile';

interface PortalBottomNavProps {
  noteOpen?: boolean;
  treasureOpen?: boolean;
  onHome: () => void;
  onOpenNote: () => void;
  onOpenTodo: () => void;
}

export default function PortalBottomNav({
  noteOpen = false,
  treasureOpen = false,
  onHome,
  onOpenNote,
  onOpenTodo,
}: PortalBottomNavProps) {
  const locale: PortalLocale = loadProfileSettings().locale;

  return (
    <nav className="portal-bottom-nav" aria-label={t(locale, 'portalBottomNavLabel')}>
      <button
        type="button"
        className={
          'portal-bottom-nav-btn' + (treasureOpen ? ' portal-bottom-nav-btn--active' : '')
        }
        onClick={onHome}
        aria-label={t(locale, 'portalBottomNavHome')}
        aria-expanded={treasureOpen}
      >
        <img
          className="portal-bottom-nav-icon portal-bottom-nav-icon--svg"
          src={withBase('/icons/treasurebox.svg')}
          alt=""
          width={24}
          height={24}
        />
      </button>
      <button
        type="button"
        className={
          'portal-bottom-nav-btn' + (noteOpen ? ' portal-bottom-nav-btn--active' : '')
        }
        onClick={onOpenNote}
        aria-label={t(locale, 'portalBottomNavNote')}
        aria-expanded={noteOpen}
      >
        <span className="portal-bottom-nav-icon portal-icon-blue" aria-hidden>
          📝
        </span>
      </button>
      <button
        type="button"
        className="portal-bottom-nav-btn"
        onClick={onOpenTodo}
        aria-label={t(locale, 'portalBottomNavTodo')}
      >
        <span className="portal-bottom-nav-icon portal-icon-blue" aria-hidden>
          ✅
        </span>
      </button>
      <Link
        href={withBase('/settings')}
        className="portal-bottom-nav-btn"
        aria-label={t(locale, 'portalBottomNavMe')}
      >
        <span className="portal-bottom-nav-icon portal-icon-blue" aria-hidden>
          👤
        </span>
      </Link>
    </nav>
  );
}
