'use client';

import { useEffect, useState } from 'react';
import {
  loadProfileSettings,
  saveProfileSettings,
  type PortalCoachStyle,
} from '@/lib/portal/profile';

const ONBOARDING_DONE_KEY = 'treasurebox-onboarding-v14-done';
const LEGACY_ONBOARDING_DONE_KEY = 'treasurebox-onboarding-v13-done';

const STYLE_OPTIONS: Array<{
  id: PortalCoachStyle;
  label: string;
  hint: string;
}> = [
  { id: 'minimal', label: '极简清透', hint: '少一点话，直接开始。' },
  { id: 'warm', label: '温暖陪伴', hint: '温柔一点，慢慢推进。' },
  { id: 'professional', label: '专业高效', hint: '更像工作台和教练。' },
];

export default function PortalOnboarding() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<'name' | 'style'>('name');
  const [displayName, setDisplayName] = useState('婧');
  const [coachStyle, setCoachStyle] = useState<PortalCoachStyle>('warm');

  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDING_DONE_KEY) === '1' || localStorage.getItem(LEGACY_ONBOARDING_DONE_KEY) === '1') return;
      const profile = loadProfileSettings();
      setDisplayName(profile.displayName || '婧');
      setCoachStyle(profile.coachStyle);
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
        <h1 id="portal-onboarding-title">欢迎来到 Nesio</h1>
        {step === 'name' ? (
          <>
            <p className="portal-onboarding-copy">先告诉我怎么称呼你</p>
            <p className="portal-onboarding-note">不需要注册 · 稍后随时连接账号</p>

            <label className="portal-onboarding-label" htmlFor="portal-onboarding-name">
              怎么称呼你
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
              继续
            </button>
          </>
        ) : (
          <>
            <p className="portal-onboarding-copy">选择一种陪伴风格</p>
            <p className="portal-onboarding-note">风格只影响微文案和 AI 回复，不改变导航路径</p>

            <div className="portal-onboarding-styles" aria-label="选择陪伴风格">
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
                  <span>{option.label}</span>
                  <small>{option.hint}</small>
                </button>
              ))}
            </div>

            <button type="button" className="portal-onboarding-continue" onClick={submit}>
              继续
            </button>
          </>
        )}
      </div>
    </div>
  );
}
