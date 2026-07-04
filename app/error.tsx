'use client';

/**
 * Route-level error boundary (Next.js App Router convention).
 * A crash inside any page renders this instead of a white screen,
 * reports the error to telemetry, and offers one-tap recovery.
 */

import { useEffect } from 'react';
import { track } from '@/lib/portal/telemetry';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    track('client_error', {
      kind: 'boundary',
      message: String(error.message || 'unknown').slice(0, 80),
      ...(error.digest ? { digest: error.digest } : {}),
    });
  }, [error]);

  return (
    <div style={{
      minHeight: '60vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center',
    }}>
      <span style={{ fontSize: '2rem' }} aria-hidden>😵‍💫</span>
      <p style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>页面出了点问题</p>
      <p style={{ fontSize: '0.8rem', opacity: 0.7, margin: 0 }}>
        数据都在本地，没有丢。点下面重试,或刷新页面。
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: 8, padding: '0.5rem 1.5rem', borderRadius: 999,
          border: 'none', background: '#588ce3', color: '#fff', fontSize: '0.9rem', cursor: 'pointer',
        }}
      >
        重试
      </button>
    </div>
  );
}
