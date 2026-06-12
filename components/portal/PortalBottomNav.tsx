'use client';

import Link from 'next/link';
import { withBase } from '@/lib/portal/paths';

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
  return (
    <nav className="portal-bottom-nav" aria-label="主导航">
      <button
        type="button"
        className={
          'portal-bottom-nav-btn' + (treasureOpen ? ' portal-bottom-nav-btn--active' : '')
        }
        onClick={onHome}
        aria-label="宝盒"
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
        aria-label="Note"
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
        aria-label="待办"
      >
        <span className="portal-bottom-nav-icon portal-icon-blue" aria-hidden>
          ✅
        </span>
      </button>
      <Link
        href={withBase('/settings')}
        className="portal-bottom-nav-btn"
        aria-label="我"
      >
        <span className="portal-bottom-nav-icon portal-icon-blue" aria-hidden>
          👤
        </span>
      </Link>
    </nav>
  );
}
