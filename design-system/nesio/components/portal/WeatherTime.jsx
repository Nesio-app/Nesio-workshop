import React from 'react';

/**
 * WeatherTime — top-right cluster on the home: clock, date, and a small
 * weather glance. Quiet glass chip.
 */
export function WeatherTime({
  time = '',
  date = '',
  temp = '',
  condition = '',
  place = '',
  align = 'right',
  style = {},
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'right' ? 'flex-end' : 'flex-start',
        gap: '0.15rem',
        color: 'var(--portal-ink)',
        fontFamily: 'var(--font-sans)',
        ...style,
      }}
    >
      <div style={{ fontSize: 'var(--text-h1)', fontWeight: 'var(--weight-semibold)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', lineHeight: 1 }}>{time}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{date}</div>
      {(temp || condition) && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.3rem', fontSize: 'var(--text-xs)', color: 'var(--portal-blue-deep)', background: 'color-mix(in srgb, var(--portal-blue-light) 45%, transparent)', padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-pill)' }}>
          <span style={{ fontWeight: 'var(--weight-semibold)' }}>{temp}</span>
          {condition && <span style={{ color: 'var(--portal-muted)' }}>{condition}</span>}
          {place && <span style={{ color: 'var(--portal-muted)' }}>· {place}</span>}
        </div>
      )}
    </div>
  );
}
