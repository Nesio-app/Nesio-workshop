'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatAccountSettingsMemoryConfidence,
  formatAccountSettingsMemoryCount,
  formatAccountSettingsMemoryEvidence,
  formatAccountSettingsMemoryStrength,
  formatAccountSettingsPreferenceSummary,
  formatAccountSettingsUsageDays,
  t,
  type PortalStringKey,
} from '@/lib/portal/i18n';
import {
  loadProfileSettings,
  normalizePortalLocale,
  portalLocaleToHtmlLang,
  readAvatarFile,
  saveProfileSettings,
  type PortalCoachStyle,
  type PortalLocale,
} from '@/lib/portal/profile';
import {
  loadCalendarLinkSettings,
} from '@/lib/portal/calendar-links';
import {
  createAppApiClient,
  type AuthSessionResponse,
  type AuthStartProvider,
  type CloudProfileSettings,
  type ProductionRuntimeHealthResponse,
  type ProductionRuntimeProviderAction,
  type ProductionRuntimeSetupTask,
} from '@/lib/portal/app-api-client';
import {
  getBaohePersonalizationProfile,
  readBaohePersonalizationStage,
  type BaohePersonalizationStage,
} from '@/lib/portal/personalization-insights';
import type { PortalConfig } from '@/lib/portal/types';
import PortalThemeToggle from './PortalThemeToggle';

