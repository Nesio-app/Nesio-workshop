'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { t, type PortalStringKey } from '@/lib/portal/i18n';
import {
  loadProfileSettings,
  readAvatarFile,
  saveProfileSettings,
  type PortalLocale,
} from '@/lib/portal/profile';
import type { PortalConfig } from '@/lib/portal/types';
import PortalThemeToggle from './PortalThemeToggle';

function initials(name: string): string {
  const t = name.trim();
  return t.slice(0, 1);
}

interface AccountSettingsProps {
  config: PortalConfig;
}

export default function AccountSettings({ config }: AccountSettingsProps) {
  const fallbackName = config.profile?.displayName || t('zh', 'profileDefaultName');
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(fallbackName);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [locale, setLocale] = useState<PortalLocale>('zh');
  const [toast, setToast] = useState('');

  useEffect(() => {
    const s = loadProfileSettings(fallbackName);
    setDisplayName(s.displayName);
    setAvatarUrl(s.avatarUrl);
    setLocale(s.locale);
    document.documentElement.lang = s.locale === 'en' ? 'en' : 'zh-CN';
  }, [fallbackName]);

  const showToast = (key: PortalStringKey) => {
    setToast(t(locale, key));
    window.setTimeout(() => setToast(''), 1800);
  };

  const onPickAvatar = async (file: File) => {
    try {
      const dataUrl = await readAvatarFile(file);
      setAvatarUrl(dataUrl);
      saveProfileSettings({ avatarUrl: dataUrl });
      showToast('settingsSaved');
    } catch { /* ignore */ }
  };

  const onNameBlur = () => {
    const name = displayName.trim() || fallbackName;
    setDisplayName(name);
    saveProfileSettings({ displayName: name });
    showToast('settingsSaved');
  };

  const onLocaleChange = (next: PortalLocale) => {
    setLocale(next);
    saveProfileSettings({ locale: next });
    showToast('settingsSaved');
  };

  return (
    <div className="portal-settings">
      <header className="portal-settings-head">
        <Link href="/" className="portal-settings-back">
          ‹ {t(locale, 'settingsBack')}
        </Link>
        <h1 className="portal-settings-title">{t(locale, 'settingsTitle')}</h1>
      </header>

      <section className="portal-settings-card">
        <h2 className="portal-settings-label">{t(locale, 'settingsAvatar')}</h2>
        <p className="portal-settings-hint">{t(locale, 'settingsAvatarHint')}</p>
        <button
          type="button"
          className="portal-settings-avatar-btn"
          onClick={() => fileRef.current?.click()}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="portal-settings-avatar" width={88} height={88} />
          ) : (
            <div className="portal-settings-avatar portal-settings-avatar--initials" aria-hidden>
              {initials(displayName)}
            </div>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="portal-avatar-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPickAvatar(f);
            e.target.value = '';
          }}
        />
      </section>

      <section className="portal-settings-card">
        <label className="portal-settings-label" htmlFor="profile-name">
          {t(locale, 'settingsName')}
        </label>
        <input
          id="profile-name"
          className="portal-settings-input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={onNameBlur}
          maxLength={32}
          placeholder={t(locale, 'nameInputPlaceholder')}
        />
      </section>

      <section className="portal-settings-card">
        <h2 className="portal-settings-label">{t(locale, 'portalAppearanceTitle')}</h2>
        <p className="portal-settings-hint">{t(locale, 'portalAppearanceHint')}</p>
        <PortalThemeToggle />
      </section>

      <section className="portal-settings-card">
        <h2 className="portal-settings-label">{t(locale, 'settingsLanguage')}</h2>
        <div className="portal-settings-lang">
          <button
            type="button"
            className={'portal-settings-lang-btn' + (locale === 'zh' ? ' portal-settings-lang-btn--on' : '')}
            onClick={() => onLocaleChange('zh')}
          >
            {t(locale, 'settingsLangZh')}
          </button>
          <button
            type="button"
            className={'portal-settings-lang-btn' + (locale === 'en' ? ' portal-settings-lang-btn--on' : '')}
            onClick={() => onLocaleChange('en')}
          >
            {t(locale, 'settingsLangEn')}
          </button>
        </div>
      </section>

      <p className="portal-settings-foot">
        <Link href="/portfolio">{t(locale, 'portfolioLink')} →</Link>
      </p>

      {toast ? <div className="portal-settings-toast" role="status">{toast}</div> : null}
    </div>
  );
}
