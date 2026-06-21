import React from 'react';

/**
 * Nesio Button — calm, tactile actions.
 * Variants: primary (filled blue), secondary (glass), soft (tonal), ghost (text).
 * Never shout. Destructive uses `tone="risk"` and is reserved for real risk.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  tone = 'brand',
  pill = false,
  full = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  style = {},
  ...rest
}) {
  const accent = tone === 'risk' ? 'var(--status-risk)' : 'var(--portal-blue-deep)';

  const sizes = {
    sm: { padding: '0.4rem 0.85rem', font: 'var(--text-sm)', gap: '0.35rem' },
    md: { padding: '0.6rem 1.15rem', font: 'var(--text-body)', gap: '0.45rem' },
    lg: { padding: '0.8rem 1.5rem', font: 'var(--text-h3)', gap: '0.55rem' },
  };
  const s = sizes[size] || sizes.md;

  const variants = {
    primary: {
      background: accent,
      color: '#fff',
      border: '1px solid transparent',
      boxShadow: 'var(--shadow-card)',
    },
    secondary: {
      background: 'var(--glass-bg-solid)',
      color: 'var(--portal-ink)',
      border: '1px solid var(--glass-border)',
      backdropFilter: 'blur(var(--glass-blur))',
      WebkitBackdropFilter: 'blur(var(--glass-blur))',
    },
    soft: {
      background: tone === 'risk' ? 'var(--status-risk-soft)' : 'color-mix(in srgb, var(--portal-blue-light) 60%, transparent)',
      color: accent,
      border: '1px solid var(--glass-border)',
    },
    ghost: {
      background: 'transparent',
      color: accent,
      border: '1px solid transparent',
    },
  };

  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.gap,
        fontFamily: 'var(--font-sans)',
        fontSize: s.font,
        fontWeight: 'var(--weight-medium)',
        lineHeight: 1.1,
        padding: s.padding,
        minHeight: 'var(--tap-min)',
        width: full ? '100%' : 'auto',
        borderRadius: pill ? 'var(--radius-pill)' : 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'transform var(--dur-fast) var(--ease-soft), box-shadow var(--dur) var(--ease-soft), background var(--dur) var(--ease-soft)',
        ...variants[variant],
        ...style,
      }}
      onPointerDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(0.97)'; }}
      onPointerUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      onPointerLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
