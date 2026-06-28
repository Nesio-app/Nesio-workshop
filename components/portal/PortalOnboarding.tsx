'use client';

import { useEffect, useRef, useState } from 'react';
import {
  loadProfileSettings,
  saveProfileSettings,
  type PortalLocale,
} from '@/lib/portal/profile';
import { loadMirrorFromCloud } from '@/lib/portal/mirror-profile';
import { getAuthRedirectTo } from '@/lib/portal/auth-client';

const ONBOARDING_DONE_KEY = 'treasurebox-onboarding-v14-done';
const LEGACY_ONBOARDING_DONE_KEY = 'treasurebox-onboarding-v13-done';
const TIPS_SHOWN_KEY = 'nesio-tips-shown-v1';

type Step = 'welcome' | 'name' | 'auth';

// ── Auth helpers ──────────────────────────────────────

async function startGoogleAuth(): Promise<string | null> {
  try {
    const redirectTo = getAuthRedirectTo();
    const res = await fetch('/api/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', redirectTo }),
    });
    const data = await res.json() as { ok?: boolean; url?: string };
    return data.ok && data.url ? data.url : null;
  } catch { return null; }
}

async function startEmailAuth(email: string): Promise<{ ok: boolean }> {
  try {
    const redirectTo = getAuthRedirectTo();
    const res = await fetch('/api/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'email', email, redirectTo }),
    });
    const data = await res.json() as { ok?: boolean };
    return { ok: !!data.ok };
  } catch { return { ok: false }; }
}

// ── Welcome step ──────────────────────────────────────

function WelcomeStep({ onNext, locale, onLocale }: {
  onNext: () => void;
  locale: PortalLocale;
  onLocale: (l: PortalLocale) => void;
}) {
  const zh = locale === 'zh';
  return (
    <div className="nesio-ob-step">
      <div className="nesio-ob-logo-wrap">
        <img src="/icons/treasurebox-pwa-192.png" alt="Nesio" className="nesio-ob-logo" />
      </div>
      <h1 className="nesio-ob-brand">Nesio</h1>
      <p className="nesio-ob-tagline">Know Less. Live More.</p>
      <p className="nesio-ob-desc">
        {zh
          ? '把重要的事放进来，需要时找得到。你分享进来的内容，都会先变成可确认的线索。'
          : 'Put important things in. Find them later. What you share becomes confirmable clues first.'}
      </p>
      <div className="nesio-ob-lang-row">
        <button type="button" className={`nesio-ob-lang-btn${zh ? ' nesio-ob-lang-btn--active' : ''}`} onClick={() => onLocale('zh')}>简体中文</button>
        <button type="button" className={`nesio-ob-lang-btn${!zh ? ' nesio-ob-lang-btn--active' : ''}`} onClick={() => onLocale('en')}>English</button>
      </div>
      <button type="button" className="nesio-ob-primary-btn" onClick={onNext}>
        {zh ? '开始使用 →' : 'Get started →'}
      </button>
    </div>
  );
}

// ── Name step ─────────────────────────────────────────

function NameStep({ onNext, locale }: { onNext: (name: string) => void; locale: PortalLocale }) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const zh = locale === 'zh';

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  return (
    <div className="nesio-ob-step">
      <div className="nesio-ob-step-icon" aria-hidden>👋</div>
      <h2 className="nesio-ob-step-title">{zh ? 'Nesio 叫你什么？' : 'What should Nesio call you?'}</h2>
      <p className="nesio-ob-step-sub">{zh ? '只用于本机显示，你可以随时改。' : 'Only used on this device. You can change it anytime.'}</p>
      <input
        ref={inputRef}
        className="nesio-ob-input"
        placeholder={zh ? '你的名字…' : 'Your name…'}
        value={name}
        maxLength={24}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onNext(name.trim()); }}
        autoComplete="given-name"
      />
      <button type="button" className="nesio-ob-primary-btn" disabled={!name.trim()} onClick={() => onNext(name.trim())}>
        {zh ? '继续' : 'Continue'}
      </button>
      <button type="button" className="nesio-ob-skip-btn" onClick={() => onNext(zh ? '朋友' : 'Friend')}>
        {zh ? '跳过' : 'Skip'}
      </button>
    </div>
  );
}

