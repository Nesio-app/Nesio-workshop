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
  saveCalendarLinkSettings,
} from '@/lib/portal/calendar-links';
import {
  getBaohePersonalizationProfile,
  readBaohePersonalizationStage,
  saveBaohePersonalizationStage,
  type BaohePersonalizationStage,
} from '@/lib/portal/personalization-insights';
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
  const [calendarUrl, setCalendarUrl] = useState('');
  const [toast, setToast] = useState('');
  const [personalizationStage, setPersonalizationStage] = useState<BaohePersonalizationStage>('day_34');
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

  const onCalendarSave = () => {
    const next = saveCalendarLinkSettings({ googleCalendarUrl: calendarUrl });
    setCalendarUrl(next.googleCalendarUrl);
    showToast('settingsSaved');
  };

  const onPersonalizationStageChange = (stage: BaohePersonalizationStage) => {
    setPersonalizationStage(stage);
    saveBaohePersonalizationStage(stage);
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
        <Link href="/" className="portal-settings-back">
          ‹ {t(locale, 'settingsBack')}
        </Link>
        <h1 className="portal-settings-title">{t(locale, 'settingsTitle')}</h1>
      </header>

      <section className="portal-personal-profile-card">
        <button type="button" className="portal-personal-profile-main" onClick={() => fileRef.current?.click()}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="portal-settings-avatar" width={80} height={80} />
          ) : (
            <span className="portal-personal-profile-avatar" aria-hidden>
              {initials(displayName)}
            </span>
          )}
          <span>
            <b>{displayName}</b>
            <small>已使用第 {personalization.daysSinceStart} 天</small>
          </span>
          <i aria-hidden>›</i>
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

      <section className="portal-settings-card portal-personal-demo-switch">
        <h2 className="portal-settings-label">体验对比</h2>
        <div className="portal-settings-lang">
          <button
            type="button"
            className={'portal-settings-lang-btn' + (personalizationStage === 'first_use' ? ' portal-settings-lang-btn--on' : '')}
            onClick={() => onPersonalizationStageChange('first_use')}
          >
            初次使用
          </button>
          <button
            type="button"
            className={'portal-settings-lang-btn' + (personalizationStage === 'day_34' ? ' portal-settings-lang-btn--on' : '')}
            onClick={() => onPersonalizationStageChange('day_34')}
          >
            使用 34 天后
          </button>
        </div>
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

      <section className="portal-settings-card" id="calendar">
        <label className="portal-settings-label" htmlFor="settings-calendar-url">
          Google Calendar
        </label>
        <p className="portal-settings-hint">
          粘贴 Google Calendar 网页链接后，首页日历卡片可点击进入。真实事件同步仍保持关闭，避免私人日程暴露在公开站点。
        </p>
        <input
          id="settings-calendar-url"
          className="portal-settings-input"
          type="url"
          value={calendarUrl}
          onChange={(event) => setCalendarUrl(event.target.value)}
          placeholder="https://calendar.google.com/calendar/..."
        />
        <button type="button" className="portal-settings-secondary-btn" onClick={onCalendarSave}>
          保存日历链接
        </button>
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

      {toast ? <div className="portal-settings-toast" role="status">{toast}</div> : null}
    </div>
  );
}
