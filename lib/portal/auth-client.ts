'use client';

const FALLBACK_AUTH_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || 'https://treasurebox-nu.vercel.app';

type SupabaseHashSession = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  type?: string;
};

export type AuthHashImportResult = {
  imported: boolean;
  ok: boolean;
  loggedIn?: boolean;
  status?: string;
};

export function getAuthRedirectTo(): string {
  const origin = window.location.origin;
  const host = window.location.hostname;
  const isLocalShell = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
  return `${isLocalShell ? FALLBACK_AUTH_ORIGIN : origin}/api/auth/callback`;
}

export function readSupabaseAuthHash(hash: string): SupabaseHashSession | null {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!value || !value.includes('access_token=')) return null;

  const params = new URLSearchParams(value);
  const accessToken = params.get('access_token')?.trim() || '';
  if (!accessToken) return null;

  const expiresIn = Number(params.get('expires_in') || '');
  return {
    accessToken,
    refreshToken: params.get('refresh_token')?.trim() || undefined,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : undefined,
    type: params.get('type')?.trim() || undefined,
  };
}

function clearSupabaseAuthHash() {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
}

export async function importSupabaseHashSession(): Promise<AuthHashImportResult> {
  if (typeof window === 'undefined') return { imported: false, ok: false };

  const session = readSupabaseAuthHash(window.location.hash);
  if (!session) return { imported: false, ok: false };

  try {
    const response = await fetch('/api/auth/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
      cache: 'no-store',
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      loggedIn?: boolean;
      status?: string;
    } | null;
    const result = {
      imported: true,
      ok: Boolean(response.ok && data?.ok),
      loggedIn: Boolean(data?.loggedIn),
      status: data?.status || (response.ok ? 'session_imported' : 'session_import_failed'),
    };
    window.dispatchEvent(new CustomEvent('nesio-auth-session-imported', { detail: result }));
    return result;
  } catch {
    return { imported: true, ok: false, loggedIn: false, status: 'session_import_failed' };
  } finally {
    clearSupabaseAuthHash();
  }
}