// ── Auth step ─────────────────────────────────────────

function AuthStep({ onDone, locale, displayName }: {
  onDone: () => void;
  locale: PortalLocale;
  displayName: string;
}) {
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const zh = locale === 'zh';

  async function handleGoogle() {
    setLoading(true); setError('');
    const url = await startGoogleAuth();
    if (url) { window.location.href = url; }
    else { setError(zh ? 'Google 登录暂未配置，请用邮件。' : 'Google sign-in not configured yet.'); setLoading(false); }
  }

  async function handleEmail() {
    if (!email.trim()) return;
    setLoading(true); setError('');
    const r = await startEmailAuth(email.trim());
    setLoading(false);
    if (r.ok) setSent(true);
    else setError(zh ? '发送失败，请稍后再试。' : 'Could not send link. Try again.');
  }

  if (sent) return (
    <div className="nesio-ob-step">
      <div className="nesio-ob-step-icon" aria-hidden>📬</div>
      <h2 className="nesio-ob-step-title">{zh ? '查一下邮件' : 'Check your email'}</h2>
      <p className="nesio-ob-step-sub">{zh ? `登录链接已发到 ${email}` : `We sent a link to ${email}`}</p>
      <button type="button" className="nesio-ob-primary-btn" onClick={onDone}>{zh ? '继续本地使用' : 'Continue locally'}</button>
    </div>
  );

  return (
    <div className="nesio-ob-step">
      <div className="nesio-ob-step-icon" aria-hidden>🔐</div>
      <h2 className="nesio-ob-step-title">{zh ? `你好，${displayName}` : `Hello, ${displayName}`}</h2>
      <p className="nesio-ob-step-sub">
        {zh ? '登录后，Memory 和 Today 可跨设备同步。可以跳过，稍后再设置。' : 'Sign in to sync across devices. You can skip for now.'}
      </p>

      {/* Google */}
      <button type="button" className="nesio-ob-auth-btn nesio-ob-auth-btn--google" onClick={handleGoogle} disabled={loading}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {loading ? (zh ? '跳转中…' : 'Redirecting…') : (zh ? '用 Google 登录' : 'Continue with Google')}
      </button>

      {/* Email */}
      {emailMode ? (
        <>
          <input
            type="email"
            className="nesio-ob-input"
            placeholder={zh ? '你的邮箱地址' : 'your@email.com'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleEmail(); }}
            autoComplete="email"
            autoFocus
          />
          <button type="button" className="nesio-ob-primary-btn" onClick={handleEmail} disabled={loading || !email.trim()}>
            {loading ? (zh ? '发送中…' : 'Sending…') : (zh ? '发送登录链接' : 'Send sign-in link')}
          </button>
        </>
      ) : (
        <button type="button" className="nesio-ob-auth-btn" onClick={() => setEmailMode(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden>
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          {zh ? '用邮件登录' : 'Continue with Email'}
        </button>
      )}

      {error && <p className="nesio-ob-error">{error}</p>}
      <button type="button" className="nesio-ob-skip-btn" onClick={onDone}>
        {zh ? '跳过，本地使用' : 'Skip for now'}
      </button>
    </div>
  );
}

// ── Tips overlay ──────────────────────────────────────

export function FirstUseTips({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const tips = [
    {
      emoji: '📋',
      title: 'Today — 今天最重要的事',
      body: 'Nesio 会把今天最值得看的事放前面。你可以决定哪些提醒以后少出现。',
      zone: 'today' as const,
    },
    {
      emoji: '💎',
      title: '中间按钮 — 告诉 Nesio',
      body: '说一句、拍一下、分享文件。先整理成草稿，重要信息由你确认。',
      zone: 'center' as const,
    },
    {
      emoji: '🗂',
      title: 'Memory — 线索回头找得到',
      body: '人、物、地点、承诺，先由你放进来。搜索「娃娃在哪」就能找回。',
      zone: 'memory' as const,
    },
  ];
  const tip = tips[step];
  const isLast = step === tips.length - 1;

  return (
    <div className="nesio-tips-overlay" role="dialog" aria-modal="true" aria-label="新手提示">
      <div className={`nesio-tips-hl nesio-tips-hl--${tip.zone}`} aria-hidden />
      <div className="nesio-tips-card">
        <div className="nesio-tips-dots" aria-hidden>
          {tips.map((_, i) => <span key={i} className={`nesio-tips-dot${i === step ? ' nesio-tips-dot--active' : ''}`} />)}
        </div>
        <div className="nesio-tips-emoji" aria-hidden>{tip.emoji}</div>
        <h3 className="nesio-tips-title">{tip.title}</h3>
        <p className="nesio-tips-body">{tip.body}</p>
        <div className="nesio-tips-actions">
          {isLast ? (
            <button type="button" className="nesio-ob-primary-btn" onClick={onDone}>开始使用 →</button>
          ) : (
            <>
              <button type="button" className="nesio-ob-primary-btn" onClick={() => setStep(step + 1)}>下一步</button>
              <button type="button" className="nesio-ob-skip-btn" onClick={onDone}>跳过</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────

export default function PortalOnboarding() {
  const [visible, setVisible] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const [step, setStep] = useState<Step>('welcome');
  const [displayName, setDisplayName] = useState('');
  const [locale, setLocale] = useState<PortalLocale>('zh');

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('nesio-onboarding-visibility-change', {
      detail: { active: visible || showTips },
    }));
    return () => {
      window.dispatchEvent(new CustomEvent('nesio-onboarding-visibility-change', {
        detail: { active: false },
      }));
    };
  }, [visible, showTips]);

  useEffect(() => {
    try {
      const done = localStorage.getItem(ONBOARDING_DONE_KEY) === '1' ||
        localStorage.getItem(LEGACY_ONBOARDING_DONE_KEY) === '1';
      if (done) {
        if (!localStorage.getItem(TIPS_SHOWN_KEY)) setShowTips(true);
        return;
      }
      const profile = loadProfileSettings();
      setDisplayName(profile.displayName || '');
      setLocale(profile.locale || 'zh');
      setVisible(true);
    } catch { /* storage unavailable */ }
  }, []);

  function handleLocale(l: PortalLocale) {
    setLocale(l);
    saveProfileSettings({ locale: l });
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
  }

  function handleName(name: string) {
    setDisplayName(name);
    saveProfileSettings({ displayName: name });
    setStep('auth');
  }

  function finish() {
    try {
      localStorage.setItem(ONBOARDING_DONE_KEY, '1');
      localStorage.setItem(LEGACY_ONBOARDING_DONE_KEY, '1');
    } catch { /* ignore */ }
    setVisible(false);
    setShowTips(true);
    loadMirrorFromCloud().catch(() => undefined);
  }

  function handleTipsDone() {
    try { localStorage.setItem(TIPS_SHOWN_KEY, '1'); } catch { /* ignore */ }
    setShowTips(false);
  }

  if (showTips) return <FirstUseTips onDone={handleTipsDone} />;
  if (!visible) return null;

  const STEPS: Step[] = ['welcome', 'name', 'auth'];
  const stepIdx = STEPS.indexOf(step);

  return (
    <div className="nesio-ob-overlay" role="dialog" aria-modal="true" aria-label="欢迎使用 Nesio">
      <div className="nesio-ob-bg" aria-hidden />
      <div className="nesio-ob-card">
        {/* Progress */}
        <div className="nesio-ob-progress" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={`nesio-ob-dot${step === s ? ' nesio-ob-dot--active' : i < stepIdx ? ' nesio-ob-dot--done' : ''}`} />
          ))}
        </div>

        {step === 'welcome' && <WelcomeStep onNext={() => setStep('name')} locale={locale} onLocale={handleLocale} />}
        {step === 'name' && <NameStep onNext={handleName} locale={locale} />}
        {step === 'auth' && <AuthStep onDone={finish} locale={locale} displayName={displayName} />}
      </div>
    </div>
  );
}
