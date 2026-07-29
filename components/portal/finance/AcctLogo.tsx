'use client';

/** AcctLogo — 账户 logo/首字回退小徽(P3 拆分,CardsPane 与交易行共用)。 */
import type { BankAccount } from '@/lib/portal/bank-tx';

export default function AcctLogo({ a, size = 22 }: { a: BankAccount; size?: number }) {
  if (a.logo) {
    const src = a.logo.startsWith('data:') ? a.logo : `data:image/png;base64,${a.logo}`;
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="nesio-fin-acct-logo" src={src} alt="" width={size} height={size} />;
  }
  const ch = (a.institution || a.name || '?').trim().charAt(0).toUpperCase();
  return (
    <span
      className="nesio-fin-acct-badge"
      style={{ width: size, height: size, fontSize: size * 0.55, background: a.color || 'var(--portal-accent-soft)', color: a.color ? '#fff' : 'var(--portal-accent)' }}
      aria-hidden
    >{ch}</span>
  );
}
