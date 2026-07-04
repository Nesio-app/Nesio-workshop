'use client';

/**
 * NightTimeline — 夜间空状态时间线(此刻 · 把你带回今天)。
 * 从 FocusSection 拆出;无共享状态,纯展示。
 * 文案在 lib/portal/i18n.ts 的 night* 键组,受 v14-sovereignty 契约约束
 * (低压首记录邀请)。
 */

import { t } from '@/lib/portal/i18n';
import { usePortalLocale } from '../use-portal-locale';

export function NightTimeline() {
  const locale = usePortalLocale();
  const steps = [
    { time: t(locale, 'nightNowTime'), label: t(locale, 'nightNowLabel'), active: true },
    { time: t(locale, 'nightMorningTime'), label: t(locale, 'nightMorningLabel'), active: false },
    { time: t(locale, 'nightLaterTime'), label: t(locale, 'nightLaterLabel'), active: false },
  ];

  return (
    <div className="nesio-today-night">
      <div className="nesio-today-night-hero">
        <p className="nesio-today-night-kicker">{t(locale, 'nightKicker')}</p>
        <h2 className="nesio-today-night-title">{t(locale, 'nightTitleL1')}<br />{t(locale, 'nightTitleL2')}</h2>
        <p className="nesio-today-night-sub">{t(locale, 'nightSub')}</p>
        <div className="nesio-today-night-actions">
          <span className="nesio-today-night-conf">{t(locale, 'nightConfirmHint')}</span>
          <button type="button" className="nesio-today-btn nesio-today-btn--night">{t(locale, 'nightOk')}</button>
        </div>
      </div>
      <div className="nesio-today-night-timeline">
        <p className="nesio-today-night-timeline-label">{t(locale, 'nightPathLabel')}</p>
        <ol className="nesio-today-night-steps">
          {steps.map((step, i) => (
            <li key={i} className={`nesio-today-night-step${step.active ? ' nesio-today-night-step--active' : ''}`}>
              <span className="nesio-today-night-step-dot" />
              <span className="nesio-today-night-step-time">{step.time}</span>
              <span className="nesio-today-night-step-label">{step.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
