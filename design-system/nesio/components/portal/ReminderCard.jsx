import React from 'react';

/**
 * ReminderCard — "陪你看见" (I'll help you see).
 * A gentle, AI/DB-driven module that surfaces one small doable next step
 * at a time. Every item carries an escape: 跳过 / 稍后 / 更轻提醒.
 */
export function ReminderCard({
  title = '陪你看见',
  subtitle = '',
  items = [],
  onAct,
  onSkip,
  onLater,
  style = {},
}) {
  const tone = {
    go:     { fg: 'var(--status-go)',     bg: 'var(--status-go-soft)' },
    gentle: { fg: 'var(--status-gentle)', bg: 'var(--status-gentle-soft)' },
    calm:   { fg: 'var(--status-calm)',   bg: 'var(--status-calm-soft)' },
    risk:   { fg: 'var(--status-risk)',   bg: 'var(--status-risk-soft)' },
  };

  return (
    <section
      style={{
        background: 'var(--glass-bg-solid)',
        backdropFilter: 'blur(var(--glass-blur))',
        WebkitBackdropFilter: 'blur(var(--glass-blur))',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
        boxShadow: 'var(--shadow-card), var(--glass-highlight)',
        color: 'var(--portal-ink)',
        ...style,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-semibold)' }}>{title}</h3>
        {subtitle && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{subtitle}</span>}
      </header>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {items.map((it, i) => {
          const c = tone[it.status] || tone.calm;
          return (
            <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: c.bg }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: c.fg, marginTop: '0.5rem', flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {it.kind && (
                    <span style={{ fontSize: '0.64rem', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: c.fg }}>{it.kind}</span>
                  )}
                  <p style={{ margin: '0.15rem 0 0', fontSize: 'var(--text-body)', lineHeight: 'var(--leading-snug)' }}>{it.text}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingLeft: '1.3rem' }}>
                <button type="button" onClick={() => onAct?.(it)} style={btn(c.fg, true)}>{it.action || '轻轻处理'}</button>
                <button type="button" onClick={() => onLater?.(it)} style={btn('var(--portal-muted)')}>稍后</button>
                <button type="button" onClick={() => onSkip?.(it)} style={btn('var(--portal-muted)')}>跳过</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function btn(color, filled = false) {
  return {
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--weight-medium)',
    color: filled ? '#fff' : color,
    background: filled ? color : 'transparent',
    border: filled ? '1px solid transparent' : '1px solid var(--glass-border)',
    borderRadius: 'var(--radius-pill)',
    padding: '0.35rem 0.8rem',
    cursor: 'pointer',
  };
}
