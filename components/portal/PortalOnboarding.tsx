'use client';

import { useEffect, useState } from 'react';
import {
  loadProfileSettings,
  saveProfileSettings,
  type PortalCoachStyle,
  type PortalLocale,
} from '@/lib/portal/profile';
import { t, type PortalStringKey } from '@/lib/portal/i18n';

const ONBOARDING_DONE_KEY = 'treasurebox-onboarding-v14-done';
const LEGACY_ONBOARDING_DONE_KEY = 'treasurebox-onboarding-v13-done';

const STYLE_OPTIONS: Array<{
  id: PortalCoachStyle;
  labelKey: PortalStringKey;
  hintKey: PortalStringKey;
}> = [
  { id: 'minimal', labelKey: 'onboardingStyleMinimalLabel', hintKey: 'onboardingStyleMinimalHint' },
  { id: 'warm', labelKey: 'onboardingStyleWarmLabel', hintKey: 'onboardingStyleWarmHint' },
  { id: 'professional', labelKey: 'onboardingStyleProfessionalLabel', hintKey: 'onboardingStyleProfessionalHint' },
];

export default function PortalOnboarding() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<'name' | 'style'>('name');
  const [displayName, setDisplayName] = useState('婧');
  const [coachStyle, setCoachStyle] = useState<PortalCoachStyle>('warm');
  const [locale, setLocale] = useState<PortalLocale>('zh');

  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDING_DONE_KEY) === '1' || localStorage.getItem(LEGACY_ONBOARDING_DONE_KEY) === '1') return;
      const profile = loadProfileSettings();
      setDisplayName(profile.displayName || '婧');
      setCoachStyle(profile.coachStyle);
      setLocale(profile.locale);
      setStep('name');
      setVisible(true);
    } catch {
      /* keep hidden if storage is not available */
    }
  }, []);

  if (!visible) return null;

  const submit = () => {
    const name = displayName.trim() || '婧';
    saveProfileSettings({ displayName: name, coachStyle });
    try {
      localStorage.setItem(ONBOARDING_DONE_KEY, '1');
      localStorage.setItem(LEGACY_ONBOARDING_DONE_KEY, '1');
    } catch { /* ignore */ }
    setVisible(false);
  };

  return (
    <div className="portal-onboarding" role="dialog" aria-modal="true" aria-labelledby="portal-onboarding-title">
      <div className="portal-onboarding-card">
        <p className="portal-onboarding-kicker">Nesio V14</p>
        <h1 id="portal-onboarding-title">{t(locale, 'onboardingTitle')}</h1>
        {step === 'name' ? (
          <>
            <p className="portal-onboarding-copy">{t(locale, 'onboardingNameCopy')}</p>
            <p className="portal-onboarding-note">{t(locale, 'onboardingNameNote')}</p>

            <label className="portal-onboarding-label" htmlFor="portal-onboarding-name">
              {t(locale, 'onboardingNameLabel')}
            </label>
            <input
              id="portal-onboarding-name"
              className="portal-onboarding-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={24}
              autoComplete="name"
            />

            <button
              type="button"
              className="portal-onboarding-continue"
              onClick={() => setStep('style')}
            >
              {t(locale, 'onboardingContinue')}
            </button>
          </>
        ) : (
          <>
            <p className="portal-onboarding-copy">{t(locale, 'onboardingStyleCopy')}</p>
            <p className="portal-onboarding-note">{t(locale, 'onboardingStyleNote')}</p>

            <div className="portal-onboarding-styles" aria-label={t(locale, 'onboardingStyleAriaLabel')}>
              {STYLE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={
                    'portal-onboarding-style' +
                    (coachStyle === option.id ? ' portal-onboarding-style--active' : '')
                  }
                  onClick={() => setCoachStyle(option.id)}
                  aria-pressed={coachStyle === option.id}
                >
                  <span>{t(locale, option.labelKey)}</span>
                  <small>{t(locale, option.hintKey)}</small>
                </button>
              ))}
            </div>

            <button type="button" className="portal-onboarding-continue" onClick={submit}>
              {t(locale, 'onboardingContinue')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
