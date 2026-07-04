'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { t } from '@/lib/portal/i18n';
import {
  loadProfileSettings,
  saveProfileSettings,
  PROFILE_UPDATED_EVENT,
  type PortalLocale,
  type PortalProfileSettings,
} from '@/lib/portal/profile';
import { readAvatarFile } from '@/lib/portal/profile';
import { createAppApiClient } from '@/lib/portal/app-api-client';

export default function Settings() {
  const [locale, setLocale] = useState<PortalLocale>('zh');
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const settings = loadProfileSettings();
    setDisplayName(settings.displayName);
    setAvatarUrl(settings.avatarUrl);
    setLocale(settings.locale);
  }, []);

  const handleSave = () => {
    const trimmedName = displayName.trim() || t(locale, 'profileDefaultName');
      saveProfileSettings({
        displayName: trimmedName,
        avatarUrl,
        locale,
      });
      setDisplayName(trimmedName);
      setSaveMsg(t(locale, 'settingsSaved'));
      setTimeout(() => setSaveMsg(''), 2000);
  };

  const handleLanguageChange = (newLocale: PortalLocale) => {
    setLocale(newLocale);
    saveProfileSettings({ locale: newLocale });
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const client = createAppApiClient();
      const result = await client.uploadCloudAsset({ file, purpose: 'avatar' });
      if (result.ok && result.storagePath) {
        const readResult = await client.fetchCloudAssetReadUrl({ storagePath: result.storagePath });
        const displayUrl = readResult.ok && readResult.signedUrl ? readResult.signedUrl : '';
        await client.saveCloudProfileSettings({ avatarStoragePath: result.storagePath });
        saveProfileSettings({
          avatarUrl: displayUrl,
          avatarStoragePath: result.storagePath,
        });
        if (displayUrl) setAvatarUrl(displayUrl);
        setSaveMsg(t(locale, 'settingsSaved'));
        setTimeout(() => setSaveMsg(''), 2000);
        event.target.value = '';
        return;
      }
    } catch {
      // Cloud avatar upload is a signed-in enhancement; local avatar should keep working offline.
    }

    try {
      const avatar = await readAvatarFile(file);
      setAvatarUrl(avatar);
      saveProfileSettings({ avatarUrl: avatar, avatarStoragePath: '' });
      setSaveMsg(t(locale, 'settingsSaved'));
      setTimeout(() => setSaveMsg(''), 2000);
    } catch {
      setSaveMsg(t(locale, 'shellErrorAvatarUpload'));
      setTimeout(() => setSaveMsg(''), 2000);
    }

    // Reset input
    event.target.value = '';
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDisplayName(e.target.value);
  };

  return (
    <div className="portal-settings">
      <header className="portal-settings-header">
        <Link href="/" className="portal-settings-back" aria-label={t(locale, 'settingsBack')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{t(locale, 'settingsBack')}</span>
        </Link>
        <h1 className="portal-settings-title">{t(locale, 'settingsTitle')}</h1>
      </header>

      <main className="portal-settings-main">
        {/* Avatar Section */}
        <section className="portal-settings-section">
          <label className="portal-settings-label">{t(locale, 'settingsAvatar')}</label>
          <div className="portal-settings-avatar-box">
            <button
              type="button"
              className="portal-settings-avatar"
              onClick={handleAvatarClick}
              aria-label={t(locale, 'settingsAvatar')}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" width={120} height={120} />
              ) : (
                <div className="portal-settings-avatar-placeholder">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
              )}
            </button>
            <p className="portal-settings-avatar-hint">{t(locale, 'settingsAvatarHint')}</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="portal-settings-file-input"
            onChange={handleAvatarChange}
            aria-hidden
          />
        </section>

        {/* Display Name Section */}
        <section className="portal-settings-section">
          <label htmlFor="settings-name" className="portal-settings-label">
            {t(locale, 'settingsName')}
          </label>
            <input
              id="settings-name"
              type="text"
              value={displayName}
              onChange={handleNameChange}
              className="portal-settings-input"
              placeholder={t(locale, 'nameInputPlaceholder')}
            />
        </section>

        {/* Language Section */}
        <section className="portal-settings-section">
          <label className="portal-settings-label">{t(locale, 'settingsLanguage')}</label>
          <div className="portal-settings-language-group">
            <button
              type="button"
              className={`portal-settings-language-btn${locale === 'zh' ? ' portal-settings-language-btn--active' : ''}`}
              onClick={() => handleLanguageChange('zh')}
              aria-pressed={locale === 'zh'}
            >
              {t(locale, 'settingsLangZh')}
            </button>
            <button
              type="button"
              className={`portal-settings-language-btn${locale === 'en' ? ' portal-settings-language-btn--active' : ''}`}
              onClick={() => handleLanguageChange('en')}
              aria-pressed={locale === 'en'}
            >
              {t(locale, 'settingsLangEn')}
            </button>
          </div>
        </section>

        {/* Save Status */}
        {saveMsg && <p className="portal-settings-save-msg">{saveMsg}</p>}

        {/* Save Button */}
        <button type="button" className="portal-settings-save-btn" onClick={handleSave}>
          {t(locale, 'settingsSaved')}
        </button>
      </main>
    </div>
  );
}
