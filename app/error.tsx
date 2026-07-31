'use client';

/**
 * Route-level error boundary (Next.js App Router convention).
 * A crash inside any page renders this instead of a white screen,
 * reports the error to telemetry, and offers one-tap recovery.
 */

import { useEffect } from 'react';
import { track } from '@/lib/portal/telemetry';

// 批次 85(用户实锤「记忆页点一下就请重试」):长开的 PWA 跨过新部署后,
// 懒加载的代码块已被替换 → 加载失败;旧「重试」只 reset 不重载,永远失败。
const CHUNK_ERR_RE = /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch/i;

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkErr = CHUNK_ERR_RE.test(`${error.name || ''} ${error.message || ''}`);
  useEffect(() => {
    track('client_error', {
      kind: 'boundary',
      message: String(error.message || 'unknown').slice(0, 80),
      ...(error.digest ? { digest: error.digest } : {}),
    });
    // chunk 类错误 = 版本换血,自动硬刷新一次拿新版本(防循环:每 5 分钟只自愈一次)
    if (isChunkErr) {
      try {
        const last = Number(sessionStorage.getItem('nesio-chunk-reload') || 0);
        if (Date.now() - last > 5 * 60_000) {
          sessionStorage.setItem('nesio-chunk-reload', String(Date.now()));
          window.location.reload();
        }
      } catch { /* sessionStorage 不可用就等用户手点 */ }
    }
  }, [error, isChunkErr]);

  return (
    <div style={{
      minHeight: '60vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)',
      padding: 'var(--space-6)', textAlign: 'center',
      color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)',
    }}>
      {/* 2026-07-29:这页和 not-found 是同一个病 —— 系统 emoji + 写死的蓝按钮 #588ce3。
          全站有四套可切换皮肤,写死的蓝只对其中一套。换成 token + 内联描边图标。 */}
      <svg viewBox="0 0 24 24" width={32} height={32} fill="none" stroke="currentColor"
        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
        style={{ color: 'var(--status-gentle)' }} aria-hidden>
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
      <p style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>页面出了点问题</p>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', margin: 0 }}>
        {isChunkErr ? '刚更新了新版本,正在为你刷新…' : '数据都在本地，没有丢。点下面重试,或刷新页面。'}
      </p>
      <button
        type="button"
        onClick={() => { try { window.location.reload(); } catch { reset(); } }}
        style={{
          marginTop: 'var(--space-2)', padding: 'var(--space-2) var(--space-6)', borderRadius: 'var(--radius-pill)',
          border: 'none', background: 'var(--portal-accent)', color: 'var(--portal-on-accent, #fff)',
          fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', cursor: 'pointer',
        }}
      >
        重试
      </button>
      {/* 批次 162:诊断做响可复制 —— 反复闪退时用户能把确切错误发回来定根因(此前 opacity 0.4 太小看不清) */}
      {!isChunkErr && (
        <div style={{ marginTop: 14, width: '100%', maxWidth: 320 }}>
          <p style={{
            fontSize: '0.72rem', color: 'var(--status-risk, #c0392b)', margin: '0 0 6px',
            padding: '8px 10px', borderRadius: 8, textAlign: 'left', wordBreak: 'break-all',
            background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.25)', userSelect: 'text',
          }}>
            {String(error.name || 'Error')}: {String(error.message || '').slice(0, 160)}
            {error.digest ? ` · #${error.digest}` : ''}
          </p>
          <button
            type="button"
            onClick={() => {
              const text = `${error.name || 'Error'}: ${error.message || ''}${error.digest ? ` · #${error.digest}` : ''}`;
              try { navigator.clipboard?.writeText(text); } catch { /* 剪贴板不可用就让用户手抄 */ }
            }}
            style={{ fontSize: '0.72rem', padding: 'var(--space-1) var(--space-4)', borderRadius: 999, border: '1px solid var(--portal-line, #ccc)', background: 'transparent', cursor: 'pointer' }}
          >
            复制错误信息
          </button>
        </div>
      )}
    </div>
  );
}
