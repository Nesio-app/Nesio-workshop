import React from 'react';

/**
 * ToolModuleCard — a paid/owned tool shown on the home as a LIVE content
 * window, not just a name. The icon + a faint name sit in the corner;
 * the body shows the tool's own glanceable signal (what's expiring, next
 * session, today's number…) passed as children.
 */
export function ToolModuleCard({
  icon,
  name = '',
  nameEn = '',
  tone = 'cool',
  status = null,            // { status, label } warm-coach badge
  locked = false,
  children,
  onOpen,
  style = {},
}) {
  const [hover, setHover] = React.useState(false);
  const toneBg = {
    cool: 'color-mix(in srgb, var(--portal-cool) 88%, white)',
    warm: 'color-mix(in srgb, var(--portal-warm) 88%, white)',
    neutral: 'color-mix(in srgb, var(--portal-neutral) 88%, white)',
  };
  const accent = {
    cool: 'var(--portal-cool-accent)',
    warm: 'var(--portal-warm-accent)',
    neutral: 'var(--portal-neutral-accent)',
  }[tone];

  const badge = status && {
    go:     { fg: 'var(--status-go)',     bg: 'var(--status-go-soft)' },
    gentle: { fg: 'var(--status-gentle)', bg: 'var(--status-gentle-soft)' },
    calm:   { fg: 'var(--status-calm)',   bg: 'var(--status-calm-soft)' },
    risk:   { fg: 'var(--status-risk)',   bg: 'var(--status-risk-soft)' },
  }[status.status];

  return (
    <article
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        background: toneBg[tone] || toneBg.cool,
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        minHeight: '8.5rem',
        cursor: onOpen ? 'pointer' : 'default',
        color: 'var(--portal-ink)',
        boxShadow: hover ? 'var(--shadow-raise), var(--glass-highlight)' : 'var(--shadow-card), var(--glass-highlight)',
        transform: hover && onOpen ? 'translateY(-3px)' : 'translateY(0)',
        transition: 'transform var(--dur) var(--ease-soft), box-shadow var(--dur) var(--ease-soft)',
        opacity: locked ? 0.62 : 1,
        ...style,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, overflow: 'hidden', flex: 'none', display: 'grid', placeItems: 'center', fontSize: '1.2rem' }}>
          {typeof icon === 'string' && icon.includes('.svg')
            ? <img src={icon} alt="" width={34} height={34} style={{ borderRadius: 10 }} />
            : icon}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-muted)', letterSpacing: '0.02em' }}>
          {name}{nameEn ? ` · ${nameEn}` : ''}
        </span>
        {badge && (
          <span style={{ fontSize: '0.66rem', fontWeight: 'var(--weight-semibold)', color: badge.fg, background: badge.bg, padding: '0.18rem 0.5rem', borderRadius: 'var(--radius-pill)', flex: 'none' }}>
            {status.label}
          </span>
        )}
        {locked && !badge && (
          <span aria-hidden style={{ fontSize: '0.8rem', color: 'var(--portal-muted)' }}>🔒</span>
        )}
      </header>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.2rem' }}>
        {children}
      </div>

      {onOpen && (
        <footer style={{ fontSize: 'var(--text-xs)', color: accent, opacity: hover ? 1 : 0.7, transition: 'opacity var(--dur) var(--ease-soft)' }}>
          进入 →
        </footer>
      )}
    </article>
  );
}
