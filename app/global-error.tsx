'use client';

/**
 * Root error boundary — catches crashes in the root layout itself.
 * Must render its own <html>/<body> (App Router requirement).
 */

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh">
      <body style={{
        margin: 0, minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24,
        fontFamily: 'system-ui, sans-serif', textAlign: 'center',
      }}>
        <span style={{ fontSize: '2rem' }} aria-hidden>😵‍💫</span>
        <p style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>应用出了点问题</p>
        <p style={{ fontSize: '0.8rem', opacity: 0.7, margin: 0 }}>数据都在本地，没有丢。</p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 8, padding: '0.5rem 1.5rem', borderRadius: 999,
            border: 'none', background: '#588ce3', color: '#fff', fontSize: '0.9rem', cursor: 'pointer',
          }}
        >
          重新加载
        </button>
      </body>
    </html>
  );
}
