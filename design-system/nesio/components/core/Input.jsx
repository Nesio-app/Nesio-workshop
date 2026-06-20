import React from 'react';

/**
 * Input — quiet glass text field. Also renders a textarea via `multiline`.
 */
export function Input({
  label = '',
  hint = '',
  multiline = false,
  rows = 3,
  value,
  onChange,
  placeholder = '',
  style = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const Tag = multiline ? 'textarea' : 'input';

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontFamily: 'var(--font-sans)' }}>
      {label && (
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-muted)' }}>{label}</span>
      )}
      <Tag
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={multiline ? rows : undefined}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-body)',
          color: 'var(--portal-ink)',
          background: 'var(--glass-bg-solid)',
          border: `1px solid ${focus ? 'var(--portal-blue-deep)' : 'var(--glass-border)'}`,
          borderRadius: 'var(--radius-sm)',
          padding: '0.6rem 0.8rem',
          minHeight: multiline ? undefined : 'var(--tap-min)',
          outline: 'none',
          resize: multiline ? 'vertical' : undefined,
          boxShadow: focus ? '0 0 0 3px color-mix(in srgb, var(--portal-blue-deep) 16%, transparent)' : 'none',
          transition: 'border-color var(--dur-fast) var(--ease-soft), box-shadow var(--dur-fast) var(--ease-soft)',
          ...style,
        }}
        {...rest}
      />
      {hint && (
        <span style={{ fontSize: '0.68rem', color: 'var(--portal-muted)' }}>{hint}</span>
      )}
    </label>
  );
}
