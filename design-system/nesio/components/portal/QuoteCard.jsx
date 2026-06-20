import React from 'react';

/**
 * QuoteCard — 今日话语. A quiet serif line that lives at the bottom of the
 * home. Soft glass with a save affordance.
 */
export function QuoteCard({ quote = '', label = '今日话语', onSave, saved = false, style = {} }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--portal-blue-light) 55%, transparent), var(--glass-bg-solid))',
        backdropFilter: 'blur(var(--glass-blur))',
        WebkitBackdropFilter: 'blur(var(--glass-blur))',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4) var(--space-5)',
        color: 'var(--portal-ink)',
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-overline)', letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase', color: 'var(--portal-muted)', marginBottom: '0.4rem' }}>{label}</div>
        <p style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 'var(--text-h2)', fontWeight: 'var(--weight-regular)', lineHeight: 'var(--leading-relaxed)', opacity: 0.92 }}>{quote}</p>
      </div>
      {onSave && (
        <button
          type="button"
          onClick={onSave}
          aria-label="收藏这句话"
          style={{
            flex: 'none',
            width: 38, height: 38,
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--glass-border)',
            background: saved ? 'var(--portal-blue-deep)' : 'var(--glass-bg)',
            color: saved ? '#fff' : 'var(--portal-blue-deep)',
            cursor: 'pointer',
            fontSize: '1rem',
            display: 'grid', placeItems: 'center',
            transition: 'background var(--dur) var(--ease-soft)',
          }}
        >
          {saved ? '♥' : '♡'}
        </button>
      )}
    </div>
  );
}