const LANGUAGE_OPTIONS = [
  ['zh', '简体中文'],
  ['en', 'English'],
  ['zh-TW', '繁體中文'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
  ['vi', 'Tiếng Việt'],
  ['th', 'ไทย'],
] as const;

type DisplayLanguage = (typeof LANGUAGE_OPTIONS)[number][0];
type CloudProfileStatus = 'idle' | 'loading' | 'synced' | 'local_only' | 'not_signed_in' | 'error';

const DISPLAY_LANGUAGE_KEY = 'treasurebox-display-language-v1';
const OBSERVATION_PUSH_KEY = 'treasurebox-observation-push-enabled-v1';

function normalizeDisplayLanguage(value: string | null | undefined): DisplayLanguage {
  return LANGUAGE_OPTIONS.some(([code]) => code === value) ? value as DisplayLanguage : 'zh';
}

function normalizeProfileLocale(value: string | null | undefined): PortalLocale {
  return normalizePortalLocale(value);
}

function normalizeCoachStyle(value: string | null | undefined): PortalCoachStyle {
  return value === 'minimal' || value === 'professional' ? value : 'warm';
}

function normalizeCloudProfileSettings(
  settings: CloudProfileSettings | undefined,
  fallbackName: string,
) {
  return {
    displayName: typeof settings?.displayName === 'string' && settings.displayName.trim()
      ? settings.displayName.trim()
      : fallbackName,
    avatarUrl: typeof settings?.avatarUrl === 'string' ? settings.avatarUrl : '',
    locale: normalizeProfileLocale(settings?.locale),
    coachStyle: normalizeCoachStyle(settings?.coachStyle),
    displayLanguage: normalizeDisplayLanguage(settings?.displayLanguage || settings?.locale),
    calendarUrl: typeof settings?.calendarUrl === 'string' ? settings.calendarUrl : '',
  };
}

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
  const [displayLanguage, setDisplayLanguage] = useState<DisplayLanguage>('zh');
  const [calendarUrl, setCalendarUrl] = useState('');
  const [toast, setToast] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<ProductionRuntimeHealthResponse | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [authSession, setAuthSession] = useState<AuthSessionResponse | null>(null);
  const [authSessionLoading, setAuthSessionLoading] = useState(true);
  const [authFeedback, setAuthFeedback] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [cloudProfileStatus, setCloudProfileStatus] = useState<CloudProfileStatus>('idle');
  const [personalizationStage, setPersonalizationStage] = useState<BaohePersonalizationStage>('day_34');
  const [showAppSettings, setShowAppSettings] = useState(false);
  const [showLearningProgress, setShowLearningProgress] = useState(false);
  const [observationPushEnabled, setObservationPushEnabled] = useState(true);
  const personalization = getBaohePersonalizationProfile(personalizationStage);

  useEffect(() => {
    const s = loadProfileSettings(fallbackName);
    setDisplayName(s.displayName);
    setAvatarUrl(s.avatarUrl);
    setLocale(s.locale);
    setDisplayLanguage(normalizeDisplayLanguage(localStorage.getItem(DISPLAY_LANGUAGE_KEY) || s.locale));
    setCalendarUrl(loadCalendarLinkSettings().googleCalendarUrl);
    setPersonalizationStage(readBaohePersonalizationStage());
    setObservationPushEnabled(localStorage.getItem(OBSERVATION_PUSH_KEY) === 'false' ? false : personalization.preferences.observationPushEnabled);
    document.documentElement.lang = portalLocaleToHtmlLang(s.locale);
  }, [fallbackName, personalization.preferences.observationPushEnabled]);

  useEffect(() => {
    let alive = true;
    const client = createAppApiClient();
    setRuntimeLoading(true);
    setAuthSessionLoading(true);
    client
      .fetchProductionRuntimeHealth()
      .then((status) => {
        if (alive) setRuntimeStatus(status);
      })
      .catch(() => {
        if (alive) setRuntimeStatus(null);
      })
      .finally(() => {
        if (alive) setRuntimeLoading(false);
      });
    client
      .fetchAuthSession()
      .then((session) => {
        if (alive) setAuthSession(session);
      })
      .catch(() => {
        if (alive) setAuthSession(null);
      })
      .finally(() => {
        if (alive) setAuthSessionLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const client = createAppApiClient();
    setCloudProfileStatus('loading');
    client
      .fetchCloudProfileSettings()
      .then((result) => {
        if (!alive) return;
        if (result.ok && result.settings) {
          const next = normalizeCloudProfileSettings(result.settings, fallbackName);
          const nextProfile = {
            displayName: next.displayName,
            avatarUrl: next.avatarUrl,
            locale: next.locale,
            coachStyle: next.coachStyle,
          };
          setDisplayName(next.displayName);
          setAvatarUrl(next.avatarUrl);
          setLocale(next.locale);
          setDisplayLanguage(next.displayLanguage);
          setCalendarUrl(next.calendarUrl);
          saveProfileSettings(nextProfile);
          localStorage.setItem(DISPLAY_LANGUAGE_KEY, next.displayLanguage);
          document.documentElement.lang = next.displayLanguage;
          setCloudProfileStatus('synced');
          return;
        }
        setCloudProfileStatus(result.error === 'not_signed_in' ? 'not_signed_in' : 'local_only');
      })
      .catch(() => {
        if (alive) setCloudProfileStatus('local_only');
      });

    return () => {
      alive = false;
    };
  }, [fallbackName]);

  const showToast = (key: PortalStringKey) => {
    setToast(t(locale, key));
    window.setTimeout(() => setToast(''), 1800);
  };

  const syncCloudProfileSettings = async (settings: CloudProfileSettings) => {
    setCloudProfileStatus('loading');
    try {
      const client = createAppApiClient();
      const result = await client.saveCloudProfileSettings(settings);
      setCloudProfileStatus(result.ok ? 'synced' : result.error === 'not_signed_in' ? 'not_signed_in' : 'local_only');
    } catch {
      setCloudProfileStatus('local_only');
    }
  };

  const onPickAvatar = async (file: File) => {
    try {
      const dataUrl = await readAvatarFile(file);
      setAvatarUrl(dataUrl);
      saveProfileSettings({ avatarUrl: dataUrl });
      void syncCloudProfileSettings({
        displayName,
        avatarUrl: dataUrl,
        locale,
        displayLanguage,
        calendarUrl,
      });
      showToast('settingsSaved');
    } catch { /* ignore */ }
  };

  const onDisplayLanguageChange = (next: DisplayLanguage) => {
    setDisplayLanguage(next);
    localStorage.setItem(DISPLAY_LANGUAGE_KEY, next);
    const profileLocale: PortalLocale = normalizePortalLocale(next);
    setLocale(profileLocale);
    saveProfileSettings({ locale: profileLocale });
    void syncCloudProfileSettings({
      displayName,
      avatarUrl,
      locale: profileLocale,
      displayLanguage: next,
      calendarUrl,
    });
    document.documentElement.lang = portalLocaleToHtmlLang(profileLocale);
    showToast('settingsSaved');
  };

  const onObservationPushToggle = () => {
    setObservationPushEnabled((current) => {
      const next = !current;
      localStorage.setItem(OBSERVATION_PUSH_KEY, String(next));
      return next;
    });
    showToast('settingsSaved');
  };

  const cloudProfileStatusLabel = (() => {
    if (cloudProfileStatus === 'synced') return t(locale, 'providerStatusSynced');
    if (cloudProfileStatus === 'loading') return t(locale, 'providerStatusSyncing');
    if (cloudProfileStatus === 'not_signed_in') return t(locale, 'providerStatusNotSignedIn');
    if (cloudProfileStatus === 'error') return t(locale, 'providerStatusSyncFailed');
    return t(locale, 'providerStatusLocalSaved');
  })();

  const providerActionsById = useMemo(() => {
    return (runtimeStatus?.providerActionMatrix || []).reduce<Record<string, ProductionRuntimeProviderAction>>(
      (index, action) => {
        index[action.id] = action;
        return index;
      },
      {},
    );
  }, [runtimeStatus?.providerActionMatrix]);
  const setupTasksById = useMemo(() => {
    return (runtimeStatus?.setupTaskMatrix || []).reduce<Record<string, ProductionRuntimeSetupTask>>(
      (index, task) => {
        index[task.id] = task;
        return index;
      },
      {},
    );
  }, [runtimeStatus?.setupTaskMatrix]);
  const runtimeMissingEnvList = useMemo(() => {
    return Array.from(new Set(
      (runtimeStatus?.providerActionMatrix || []).flatMap((provider) => provider.missingEnv),
    )).sort();
  }, [runtimeStatus?.providerActionMatrix]);
  const runtimeReadinessSummary = runtimeStatus?.summary;
  const runtimeSetupTaskSummary = runtimeReadinessSummary
    ? {
      blocked: runtimeReadinessSummary.blockedSetupTaskCount,
      total: runtimeReadinessSummary.setupTaskCount,
    }
    : null;
  const runtimeCanonicalDomainMismatch = Boolean(
    runtimeStatus
      && runtimeStatus.requestHost
      && !runtimeStatus.canonicalDomainMatchesRequestHost,
  );

  const formatProviderActionStatus = (
    provider?: ProductionRuntimeProviderAction,
    providerSetupTask?: ProductionRuntimeSetupTask,
  ): string => {
    if (!provider) return runtimeLoading ? t(locale, 'providerStatusChecking') : t(locale, 'providerStatusNotConnected');
    if (providerSetupTask?.blockedReason === 'canonical_domain_mismatch') return t(locale, 'providerStatusPendingEnable');
    if (provider.actionStatus === 'ready') return t(locale, 'providerStatusReady');
    if (provider.actionStatus === 'server_ready') return t(locale, 'providerStatusServerReady');
    if (provider.configured) return t(locale, 'providerStatusPendingEnable');
    return t(locale, 'providerStatusMissingConfig');
  };

  const formatProviderActionDetail = (
    provider?: ProductionRuntimeProviderAction,
    providerSetupTask?: ProductionRuntimeSetupTask,
  ): string => {
    if (!provider) return t(locale, 'providerDetailLoadingRuntime');
    if (providerSetupTask?.blockedReason === 'canonical_domain_mismatch') {
      return t(locale, 'providerSetupBlockedCanonicalDomain', {
        canonical: runtimeStatus?.canonicalDomain || 'www.nesio.app',
        host: runtimeStatus?.requestHost || '',
      });
    }
    if (provider.actionStatus === 'ready') {
      return provider.startEndpoint
        ? t(locale, 'providerDetailReadyWithEndpointTemplate', {
          endpoint: provider.startEndpoint,
          action: provider.safeUserAction,
        })
        : t(locale, 'providerDetailReadyTemplate', { action: provider.safeUserAction });
    }
    if (provider.actionStatus === 'server_ready') {
      return t(locale, 'providerDetailServerReadyTemplate', { action: provider.safeUserAction });
    }
    if (provider.missingEnv.length) {
      return t(locale, 'providerDetailMissingEnvTemplate', {
        missing: `${provider.missingEnv.slice(0, 3).join(' / ')}${provider.missingEnv.length > 3 ? '…' : ''}`,
      });
    }
    return t(locale, 'providerDetailConfiguredButDisabled');
  };

  const onInspectServerProviderAction = (provider: ProductionRuntimeProviderAction) => {
    if (provider.actionStatus === 'server_ready') {
      setAuthFeedback(t(locale, 'providerServerReadyFeedbackTemplate', {
        provider: provider.label,
        action: provider.safeUserAction,
      }));
      return;
    }
    if (provider.missingEnv.length) {
      setAuthFeedback(t(locale, 'providerStillMissingConfigTemplate', {
        provider: provider.label,
        missing: provider.missingEnv.slice(0, 4).join(' / '),
      }));
      return;
    }
    setAuthFeedback(t(locale, 'providerConfiguredButRuntimeOffTemplate', { provider: provider.label }));
  };

  const formatProviderActionButtonLabel = (provider?: ProductionRuntimeProviderAction): string => {
    if (!provider) return t(locale, 'providerActionChecking');
    if (provider.serverOnly) return t(locale, 'providerActionInspect');
    if (provider.actionStatus === 'ready') return t(locale, 'providerActionOpen');
    return t(locale, 'providerActionPendingConfig');
  };

  const onOpenProviderAction = (provider?: ProductionRuntimeProviderAction) => {
    if (!provider) {
      setAuthFeedback(t(locale, 'providerReadStateLater'));
      return;
    }
    const providerSetupTask = setupTasksById[provider.id];
    if (providerSetupTask?.blockedReason === 'canonical_domain_mismatch') {
      setAuthFeedback(t(locale, 'providerSetupBlockedCanonicalDomain', {
        canonical: runtimeStatus?.canonicalDomain || 'www.nesio.app',
        host: runtimeStatus?.requestHost || '',
      }));
      return;
    }
    if (provider.serverOnly) {
      onInspectServerProviderAction(provider);
      return;
    }
    if (provider.actionStatus !== 'ready' || !provider.startEndpoint) {
      const reason = provider.missingEnv.length
        ? t(locale, 'providerMissingEnv', { missing: provider.missingEnv.slice(0, 3).join(' / ') })
        : t(locale, 'providerRuntimeNotReady');
      setAuthFeedback(t(locale, 'providerUnavailableTemplate', {
        provider: provider.label,
        reason,
      }));
      return;
    }
    if (provider.startEndpoint === '/api/auth/start') {
      if (provider.id === 'google' || provider.id === 'wechat') {
        void onStartAuth(provider.id);
        return;
      }
      setAuthFeedback(t(locale, 'authUseSignInForm'));
      return;
    }
    window.location.assign(provider.startEndpoint);
  };

  const onStartAuth = async (provider: AuthStartProvider) => {
    if (provider === 'email' && !authEmail.trim()) {
      setAuthFeedback(t(locale, 'authNeedEmail'));
      return;
    }
    if (provider === 'phone' && !authPhone.trim()) {
      setAuthFeedback(t(locale, 'authNeedPhone'));
      return;
    }
    setAuthFeedback(t(locale, 'authConnecting'));
    try {
      const client = createAppApiClient();
      const result = await client.startAuth({
        provider,
        email: authEmail.trim(),
        phone: authPhone.trim(),
      });
      if (result.ok && result.action === 'redirect' && result.url) {
        setAuthFeedback(t(locale, 'authRedirecting'));
        window.location.assign(result.url);
        return;
      }
      if (result.ok && result.action === 'otp_sent') {
        setAuthFeedback(t(locale, 'authOtpSent'));
        return;
      }
      if (result.error === 'canonical_domain_mismatch') {
        setAuthFeedback(t(locale, 'providerSetupBlockedCanonicalDomain', {
          canonical: runtimeStatus?.canonicalDomain || 'www.nesio.app',
          host: runtimeStatus?.requestHost || '',
        }));
        return;
      }
      if (result.error === 'provider_not_configured') {
        setAuthFeedback(t(locale, 'authProviderNotConfiguredTemplate', {
          provider,
          reason: result.status?.missingEnv.slice(0, 3).join(' / ') || t(locale, 'authMissingEnvFallback'),
        }));
        return;
      }
      setAuthFeedback(result.error || t(locale, 'authStartFailed'));
    } catch {
      setAuthFeedback(t(locale, 'authServiceFailed'));
    }
  };

  const onLogoutAuth = async () => {
    if (!authSession?.loggedIn) {
      setAuthFeedback(t(locale, 'authNotLoggedIn'));
      return;
    }
    setAuthFeedback(t(locale, 'authSigningOut'));
    try {
      const client = createAppApiClient();
      const result = await client.logoutAuth();
      if (result.ok && result.signedOut) {
        setAuthSession({
          safePublicStatus: true,
          secretsRedacted: true,
          ok: true,
          loggedIn: false,
          hasRefreshToken: false,
          status: 'signed_out',
        });
        setAuthFeedback(t(locale, 'authSignedOut'));
        return;
      }
      setAuthFeedback(t(locale, 'authLogoutFailed'));
    } catch {
      setAuthFeedback(t(locale, 'authLogoutServiceFailed'));
    }
  };

  const onCopyMissingRuntimeEnv = async () => {
    if (!runtimeMissingEnvList.length) {
      setAuthFeedback(t(locale, 'runtimeAllConfigured'));
      return;
    }
    const text = runtimeMissingEnvList.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setAuthFeedback(t(locale, 'runtimeMissingEnvCopied', { count: String(runtimeMissingEnvList.length) }));
    } catch {
      setAuthFeedback(t(locale, 'runtimeMissingEnvFallback', {
        missing: runtimeMissingEnvList.slice(0, 8).join(' / '),
      }));
    }
  };

  const safetyRows: Array<{
    label: string;
    status: string;
    detail: string;
    provider?: ProductionRuntimeProviderAction;
  }> = [
    {
      label: 'Email',
      status: formatProviderActionStatus(providerActionsById.email, setupTasksById.email),
      detail: formatProviderActionDetail(providerActionsById.email, setupTasksById.email),
      provider: providerActionsById.email,
    },
    {
      label: 'Google',
      status: formatProviderActionStatus(providerActionsById.google, setupTasksById.google),
      detail: formatProviderActionDetail(providerActionsById.google, setupTasksById.google),
      provider: providerActionsById.google,
    },
    {
      label: 'WeChat',
      status: formatProviderActionStatus(providerActionsById.wechat, setupTasksById.wechat),
      detail: formatProviderActionDetail(providerActionsById.wechat, setupTasksById.wechat),
      provider: providerActionsById.wechat,
    },
    {
      label: 'Phone',
      status: formatProviderActionStatus(providerActionsById.phone, setupTasksById.phone),
      detail: formatProviderActionDetail(providerActionsById.phone, setupTasksById.phone),
      provider: providerActionsById.phone,
    },
    {
      label: 'Cloud DB',
      status: formatProviderActionStatus(providerActionsById.cloud_database, setupTasksById.cloud_database),
      detail: formatProviderActionDetail(providerActionsById.cloud_database, setupTasksById.cloud_database),
      provider: providerActionsById.cloud_database,
    },
    {
      label: 'Cloud Storage',
      status: formatProviderActionStatus(providerActionsById.cloud_storage, setupTasksById.cloud_storage),
      detail: formatProviderActionDetail(providerActionsById.cloud_storage, setupTasksById.cloud_storage),
      provider: providerActionsById.cloud_storage,
    },
    {
      label: 'Profile Settings',
      status: cloudProfileStatusLabel,
      detail: cloudProfileStatus === 'synced'
        ? t(locale, 'profileSettingsSyncedDetail')
        : t(locale, 'profileSettingsLocalDetail'),
    },
    {
      label: 'Google Calendar',
      status: formatProviderActionStatus(providerActionsById.google_calendar, setupTasksById.google_calendar),
      detail: providerActionsById.google_calendar?.enabled
        ? t(locale, 'googleCalendarConnectedDetail')
        : (calendarUrl ? t(locale, 'googleCalendarLocalLinkDetail') : formatProviderActionDetail(providerActionsById.google_calendar, setupTasksById.google_calendar)),
      provider: providerActionsById.google_calendar,
    },
    {
      label: t(locale, 'aiFriendsSafetyLabel'),
      status: t(locale, 'aiFriendsSafetyStatus'),
      detail: t(locale, 'aiFriendsSafetyDetail'),
    },
    {
      label: 'Gemini',
      status: formatProviderActionStatus(providerActionsById.gemini, setupTasksById.gemini),
      detail: formatProviderActionDetail(providerActionsById.gemini, setupTasksById.gemini),
      provider: providerActionsById.gemini,
    },
    {
      label: 'Flomo',
      status: formatProviderActionStatus(providerActionsById.flomo, setupTasksById.flomo),
      detail: formatProviderActionDetail(providerActionsById.flomo, setupTasksById.flomo),
      provider: providerActionsById.flomo,
    },
    {
      label: t(locale, 'trustModulesProtectedLabel'),
      status: t(locale, 'trustModulesProtectedStatus'),
      detail: t(locale, 'trustModulesProtectedDetail'),
    },
    {
      label: t(locale, 'automationExternalAuthLabel'),
      status: t(locale, 'automationExternalAuthStatus'),
      detail: t(locale, 'automationExternalAuthDetail'),
    },
  ];

  return (
    <div className="portal-settings">
      {showAppSettings ? (
        <header className="portal-settings-head">
          <button type="button" className="portal-settings-back portal-settings-back--button" onClick={() => setShowAppSettings(false)}>
            ‹ {t(locale, 'accountSettingsBack')}
          </button>
          <h1 className="portal-settings-title">{t(locale, 'accountSettingsTitle')}</h1>
        </header>
      ) : null}

      {!showAppSettings ? (
        <section className="portal-personal-profile-card">
          <div className="portal-personal-profile-main">
            <button type="button" className="portal-personal-avatar-edit" onClick={() => fileRef.current?.click()} aria-label={t(locale, 'accountSettingsAvatarChange')}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="portal-settings-avatar" width={64} height={64} />
              ) : (
                <span className="portal-personal-profile-avatar" aria-hidden>
                  {initials(displayName)}
                </span>
              )}
            </button>
            <span>
              <b>{displayName}</b>
              <small>{formatAccountSettingsUsageDays(locale, personalization.daysSinceStart)}</small>
            </span>
            <Link href="/portfolio" className="portal-personal-settings-arrow" aria-label={t(locale, 'accountSettingsHomepageAriaLabel')}>
              {t(locale, 'accountSettingsHomepage')}
            </Link>
          </div>
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
      ) : null}

      {!showAppSettings ? (
        <button type="button" className="portal-personal-software-settings" onClick={() => setShowAppSettings(true)}>
          {t(locale, 'accountSettingsOpenSoftwareSettings')}
        </button>
      ) : null}

      {!showAppSettings ? (
        <>
          <section className="portal-personal-learned">
            <div className="portal-personal-learned-head">
              <h2>{t(locale, 'accountSettingsLearnedTitle')}</h2>
              <span>{formatAccountSettingsMemoryCount(locale, personalization.memoryCount)}</span>
              <small>{personalization.summary}</small>
            </div>
            <div className="portal-personal-progress-row">
              <span style={{ width: `${personalization.memoryProgress}%` }} />
              <b>{personalization.memoryProgress}%</b>
            </div>
            <p>{personalization.memoryProgressLabel}</p>
            {personalization.memories.length ? (
              <div className="portal-personal-memory-list">
                {personalization.memories.map((memory) => (
                  <article key={memory.category}>
                    <span>{memory.category}</span>
                    <div>
                      <b>{memory.text}</b>
                      <small>{formatAccountSettingsMemoryConfidence(locale, memory.confidence)}</small>
                    </div>
                    <i aria-label={formatAccountSettingsMemoryStrength(locale, memory.strength)}>
                      {Array.from({ length: 3 }, (_, index) => (
                        <em key={index} className={index < memory.strength ? 'is-on' : ''} />
                      ))}
                    </i>
                  </article>
                ))}
              </div>
            ) : (
              <div className="portal-personal-empty">{t(locale, 'accountSettingsMemoryEmpty')}</div>
            )}
            {showLearningProgress ? (
              <div className="portal-personal-progress-detail" id="portal-personal-progress-detail">
                <h3>{t(locale, 'accountSettingsProgressTitle')}</h3>
                <ul>
                  {personalization.memories.map((memory) => (
                    <li key={memory.id}>
                      <b>{memory.category}</b>
                      <span>{memory.text}</span>
                      <small>{formatAccountSettingsMemoryEvidence(locale, memory.evidenceCount, memory.confidence)}</small>
                    </li>
                  ))}
                </ul>
                <p>{formatAccountSettingsPreferenceSummary(locale, personalization.preferences.pace, personalization.preferences.pushTime)}</p>
              </div>
            ) : null}
            <button
              type="button"
              className="portal-personal-progress-link"
              aria-expanded={showLearningProgress}
              aria-controls="portal-personal-progress-detail"
              onClick={() => setShowLearningProgress((value) => !value)}
            >
              {showLearningProgress ? t(locale, 'accountSettingsCollapseProgress') : t(locale, 'accountSettingsViewAllProgress')}
            </button>
          </section>

          <section className="portal-personal-preferences">
            <h2>{t(locale, 'accountSettingsPreferencesTitle')}</h2>
            <div>
              <span>{t(locale, 'accountSettingsPacePreference')}</span>
              <b>{personalization.preferences.pace}</b>
              <small>{t(locale, 'accountSettingsPaceEfficient')}</small>
            </div>
            <div>
              <span>{t(locale, 'accountSettingsPushTime')}</span>
              <b>{personalization.preferences.pushTime}</b>
              <i aria-hidden>›</i>
            </div>
            <div>
              <span>{t(locale, 'accountSettingsObservationPush')}</span>
              <button
                type="button"
                className={observationPushEnabled ? 'is-on' : ''}
                aria-label={t(locale, 'accountSettingsObservationPush')}
                aria-pressed={observationPushEnabled}
                onClick={onObservationPushToggle}
              />
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="portal-settings-card">
        <h2 className="portal-settings-label">{t(locale, 'accountSettingsAppearanceTitle')}</h2>
        <p className="portal-settings-hint">{t(locale, 'accountSettingsAppearanceHint')}</p>
        <PortalThemeToggle />
      </section>

      <section className="portal-settings-card">
        <h2 className="portal-settings-label">{t(locale, 'accountSettingsLanguage')}</h2>
        <select
          className="portal-settings-input portal-settings-select"
          aria-label={t(locale, 'accountSettingsLanguageAriaLabel')}
          value={displayLanguage}
          onChange={(event) => onDisplayLanguageChange(normalizeDisplayLanguage(event.target.value))}
        >
          {LANGUAGE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </section>

      <section className="portal-settings-card portal-settings-safety" aria-label={t(locale, 'accountSettingsConnections')}>
        <div className="portal-settings-safety-head">
          <div>
            <h2 className="portal-settings-label">{t(locale, 'accountSettingsConnections')}</h2>
            <p className="portal-settings-hint">{t(locale, 'accountSettingsConnectionsHint')}</p>
          </div>
          <span>{t(locale, 'accountSettingsLocalFirst')}</span>
        </div>
        <div className="portal-settings-runtime-summary" data-runtime-action="runtime-readiness-summary">
          <div>
            <strong>{t(locale, 'runtimeReadinessTitle')}</strong>
            <p>
              {runtimeLoading
                ? t(locale, 'runtimeReadinessLoading')
                : runtimeReadinessSummary?.productionRuntimeReady
                  ? t(locale, 'runtimeReadinessReady', {
                    enabled: String(runtimeReadinessSummary.enabledProviderCount),
                    total: String(runtimeReadinessSummary.providerCount),
                  })
                  : runtimeCanonicalDomainMismatch
                    ? t(locale, 'runtimeCanonicalDomainMismatch', {
                      canonical: runtimeStatus?.canonicalDomain || 'www.nesio.app',
                      host: runtimeStatus?.requestHost || '',
                    })
                  : t(locale, 'runtimeReadinessBlocked', {
                    enabled: String(runtimeReadinessSummary?.enabledProviderCount || 0),
                    total: String(runtimeReadinessSummary?.providerCount || 0),
                    missing: String(runtimeReadinessSummary?.missingProviderCount || 0),
                  })}
            </p>
            {runtimeSetupTaskSummary ? (
              <small>
                {t(locale, 'runtimeSetupTasksBlocked', {
                  blocked: String(runtimeSetupTaskSummary.blocked),
                  total: String(runtimeSetupTaskSummary.total),
                })}
              </small>
            ) : null}
          </div>
          <button type="button" data-runtime-action="runtime-copy-missing-env" onClick={onCopyMissingRuntimeEnv}>
            {runtimeMissingEnvList.length
              ? t(locale, 'runtimeCopyMissingEnv')
              : t(locale, 'runtimeNoMissingEnv')}
          </button>
        </div>
        <ul className="portal-settings-safety-list">
          <li className="portal-settings-auth-actions">
            <div>
              <strong>{t(locale, 'authLoginTitle')}</strong>
              <p>
                {authSessionLoading
                  ? t(locale, 'authLoginLoading')
                  : authSession?.loggedIn
                    ? t(locale, 'authLoggedInTemplate', {
                      identity: authSession.user?.email || authSession.user?.phone || t(locale, 'authStatusLoggedIn'),
                    })
                    : t(locale, 'authLoginHelp')}
              </p>
            </div>
            <span>{authSession?.loggedIn ? t(locale, 'authStatusLoggedIn') : runtimeStatus?.accountAuth.enabled ? t(locale, 'authStatusEnabled') : t(locale, 'authStatusPendingConfig')}</span>
            <div className="portal-settings-auth-inputs">
              <label>
                <span>Email</span>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                />
              </label>
              <label>
                <span>Phone</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+1 555 000 0000"
                  value={authPhone}
                  onChange={(event) => setAuthPhone(event.target.value)}
                />
              </label>
            </div>
            <div className="portal-settings-auth-buttons">
              <button type="button" data-runtime-action="auth-start-email" onClick={() => onStartAuth('email')}>Email</button>
              <button type="button" data-runtime-action="auth-start-google" onClick={() => onStartAuth('google')}>Google</button>
              <button type="button" data-runtime-action="auth-start-wechat" onClick={() => onStartAuth('wechat')}>WeChat</button>
              <button type="button" data-runtime-action="auth-start-phone" onClick={() => onStartAuth('phone')}>Phone</button>
              <button type="button" data-runtime-action="auth-logout" onClick={onLogoutAuth}>{t(locale, 'authSignOut')}</button>
            </div>
          </li>
          {safetyRows.map((row) => (
            <li key={row.label}>
              <div>
                <strong>{row.label}</strong>
                <p>{row.detail}</p>
              </div>
              <span>{row.status}</span>
              {'provider' in row ? (
                <button
                  type="button"
                  className="portal-settings-provider-action"
                  data-runtime-action="provider-open-or-inspect"
                  data-provider-action-id={row.provider?.id || row.label}
                  onClick={() => onOpenProviderAction(row.provider)}
                >
                  {formatProviderActionButtonLabel(row.provider)}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {authFeedback ? (
          <p className="portal-settings-auth-feedback" role="status" aria-live="polite">
            {authFeedback}
          </p>
        ) : null}
      </section>
        </>
      )}

      {toast ? <div className="portal-settings-toast" role="status">{toast}</div> : null}
    </div>
  );
}
