'use client';

import dynamic from 'next/dynamic';

const Portal = dynamic(() => import('@/components/portal/Portal'), {
  ssr: false,
  loading: () => (
    <div className="portal-root portal-root--home" aria-busy="true">
      <div className="portal-grain" aria-hidden />
      <div className="portal-shell portal-shell--single">
        <div className="portal-main portal-dash" style={{ minHeight: '50vh' }} />
      </div>
    </div>
  ),
});

export default function Home() {
  return <Portal />;
}
