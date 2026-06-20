'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { t, type PortalStringKey } from '@/lib/portal/i18n';
import {
  loadProfileSettings,
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
  type ProductionRuntimeProviderAction,
  type ProductionRuntimeHealthResponse,
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

const SETTINGS_COPY: Record<DisplayLanguage, {
  back: string;
  settingsTitle: string;
  appearanceTitle: string;
  appearanceHint: string;
  language: string;
  connections: string;
  connectionsHint: string;
  localFirst: string;
}> = {
  zh: {
    back: '返回',
    settingsTitle: '软件设置',
    appearanceTitle: '外观',
    appearanceHint: '选择固定日 / 夜，或随系统与时段自动切换宝盒主题。',
    language: '显示语言',
    connections: '连接与安全',
    connectionsHint: '连接性强，但所有授权都要确认。',
    localFirst: '本地优先',
  },
  en: {
    back: 'Back',
    settingsTitle: 'App Settings',
    appearanceTitle: 'Appearance',
    appearanceHint: 'Choose day/night themes, or follow system and time automatically.',
    language: 'Display language',
    connections: 'Connections & Safety',
    connectionsHint: 'Connections are powerful, but every authorization needs confirmation.',
    localFirst: 'Local-first',
  },
  'zh-TW': {
    back: '返回',
    settingsTitle: '軟體設定',
    appearanceTitle: '外觀',
    appearanceHint: '選擇固定日 / 夜，或隨系統與時段自動切換主題。',
    language: '顯示語言',
    connections: '連線與安全',
    connectionsHint: '連線能力很強，但所有授權都要確認。',
    localFirst: '本機優先',
  },
  ja: {
    back: '戻る',
    settingsTitle: 'アプリ設定',
    appearanceTitle: '表示',
    appearanceHint: '昼/夜テーマ、またはシステムと時間に合わせて切り替えます。',
    language: '表示言語',
    connections: '接続と安全',
    connectionsHint: '接続は強力ですが、すべての認可には確認が必要です。',
    localFirst: 'ローカル優先',
  },
  ko: {
    back: '뒤로',
    settingsTitle: '앱 설정',
    appearanceTitle: '화면',
    appearanceHint: '낮/밤 테마를 선택하거나 시스템과 시간에 맞춰 전환합니다.',
    language: '표시 언어',
    connections: '연결 및 안전',
    connectionsHint: '연결 기능은 강력하지만 모든 권한은 확인이 필요합니다.',
    localFirst: '로컬 우선',
  },
  fr: {
    back: 'Retour',
    settingsTitle: 'Réglages',
    appearanceTitle: 'Apparence',
    appearanceHint: 'Choisissez le mode jour/nuit ou suivez le système et l’heure.',
    language: 'Langue',
    connections: 'Connexions et sécurité',
    connectionsHint: 'Les connexions sont puissantes, chaque autorisation doit être confirmée.',
    localFirst: 'Local d’abord',
  },
  de: {
    back: 'Zurück',
    settingsTitle: 'App-Einstellungen',
    appearanceTitle: 'Darstellung',
    appearanceHint: 'Tag/Nacht wählen oder System und Uhrzeit folgen.',
    language: 'Anzeigesprache',
    connections: 'Verbindungen & Sicherheit',
    connectionsHint: 'Verbindungen sind mächtig, jede Autorisierung braucht Bestätigung.',
    localFirst: 'Lokal zuerst',
  },
  es: {
    back: 'Atrás',
    settingsTitle: 'Ajustes',
    appearanceTitle: 'Apariencia',
    appearanceHint: 'Elige día/noche o sigue el sistema y la hora.',
    language: 'Idioma',
    connections: 'Conexiones y seguridad',
    connectionsHint: 'Las conexiones son potentes, toda autorización requiere confirmación.',
    localFirst: 'Local primero',
  },
  it: {
    back: 'Indietro',
    settingsTitle: 'Impostazioni',
    appearanceTitle: 'Aspetto',
    appearanceHint: 'Scegli giorno/notte o segui sistema e orario.',
    language: 'Lingua',
    connections: 'Connessioni e sicurezza',
    connectionsHint: 'Le connessioni sono potenti, ogni autorizzazione va confermata.',
    localFirst: 'Prima locale',
  },
  pt: {
    back: 'Voltar',
    settingsTitle: 'Configurações',
    appearanceTitle: 'Aparência',
    appearanceHint: 'Escolha dia/noite ou siga o sistema e o horário.',
    language: 'Idioma',
    connections: 'Conexões e segurança',
    connectionsHint: 'Conexões são fortes, toda autorização precisa de confirmação.',
    localFirst: 'Local primeiro',
  },
  vi: {
    back: 'Quay lại',
    settingsTitle: 'Cài đặt',
    appearanceTitle: 'Giao diện',
    appearanceHint: 'Chọn ngày/đêm hoặc theo hệ thống và thời gian.',
    language: 'Ngôn ngữ hiển thị',
    connections: 'Kết nối & an toàn',
    connectionsHint: 'Kết nối rất mạnh, mọi quyền đều cần xác nhận.',
    localFirst: 'Ưu tiên cục bộ',
  },
  th: {
    back: 'กลับ',
    settingsTitle: 'การตั้งค่า',
    appearanceTitle: 'รูปลักษณ์',
    appearanceHint: 'เลือกโหมดกลางวัน/กลางคืน หรือทำตามระบบและเวลา',
    language: 'ภาษาที่แสดง',
    connections: 'การเชื่อมต่อและความปลอดภัย',
    connectionsHint: 'การเชื่อมต่อทรงพลัง แต่ทุกสิทธิ์ต้องได้รับการยืนยัน',
    localFirst: 'Local-first',
  },
};

function normalizeDisplayLanguage(value: string | null | undefined): DisplayLanguage {
  return LANGUAGE_OPTIONS.some(([code]) => code === value) ? value as DisplayLanguage : 'zh';
}

function normalizeProfileLocale(value: string | null | undefined): PortalLocale {
  return value === 'en' ? 'en' : 'zh';
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
  const personalization = getBaohePersonalizationProfile(personalizationStage);

  useEffect(() => {
    const s = loadProfileSettings(fallbackName);
    setDisplayName(s.displayName);
    setAvatarUrl(s.avatarUrl);
    setLocale(s.locale);
    setDisplayLanguage(normalizeDisplayLanguage(localStorage.getItem(DISPLAY_LANGUAGE_KEY) || s.locale));
    setCalendarUrl(loadCalendarLinkSettings().googleCalendarUrl);
    setPersonalizationStage(readBaohePersonalizationStage());
    document.documentElement.lang = s.locale === 'en' ? 'en' : 'zh-CN';
  }, [fallbackName]);

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
    const profileLocale: PortalLocale = next === 'en' ? 'en' : 'zh';
    setLocale(profileLocale);
    saveProfileSettings({ locale: profileLocale });
    void syncCloudProfileSettings({
      displayName,
      avatarUrl,
      locale: profileLocale,
      displayLanguage: next,
      calendarUrl,
    });
    document.documentElement.lang = next;
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

  const formatProviderActionStatus = (provider?: ProductionRuntimeProviderAction): string => {
    if (!provider) return runtimeLoading ? t(locale, 'providerStatusChecking') : t(locale, 'providerStatusNotConnected');
    if (provider.actionStatus === 'ready') return t(locale, 'providerStatusReady');
    if (provider.actionStatus === 'server_ready') return t(locale, 'providerStatusServerReady');
    if (provider.configured) return t(locale, 'providerStatusPendingEnable');
    return t(locale, 'providerStatusMissingConfig');
  };

  const formatProviderActionDetail = (provider?: ProductionRuntimeProviderAction): string => {
    if (!provider) return t(locale, 'providerDetailLoadingRuntime');
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
    window.location.href = provider.startEndpoint;
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

  const copy = SETTINGS_COPY[displayLanguage] ?? SETTINGS_COPY.zh;

  const safetyRows: Array<{
    label: string;
    status: string;
    detail: string;
    provider?: ProductionRuntimeProviderAction;
  }> = [
    {
      label: 'Email',
      status: formatProviderActionStatus(providerActionsById.email),
      detail: formatProviderActionDetail(providerActionsById.email),
      provider: providerActionsById.email,
    },
    {
      label: 'Google',
      status: formatProviderActionStatus(providerActionsById.google),
      detail: formatProviderActionDetail(providerActionsById.google),
      provider: providerActionsById.google,
    },
    {
      label: 'WeChat',
      status: formatProviderActionStatus(providerActionsById.wechat),
      detail: formatProviderActionDetail(providerActionsById.wechat),
      provider: providerActionsById.wechat,
    },
    {
      label: 'Phone',
      status: formatProviderActionStatus(providerActionsById.phone),
      detail: formatProviderActionDetail(providerActionsById.phone),
      provider: providerActionsById.phone,
    },
    {
      label: 'Cloud DB',
      status: formatProviderActionStatus(providerActionsById.cloud_database),
      detail: formatProviderActionDetail(providerActionsById.cloud_database),
      provider: providerActionsById.cloud_database,
    },
    {
      label: 'Cloud Storage',
      status: formatProviderActionStatus(providerActionsById.cloud_storage),
      detail: formatProviderActionDetail(providerActionsById.cloud_storage),
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
      status: formatProviderActionStatus(providerActionsById.google_calendar),
      detail: providerActionsById.google_calendar?.enabled
        ? t(locale, 'googleCalendarConnectedDetail')
        : (calendarUrl ? t(locale, 'googleCalendarLocalLinkDetail') : formatProviderActionDetail(providerActionsById.google_calendar)),
      provider: providerActionsById.google_calendar,
    },
    {
      label: 'Gemini',
      status: formatProviderActionStatus(providerActionsById.gemini),
      detail: formatProviderActionDetail(providerActionsById.gemini),
      provider: providerActionsById.gemini,
    },
    {
      label: 'Flomo',
      status: formatProviderActionStatus(providerActionsById.flomo),
      detail: formatProviderActionDetail(providerActionsById.flomo),
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
            ‹ {copy.back}
          </button>
          <h1 className="portal-settings-title">{copy.settingsTitle}</h1>
        </header>
      ) : null}

      {!showAppSettings ? (
        <section className="portal-personal-profile-card">
          <div className="portal-personal-profile-main">
            <button type="button" className="portal-personal-avatar-edit" onClick={() => fileRef.current?.click()} aria-label="更换头像">
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
              <small>已使用第 {personalization.daysSinceStart} 天</small>
            </span>
            <Link href="/portfolio" className="portal-personal-settings-arrow" aria-label="进入个人主页">
              主页
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
          设置
        </button>
      ) : null}

      {!showAppSettings ? (
        <>
          <section className="portal-personal-learned">
            <div className="portal-personal-learned-head">
              <h2>宝盒学到的</h2>
              <span>{personalization.memoryCount} 条记忆</span>
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
                      <small>置信度 {memory.confidence}%</small>
                    </div>
                    <i aria-label={`强度 ${memory.strength}`}>
                      {Array.from({ length: 3 }, (_, index) => (
                        <em key={index} className={index < memory.strength ? 'is-on' : ''} />
                      ))}
                    </i>
                  </article>
                ))}
              </div>
            ) : (
              <div className="portal-personal-empty">再用几天，宝盒就会有新发现。</div>
            )}
            <button type="button" className="portal-personal-progress-link">查看全部学习进展 →</button>
          </section>

          <section className="portal-personal-preferences">
            <h2>个性化偏好</h2>
            <div>
              <span>节奏偏好</span>
              <b>{personalization.preferences.pace}</b>
              <small>高效</small>
            </div>
            <div>
              <span>推送时间</span>
              <b>{personalization.preferences.pushTime}</b>
              <i aria-hidden>›</i>
            </div>
            <div>
              <span>允许洞察推送</span>
              <button type="button" className={personalization.preferences.observationPushEnabled ? 'is-on' : ''} aria-label="允许洞察推送" />
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="portal-settings-card">
        <h2 className="portal-settings-label">{copy.appearanceTitle}</h2>
        <p className="portal-settings-hint">{copy.appearanceHint}</p>
        <PortalThemeToggle />
      </section>

      <section className="portal-settings-card">
        <h2 className="portal-settings-label">{copy.language}</h2>
        <select
          className="portal-settings-input portal-settings-select"
          aria-label="语言"
          value={displayLanguage}
          onChange={(event) => onDisplayLanguageChange(normalizeDisplayLanguage(event.target.value))}
        >
          {LANGUAGE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </section>

      <section className="portal-settings-card portal-settings-safety" aria-label="连接与安全">
        <div className="portal-settings-safety-head">
          <div>
            <h2 className="portal-settings-label">{copy.connections}</h2>
            <p className="portal-settings-hint">{copy.connectionsHint}</p>
          </div>
          <span>{copy.localFirst}</span>
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
              <button type="button" onClick={() => onStartAuth('email')}>Email</button>
              <button type="button" onClick={() => onStartAuth('google')}>Google</button>
              <button type="button" onClick={() => onStartAuth('wechat')}>WeChat</button>
              <button type="button" onClick={() => onStartAuth('phone')}>Phone</button>
              <button type="button" onClick={onLogoutAuth}>{t(locale, 'authSignOut')}</button>
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
                  onClick={() => onOpenProviderAction(row.provider)}
                >
                  {formatProviderActionButtonLabel(row.provider)}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {authFeedback ? <p className="portal-settings-auth-feedback">{authFeedback}</p> : null}
      </section>
        </>
      )}

      {toast ? <div className="portal-settings-toast" role="status">{toast}</div> : null}
    </div>
  );
}
