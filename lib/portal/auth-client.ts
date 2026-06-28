'use client';

const FALLBACK_AUTH_ORIGIN = 'https://treasurebox-nu.vercel.app';

export function getAuthRedirectTo(): string {
  const origin = window.location.origin;
  const host = window.location.hostname;
  const isLocalShell = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
  return `${isLocalShell ? FALLBACK_AUTH_ORIGIN : origin}/api/auth/callback`;
}
