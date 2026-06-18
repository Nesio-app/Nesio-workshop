'use client';

import { loadProfileSettings } from '@/lib/portal/profile';
import type { PortalLocale } from '@/lib/portal/profile';
import { t } from '@/lib/portal/i18n';

type PortalSecretaryFabProps = {
  onOpen?: () => void;
};

export default function PortalSecretaryFab({ onOpen }: PortalSecretaryFabProps) {
  const locale: PortalLocale = loadProfileSettings().locale;
  return (
    <button
      type="button"
      className="portal-secretary-fab"
      aria-label={t(locale, 'quickChatActionSecretary')}
      onClick={onOpen}
    >
      <span className="portal-secretary-fab-ring" aria-hidden />
      <span className="portal-secretary-fab-icon" aria-hidden>
        💬
      </span>
    </button>
  );
}
