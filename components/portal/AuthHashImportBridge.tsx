'use client';

import { useEffect } from 'react';
import { importSupabaseHashSession } from '@/lib/portal/auth-client';

export default function AuthHashImportBridge() {
  useEffect(() => {
    let cancelled = false;

    async function importHashSession() {
      if (!window.location.hash.includes('access_token=')) return;
      const result = await importSupabaseHashSession();
      if (cancelled || !result.imported) return;

      if (result.status === 'account_not_registered') {
        window.location.replace('/login?reason=not_registered');
        return;
      }
      window.dispatchEvent(new CustomEvent('nesio-auth-session-imported', { detail: result }));
      if (result.ok && result.loggedIn) {
        window.dispatchEvent(new CustomEvent('nesio-auth-session-ready', { detail: result }));
      }
    }

    importHashSession().catch(() => undefined);
    window.addEventListener('hashchange', importHashSession);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', importHashSession);
    };
  }, []);

  return null;
}
