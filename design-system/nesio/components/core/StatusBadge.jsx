import React from 'react';

/**
 * StatusBadge — warm-coach status pill.
 * Soft by default. `risk` (muted red) is reserved for genuine
 * expiry / safety signals only.
 */
export function StatusBadge({ status = 'calm', children, dot = false, style = {} }) {
  const map = {
    go:     { fg: 'var(--status-go)',     bg: 'var(--status-go-soft)' },
    gentle: { fg: 'var(--status-gentle)', bg: 'var(--status-gentle-soft)' },
    calm:   { fg: 'var(--status-calm)',   bg: 'var(--status-calm-soft)' },
    risk:   { fg: 'var(--status-risk)',   bg: 'var(--status-risk-soft)' },
  };
  const c = map[status] || map.calm;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-semibold)',
        color: c.fg,
        background: c.bg,
        padding: '0.22rem 0.6rem',
        borderRadius: 'var(--radius-pill)',
        lineHeight: 1.2,
        ...style,
      }}
    >
      {dot && (
        <span style={{ width: 6, height: 6, borderRadius: 999, background: c.fg, flex: 'none' }} />
      )}
      {children}
    </span>
  );
}
