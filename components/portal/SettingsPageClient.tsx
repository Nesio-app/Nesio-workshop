'use client';

import NesioProfileCard from './NesioProfileCard';

export default function SettingsPageClient() {
  return (
    <div className="portal-root portal-root--home">
      <div className="portal-grain" aria-hidden />
      <div className="portal-shell portal-shell--single">
        <div className="portal-main" style={{ overflowY: 'auto', height: '100dvh', paddingBottom: '2rem' }}>
          <NesioProfileCard />
        </div>
      </div>
    </div>
  );
}
