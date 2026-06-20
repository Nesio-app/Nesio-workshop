'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
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
  type ProductionProviderStatus,
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
    if (cloudProfileStatus === 'synced') return '已同步';
    if (cloudProfileStatus === 'loading') return '同步中';
    if (cloudProfileStatus === 'not_signed_in') return '未登录';
    if (cloudProfileStatus === 'error') return '同步失败';
    return '本机保存';
  })();

  const formatProviderStatus = (provider?: ProductionProviderStatus): string => {
    if (!provider) return runtimeLoading ? '检查中' : '未连接';
    if (provider.enabled) return '已启用';
    if (provider.configured) return '已配置';
    return '缺配置';
  };

  const formatProviderDetail = (provider?: ProductionProviderStatus): string => {
    if (!provider) return '正在读取生产运行状态。';
    if (provider.enabled) return '已从生产运行状态确认启用。';
    if (provider.missingEnv.length) return `缺少：${provider.missingEnv.slice(0, 3).join(' / ')}${provider.missingEnv.length > 3 ? '…' : ''}`;
    return '已配置，但开关尚未启用。';
  };

  const onStartAuth = async (provider: AuthStartProvider) => {
    if (provider === 'email' && !authEmail.trim()) {
      setAuthFeedback('请先输入邮箱。');
      return;
    }
    if (provider === 'phone' && !authPhone.trim()) {
      setAuthFeedback('请先输入手机号。');
      return;
    }
    setAuthFeedback('正在连接…');
    try {
      const client = createAppApiClient();
      const result = await client.startAuth({
        provider,
        email: authEmail.trim(),
        phone: authPhone.trim(),
      });
      if (result.ok && result.action === 'redirect' && result.url) {
        setAuthFeedback('正在跳转授权页面…');
        window.location.assign(result.url);
        return;
      }
      if (result.ok && result.action === 'otp_sent') {
        setAuthFeedback('验证码已发送，请检查邮箱或手机。');
        return;
      }
      if (result.error === 'provider_not_configured') {
        setAuthFeedback(`${provider} 登录尚未配置：${result.status?.missingEnv.slice(0, 3).join(' / ') || '缺少环境变量'}`);
        return;
      }
      setAuthFeedback(result.error || '暂时无法开始登录。');
    } catch {
      setAuthFeedback('连接登录服务失败，请稍后再试。');
    }
  };

  const onLogoutAuth = async () => {
    setAuthFeedback('正在退出…');
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
        setAuthFeedback('已退出登录。');
        return;
      }
      setAuthFeedback('退出登录失败，请稍后再试。');
    } catch {
      setAuthFeedback('连接退出服务失败，请稍后再试。');
    }
  };

  const copy = SETTINGS_COPY[displayLanguage] ?? SETTINGS_COPY.zh;

  const safetyRows = [
    {
      label: 'Email',
      status: formatProviderStatus(runtimeStatus?.accountAuth.providers.email),
      detail: formatProviderDetail(runtimeStatus?.accountAuth.providers.email),
    },
    {
      label: 'Google',
      status: formatProviderStatus(runtimeStatus?.accountAuth.providers.google),
      detail: formatProviderDetail(runtimeStatus?.accountAuth.providers.google),
    },
    {
      label: 'WeChat',
      status: formatProviderStatus(runtimeStatus?.accountAuth.providers.wechat),
      detail: formatProviderDetail(runtimeStatus?.accountAuth.providers.wechat),
    },
    {
      label: 'Phone',
      status: formatProviderStatus(runtimeStatus?.accountAuth.providers.phone),
      detail: formatProviderDetail(runtimeStatus?.accountAuth.providers.phone),
    },
    {
      label: 'Cloud DB',
      status: formatProviderStatus(runtimeStatus?.cloud.database),
      detail: formatProviderDetail(runtimeStatus?.cloud.database),
    },
    {
      label: 'Profile Settings',
      status: cloudProfileStatusLabel,
      detail: cloudProfileStatus === 'synced'
        ? '头像、语言等个人设置已通过云端 profile settings 合约同步。'
        : '头像、语言等个人设置会先保存在本机；登录和云端可用时再同步。',
    },
    {
      label: 'Google Calendar',
      status: formatProviderStatus(runtimeStatus?.thirdParty.googleCalendar),
      detail: runtimeStatus?.thirdParty.googleCalendar.enabled
        ? '生产环境已检测到日历连接。'
        : (calendarUrl ? '本机已保存日历链接；生产读取仍以环境配置为准。' : formatProviderDetail(runtimeStatus?.thirdParty.googleCalendar)),
    },
    {
      label: 'Gemini',
      status: formatProviderStatus(runtimeStatus?.ai.providers.gemini),
      detail: formatProviderDetail(runtimeStatus?.ai.providers.gemini),
    },
    {
      label: 'Flomo',
      status: formatProviderStatus(runtimeStatus?.thirdParty.flomo),
      detail: formatProviderDetail(runtimeStatus?.thirdParty.flomo),
    },
    {
      label: '健康 / 金融 / 心理',
      status: '受保护',
      detail: '高信任模块不进入首发公开承诺，不提供建议、诊断、交易或真实账户动作。',
    },
    {
      label: '自动化与外部授权',
      status: '关闭',
      detail: '付费或连接不等于可以安全执行；外部授权和自动执行仍需 CEO Gate。',
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
              <strong>账户登录</strong>
              <p>
                {authSessionLoading
                  ? '正在读取登录状态。'
                  : authSession?.loggedIn
                    ? `已登录${authSession.user?.email ? `：${authSession.user.email}` : authSession.user?.phone ? `：${authSession.user.phone}` : ''}`
                    : '邮件、Google、微信、电话都会走生产授权入口；未配置时会明确失败原因。'}
              </p>
            </div>
            <span>{authSession?.loggedIn ? '已登录' : runtimeStatus?.accountAuth.enabled ? '已开启' : '待配置'}</span>
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
              <button type="button" onClick={onLogoutAuth} disabled={!authSession?.loggedIn}>退出登录</button>
            </div>
          </li>
          {safetyRows.map((row) => (
            <li key={row.label}>
              <div>
                <strong>{row.label}</strong>
                <p>{row.detail}</p>
              </div>
              <span>{row.status}</span>
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
