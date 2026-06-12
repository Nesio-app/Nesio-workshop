'use client';

import Link from 'next/link';
import { withBase } from '@/lib/portal/paths';

export default function PortalSecretaryFab() {
  return (
    <Link
      href={withBase('/secretary')}
      className="portal-secretary-fab"
      aria-label="智友"
    >
      <span className="portal-secretary-fab-ring" aria-hidden />
      <span className="portal-secretary-fab-icon" aria-hidden>
        💬
      </span>
    </Link>
  );
}
