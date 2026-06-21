import React from 'react';

/**
 * GlassCard — the core liquid-glass surface.
 * Frosted panel that floats over the gradient. Optional zone tone
 * (cool / warm / neutral) tints it to one of the three cabins.
 */
export function GlassCard({
  children,
  tone = 'plain',
  raised = false,
  interactive = false,
  padding = 'var(--space-5)',
  radius = 'var(--radius-lg)',
  style = {},
  ...rest
}) {
  const toneBg = {
    plain: 'var(--glass-bg-solid)',
    cool: 'color-mix(in srgb, var(--portal-cool) 88%, white)',
    warm: 'color-mix(in srgb, var(--portal-warm) 88%, white)',
    neutral: 'color-mix(in srgb, var(--portal-neutral) 88%, white)',
  };

  const [hover, setHover] = React.useState(false);

  return (
    <div
      style={{
        position: 'relative',
        background: toneBg[tone] || toneBg.plain,
        backdropFilter: 'blur(var(--glass-blur))',
        WebkitBackdropFilter: 'blur(var(--glass-blur))',
        border: '1px solid var(--glass-border)',
        borderRadius: radius,
        padding,
        boxShadow: (raised || (interactive && hover))
          ? 'var(--shadow-raise), var(--glass-highlight)'
          : 'var(--shadow-card), var(--glass-highlight)',
        color: 'var(--portal-ink)',
        transition: 'transform var(--dur) var(--ease-soft), box-shadow var(--dur) var(--ease-soft), border-color var(--dur) var(--ease-soft)',
        transform: interactive && hover ? 'translateY(-3px)' : 'translateY(0)',
        cursor: interactive ? 'pointer' : 'default',
        ...style,
      }}
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      {...rest}
    >
      {children}
    </div>
  );
}
