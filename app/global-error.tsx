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
        {/* 2026-07-29:同 not-found / error —— 去系统 emoji、去写死的蓝。
            注意这一层是**根 layout 崩了**才渲染,globals.css 未必已经应用,
            所以每个 token 都带一个兜底值(灰粉皮肤的日间值),两种情况都不难看。 */}
        <svg viewBox="0 0 24 24" width={32} height={32} fill="none" stroke="currentColor"
          strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
          style={{ color: 'var(--status-gentle, #c08a6f)' }} aria-hidden>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
        <p style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--portal-ink, #3a3c43)' }}>应用出了点问题</p>
        <p style={{ fontSize: '0.8rem', margin: 0, color: 'var(--portal-muted, #6b7280)' }}>数据都在本地，没有丢。</p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 8, padding: 'var(--space-2) var(--space-6)', borderRadius: 999,
            border: 'none', background: 'var(--portal-accent, #c07f79)', color: 'var(--portal-on-accent, #fff)',
            fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer',
          }}
        >
          重新加载
        </button>
      </body>
    </html>
  );
}
