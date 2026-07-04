import Link from 'next/link';

/** 404 — the automated site test found no way home except browser back. */
export default function NotFound() {
  return (
    <div style={{
      minHeight: '70vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center',
    }}>
      <span style={{ fontSize: '2.2rem' }} aria-hidden>🧭</span>
      <p style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>这个页面不存在</p>
      <p style={{ fontSize: '0.8rem', opacity: 0.7, margin: 0 }}>可能链接旧了，或者输错了地址。</p>
      <Link
        href="/"
        style={{
          marginTop: 8, padding: '0.5rem 1.5rem', borderRadius: 999,
          background: '#588ce3', color: '#fff', fontSize: '0.9rem', textDecoration: 'none',
        }}
      >
        回到首页
      </Link>
    </div>
  );
}
