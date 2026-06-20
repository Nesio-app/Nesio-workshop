import React from 'react';

/**
 * FloatingButton (FAB) — a single lightweight entry that floats over the
 * courtyard. Used for the 笔记 (note) and 智友 (AI) quick entries.
 * Circular glass by default; pass `label` for a pill.
 */
export function FloatingButton({
  icon,
  label = '',
  accent = false,
  position = 'br',
  size = 56,
  style = {},
  ...rest
}) {
  const [press, setPress] = React.useState(false);
  const corner = {
    br: { right: 'var(--space-5)', bottom: 'calc(var(--space-5) + env(safe-area-inset-bottom))' },
    bl: { left: 'var(--space-5)', bottom: 'calc(var(--space-5) + env(safe-area-inset-bottom))' },
    tr: { right: 'var(--space-5)', top: 'var(--space-5)' },
    tl: { left: 'var(--space-5)', top: 'var(--space-5)' },
  };

  return (
    <button
      type="button"
      onPointerDown={() => setPress(true)}
      onPointerUp={() => setPress(false)}
      onPointerLeave={() => setPress(false)}
      style={{
        position: 'fixed',
        ...corner[position],
        zIndex: 60,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        height: size,
        minWidth: size,
        padding: label ? '0 1.1rem 0 0.9rem' : 0,
        justifyContent: 'center',
        borderRadius: 'var(--radius-pill)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--weight-semibold)',
        color: accent ? '#fff' : 'var(--portal-blue-deep)',
        background: accent
          ? 'var(--portal-blue-deep)'
          : 'var(--glass-bg-pop)',
        backdropFilter: 'blur(var(--glass-blur))',
        WebkitBackdropFilter: 'blur(var(--glass-blur))',
        border: accent ? '1px solid rgba(255,255,255,0.4)' : '1px solid var(--glass-border)',
        boxShadow: 'var(--shadow-fab)',
        transform: press ? 'scale(0.94)' : 'scale(1)',
        transition: 'transform var(--dur-fast) var(--ease-soft), box-shadow var(--dur) var(--ease-soft)',
        ...style,
      }}
      {...rest}
    >
      <span style={{ display: 'grid', placeItems: 'center', fontSize: '1.25rem', lineHeight: 1 }}>{icon}</span>
      {label && <span>{label}</span>}
    </button>
  );
}
