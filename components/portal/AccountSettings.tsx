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
import {
  loadCalendarLinkSettings,
} from '@/lib/portal/calendar-links';
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
  const [calendarUrl, setCalendarUrl] = useState('');
  const [toast, setToast] = useState('');
  const [personalizationStage, setPersonalizationStage] = useState<BaohePersonalizationStage>('day_34');
  const [showAppSettings, setShowAppSettings] = useState(false);
  const personalization = getBaohePersonalizationProfile(personalizationStage);

  useEffect(() => {
    const s = loadProfileSettings(fallbackName);
    setDisplayName(s.displayName);
    setAvatarUrl(s.avatarUrl);
    setLocale(s.locale);
    setCalendarUrl(loadCalendarLinkSettings().googleCalendarUrl);
    setPersonalizationStage(readBaohePersonalizationStage());
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

  const onLocaleChange = (next: PortalLocale) => {
    setLocale(next);
    saveProfileSettings({ locale: next });
    showToast('settingsSaved');
  };

  const safetyRows = [
    {
      label: 'Google Calendar',
      status: calendarUrl ? '已保存链接' : '未连接',
      detail: '首页只打开你保存的日历链接；私人事件同步保持关闭。',
    },
    {
      label: '智友 AI',
      status: '预览中',
      detail: '可作为稳定对话中枢展示；外部 AI 自动化和文件/语音/Live 需要另行确认。',
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
      <header className="portal-settings-head">
        {showAppSettings ? (
          <button type="button" className="portal-settings-back portal-settings-back--button" onClick={() => setShowAppSettings(false)}>
            ‹ 个人数据
          </button>
        ) : (
          <Link href="/" className="portal-settings-back">
            ‹ {t(locale, 'settingsBack')}
          </Link>
        )}
        <h1 className="portal-settings-title">{showAppSettings ? '软件设置' : '个人数据'}</h1>
      </header>

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
          <button type="button" className="portal-personal-settings-arrow" onClick={() => setShowAppSettings(true)} aria-label="进入软件设置">
            ›
          </button>
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
        <h2 className="portal-settings-label">{t(locale, 'portalAppearanceTitle')}</h2>
        <p className="portal-settings-hint">{t(locale, 'portalAppearanceHint')}</p>
        <PortalThemeToggle />
      </section>

      <section className="portal-settings-card">
        <h2 className="portal-settings-label">{t(locale, 'settingsLanguage')}</h2>
        <select
          className="portal-settings-input portal-settings-select"
          aria-label="语言"
          value={locale}
          onChange={(event) => onLocaleChange((event.target.value === 'en' ? 'en' : 'zh') as PortalLocale)}
        >
          {LANGUAGE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </section>

      <section className="portal-settings-card portal-settings-safety" aria-label="连接与安全">
        <div className="portal-settings-safety-head">
          <div>
            <h2 className="portal-settings-label">连接与安全</h2>
            <p className="portal-settings-hint">连接性强，但所有授权都要确认。</p>
          </div>
          <span>Local-first</span>
        </div>
        <ul className="portal-settings-safety-list">
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
      </section>
        </>
      )}

      {toast ? <div className="portal-settings-toast" role="status">{toast}</div> : null}
    </div>
  );
}
