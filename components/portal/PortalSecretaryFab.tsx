'use client';

import Link from 'next/link';
import { ensureToolboxTrailingSlash } from '@/lib/portal/paths';
import { loadProfileSettings } from '@/lib/portal/profile';
import type { PortalLocale } from '@/lib/portal/profile';
import { t } from '@/lib/portal/i18n';

export default function PortalSecretaryFab() {
  const locale: PortalLocale = loadProfileSettings().locale;
  return (
    <Link
      href={ensureToolboxTrailingSlash('/secretary')}
      className="portal-secretary-fab"
      aria-label={t(locale, 'quickChatActionSecretary')}
    >
      <span className="portal-secretary-fab-ring" aria-hidden />
      <span className="portal-secretary-fab-icon" aria-hidden>
        💬
      </span>
    </Link>
  );
}
