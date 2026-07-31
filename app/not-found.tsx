import Link from 'next/link';

/**
 * 404 — the automated site test found no way home except browser back.
 *
 * 2026-07-29:此前这页是「iOS 灰色指南针 emoji + 纯蓝按钮 #588ce3」,和全站脱节 ——
 * 强调色写死成蓝(CLAUDE.md 红线:组件里不许硬编码色值),字体不走 --font-sans,
 * 图标是系统 emoji 而不是站内的描边图标。这里全部换成 token + 内联描边 SVG。
 * (内联而非 import ../components/portal/icons:404 是 server component,
 *  这一个图标不值得为它拉一条 client 边界。)
 */
export default function NotFound() {
  return (
    <div style={{
      minHeight: '70vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)',
      padding: 'var(--space-6)', textAlign: 'center',
      // 不给自己铺底色 —— 全站的底是 body 上那层 --portal-bg-gradient。
      // 这里再刷一层 --portal-bg,会在 70vh 处切出一道横向色阶断层(实测截图可见)。
      color: 'var(--portal-ink)',
      fontFamily: 'var(--font-sans)',
    }}>
      <svg
        viewBox="0 0 24 24" width={34} height={34} fill="none" stroke="currentColor"
        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
        style={{ color: 'var(--portal-accent)' }} aria-hidden
      >
        <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" />
        <path d="M9 4v14M15 6v14" />
      </svg>
      <p style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
        这里暂时没有页面
      </p>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', margin: 0 }}>
        可能链接旧了，或者地址差了一个字。回首页再找找。
      </p>
      <Link
        href="/"
        style={{
          marginTop: 'var(--space-2)', padding: 'var(--space-2) var(--space-6)', borderRadius: 'var(--radius-pill)',
          background: 'var(--portal-accent)', color: 'var(--portal-on-accent, #fff)',
          fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', textDecoration: 'none',
        }}
      >
        回到首页
      </Link>
    </div>
  );
}
