'use client';

import { useEffect, useState } from 'react';
import AccountSettings from './AccountSettings';
import NesioProfileCard from './NesioProfileCard';
import { DEFAULT_PORTAL_CONFIG } from '@/lib/portal/defaults';
import { configUrl } from '@/lib/portal/paths';
import type { PortalConfig } from '@/lib/portal/types';

export default function SettingsPageClient() {
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_PORTAL_CONFIG);

  useEffect(() => {
    fetch(configUrl())
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PortalConfig | null) => {
        if (data?.tools?.length) setConfig(data);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="portal-root portal-root--home">
      <div className="portal-grain" aria-hidden />
      <div className="portal-shell portal-shell--single">
        <div className="portal-main" style={{ overflowY: 'auto', height: '100dvh', paddingBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '1rem 1.25rem 0' }}>
            <img src="/icons/treasurebox-pwa-192.png" alt="" className="nesio-today-brand-icon" />
            <span className="nesio-today-brand-name">我</span>
          </div>
          <NesioProfileCard />
          <details className="nesio-settings-legacy">
            <summary className="nesio-settings-legacy-toggle">账号 · 高级设置</summary>
            <AccountSettings config={config} />
          </details>
        </div>
      </div>
    </div>
  );
}
