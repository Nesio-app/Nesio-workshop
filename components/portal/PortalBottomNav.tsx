'use client';

import type { CSSProperties } from 'react';
import { t } from '@/lib/portal/i18n';
import { nesioBrandAssets, nesioToolIcons } from '@/lib/portal/nesio-design-system-assets.mjs';
import type { PortalLocale } from '@/lib/portal/profile';

interface PortalBottomNavProps {
  aiFriendsOpen?: boolean;
  treasureOpen?: boolean;
  locale?: PortalLocale;
  onHome: () => void;
  onOpenAiFriends: () => void;
  onOpenTreasure: () => void;
}

type PortalBottomNavCssProperties = CSSProperties & {
  '--portal-bottom-nav-icon-url'?: string;
};

export default function PortalBottomNav({
  aiFriendsOpen = false,
  treasureOpen = false,
  locale = 'zh',
  onHome,
  onOpenAiFriends,
  onOpenTreasure,
}: PortalBottomNavProps) {
  const bottomNavItems = [
    {
      key: 'home',
      label: t(locale, 'portalBottomNavHomeShell'),
      iconUrl: nesioBrandAssets.crystal,
      active: false,
      expanded: undefined,
      onClick: onHome,
    },
    {
      key: 'ai',
      label: t(locale, 'aiFriendsTitle'),
      iconUrl: nesioToolIcons.secretary,
      active: aiFriendsOpen,
      expanded: aiFriendsOpen,
      onClick: onOpenAiFriends,
    },
    {
      key: 'toolbox',
      label: t(locale, 'toolboxTitle'),
      iconUrl: nesioToolIcons.storage,
      active: treasureOpen,
      expanded: treasureOpen,
      onClick: onOpenTreasure,
      legacyShellEntryClass: 'portal-quote-treasure',
    },
  ];

  return (
    <nav className="portal-bottom-nav" aria-label={t(locale, 'portalBottomNavShellAriaLabel')}>
      {bottomNavItems.map((item) => (
        <button
          key={item.key}
          type="button"
          className={
            'portal-bottom-nav-btn' +
            (item.active ? ' portal-bottom-nav-btn--active' : '') +
            (item.legacyShellEntryClass ? ` ${item.legacyShellEntryClass}` : '')
          }
          onClick={item.onClick}
          aria-label={item.label}
          aria-expanded={item.expanded}
        >
          <span
            className="portal-bottom-nav-icon portal-bottom-nav-icon--mask"
            style={{ '--portal-bottom-nav-icon-url': `url("${item.iconUrl}")` } as PortalBottomNavCssProperties}
            aria-hidden
          />
          <span className="portal-bottom-nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
