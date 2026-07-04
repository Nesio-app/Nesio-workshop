'use client';

import { useEffect, useState } from 'react';
import { t } from '@/lib/portal/i18n';
import { loadProfileSettings, type PortalLocale } from '@/lib/portal/profile';

type ThemeChoice = 'day' | 'night' | 'auto';
const KEY = 'treasurebox-theme';

function resolve(choice: ThemeChoice): 'day' | 'night' {
  if (choice === 'day') return 'day';
  if (choice === 'night') return 'night';
  const dark =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const h = new Date().getHours();
  return dark || h < 6 || h >= 19 ? 'night' : 'day';
}

function apply(choice: ThemeChoice) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-portal-theme', resolve(choice));
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* ignore */
  }
}

type ThemeLabelKey = 'themeDay' | 'themeNight' | 'themeAuto';
const OPTIONS: { value: ThemeChoice; labelKey: ThemeLabelKey; icon: React.ReactNode }[] = [
  {
    value: 'day',
    labelKey: 'themeDay',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4l1.4-1.4M18 6l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: 'night',
    labelKey: 'themeNight',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    ),
  },
  {
    value: 'auto',
    labelKey: 'themeAuto',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

export default function PortalThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>('auto');
  const [locale, setLocale] = useState<PortalLocale>('zh');

  useEffect(() => {
    let saved: ThemeChoice = 'auto';
    try {
      saved = (localStorage.getItem(KEY) as ThemeChoice) || 'auto';
    } catch {
      /* ignore */
    }
    setChoice(saved);
    setLocale(loadProfileSettings().locale);
    apply(saved);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => {
      let c: ThemeChoice = 'auto';
      try {
        c = (localStorage.getItem(KEY) as ThemeChoice) || 'auto';
      } catch {
        /* ignore */
      }
      if (c === 'auto') apply('auto');
    };
    mq.addEventListener('change', onSystem);

    const timer = window.setInterval(onSystem, 60_000);
    return () => {
      mq.removeEventListener('change', onSystem);
      window.clearInterval(timer);
    };
  }, []);

  const pick = (c: ThemeChoice) => {
    setChoice(c);
    apply(c);
  };

  return (
    <div className="portal-theme-seg" role="group" aria-label={t(locale, 'themeToggleLabel')}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className={'portal-theme-seg-btn' + (choice === o.value ? ' is-on' : '')}
          aria-pressed={choice === o.value}
          onClick={() => pick(o.value)}
        >
          <span className="portal-theme-seg-icon" aria-hidden>
            {o.icon}
          </span>
          {t(locale, o.labelKey)}
        </button>
      ))}
    </div>
  );
}
