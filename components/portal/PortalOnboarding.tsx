'use client';

import { useEffect, useRef, useState } from 'react';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { L, t } from '@/lib/portal/i18n';
import {
  loadProfileSettings,
  portalLocaleToDictionaryLocale,
  saveProfileSettings,
  type PortalLocale,
} from '@/lib/portal/profile';
import { loadMirrorFromCloud } from '@/lib/portal/mirror-profile';
import {
  getAuthRedirectTo,
  markNesioOnboardingDoneForAuth,
  NESIO_ONBOARDING_COMPLETE_EVENT,
  NESIO_ONBOARDING_DONE_KEYS,
} from '@/lib/portal/auth-client';

const [ONBOARDING_DONE_KEY, LEGACY_ONBOARDING_DONE_KEY] = NESIO_ONBOARDING_DONE_KEYS;
const TIPS_SHOWN_KEY = 'nesio-tips-shown-v1';

type Step = 'welcome' | 'name' | 'auth';
type AuthMode = 'login' | 'register';

type AuthStartResult = {
  ok: boolean;
  error?: string;
  auditId?: string;
};

type AuthSessionResult = {
  ok?: boolean;
  loggedIn?: boolean;
  authReady?: boolean;
  profileBootstrapBlocking?: boolean;
  profileBootstrapStatus?: string;
  user?: {
    email?: string;
    name?: string;
    displayName?: string;
    provider?: string;
    providers?: string[];
  };
};

type AuthReadyEventDetail = {
  ok?: boolean;
  loggedIn?: boolean;
  authReady?: boolean;
  profileBootstrapBlocking?: boolean;
};

// ── Auth helpers ──────────────────────────────────────

async function startGoogleAuth(): Promise<string | null> {
  try {
    const redirectTo = getAuthRedirectTo();
    const res = await fetch('/api/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', authMode: 'register', redirectTo }),
    });
    const data = await res.json() as { ok?: boolean; url?: string };
    return data.ok && data.url ? data.url : null;
  } catch { return null; }
}

async function startEmailAuth(email: string, authMode: AuthMode): Promise<AuthStartResult> {
  try {
    const redirectTo = getAuthRedirectTo();
    const res = await fetch('/api/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'email', authMode, email, redirectTo }),
    });
    const data = await res.json() as { ok?: boolean; error?: string; auditId?: string };
    return { ok: !!data.ok, error: data.error, auditId: data.auditId };
  } catch { return { ok: false, error: 'network_error' }; }
}

function hasAuthCallbackSuccess(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('auth') === 'auth_callback_received' ||
    params.get('status') === 'session_established' ||
    params.get('status') === 'session_imported';
}

function hasAuthReadyCallbackSuccess(): boolean {
  if (typeof window === 'undefined') return false;
  if (!hasAuthCallbackSuccess()) return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('authReady') !== 'false' &&
    params.get('profileBootstrapBlocking') !== 'true';
}

function clearAuthCallbackParams() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let changed = false;
  [
    'auth',
    'provider',
    'status',
    'authMode',
    'authReady',
    'profileBootstrapStatus',
    'profileBootstrapBlocking',
    'safePublicStatus',
    'secretsRedacted',
  ].forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });
  if (changed) window.history.replaceState(null, document.title, `${url.pathname}${url.search}${url.hash}`);
}

async function readAuthSession(): Promise<AuthSessionResult | null> {
  try {
    const res = await fetch('/api/auth/session', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json() as AuthSessionResult;
  } catch {
    return null;
  }
}

function deriveDisplayNameFromSession(session: AuthSessionResult): string {
  const raw = session.user?.name || session.user?.displayName || session.user?.email?.split('@')[0] || '';
  return raw.trim();
}

function isAuthReadySession(session: AuthSessionResult | null): session is AuthSessionResult {
  return Boolean(
    session?.loggedIn &&
    session.authReady !== false &&
    session.profileBootstrapBlocking !== true,
  );
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
        <img src="/assets/logo/nesio-mark.svg" alt="Nesio" className="nesio-ob-logo" />
      </div>
      <h1 className="nesio-ob-brand">Nesio</h1>
      <p className="nesio-ob-tagline">Know Less. Live More.</p>
      <p className="nesio-ob-desc">
        {t(locale, 'onboardingWelcomeDesc')}
      </p>
      <div className="nesio-ob-lang-row">
        <button type="button" className={`nesio-ob-lang-btn${zh ? ' nesio-ob-lang-btn--active' : ''}`} onClick={() => onLocale('zh')}>简体中文</button>
        <button type="button" className={`nesio-ob-lang-btn${!zh ? ' nesio-ob-lang-btn--active' : ''}`} onClick={() => onLocale('en')}>English</button>
      </div>
      <button type="button" className="nesio-ob-primary-btn" onClick={onNext}>
        {t(locale, 'onboardingStart')}
      </button>
    </div>
  );
}

// ── Name step ─────────────────────────────────────────

function NameStep({ onNext, locale }: { onNext: (name: string) => void; locale: PortalLocale }) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  return (
    <div className="nesio-ob-step">
      <div className="nesio-ob-step-icon" aria-hidden>👋</div>
      <h2 className="nesio-ob-step-title">{t(locale, 'onboardingNameLabel')}</h2>
      <p className="nesio-ob-step-sub">{t(locale, 'onboardingNameNote')}</p>
      <input
        ref={inputRef}
        className="nesio-ob-input"
        placeholder={t(locale, 'onboardingNameCopy')}
        value={name}
        maxLength={24}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onNext(name.trim()); }}
        autoComplete="given-name"
      />
      <button type="button" className="nesio-ob-primary-btn" disabled={!name.trim()} onClick={() => onNext(name.trim())}>
        {t(locale, 'onboardingContinue')}
      </button>
      <button type="button" className="nesio-ob-skip-btn" onClick={() => onNext(t(locale, 'onboardingDefaultFriendName'))}>
        {t(locale, 'onboardingSkip')}
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

  async function handleGoogle() {
    setLoading(true); setError('');
    const url = await startGoogleAuth();
    if (url) { window.location.href = url; }
    else { setError(t(locale, 'onboardingAuthGoogleNotConfigured')); setLoading(false); }
  }

  async function handleEmail() {
    if (!email.trim()) return;
    setLoading(true); setError('');
    let r = await startEmailAuth(email.trim(), 'register');
    if (!r.ok && r.error === 'user_already_exists') {
      r = await startEmailAuth(email.trim(), 'login');
    }
    setLoading(false);
    if (r.ok) setSent(true);
    else {
      const message = r.error === 'provider_not_configured'
        ? t(locale, 'onboardingAuthEmailNotConfigured')
        : r.error === 'user_not_found'
          ? t(locale, 'onboardingAuthUserNotFound')
          : r.error === 'supabase_otp_failed'
            ? t(locale, 'onboardingAuthOtpFailed')
            : t(locale, 'onboardingAuthSendFailed');
      setError(r.auditId ? `${message} (${r.auditId})` : message);
    }
  }

  if (sent) return (
    <div className="nesio-ob-step">
      <div className="nesio-ob-step-icon" aria-hidden>📬</div>
      <h2 className="nesio-ob-step-title">{t(locale, 'onboardingAuthCheckEmailTitle')}</h2>
      <p className="nesio-ob-step-sub">{t(locale, 'onboardingAuthLinkSentTemplate', { email })}</p>
      <button type="button" className="nesio-ob-primary-btn" onClick={onDone}>{t(locale, 'onboardingAuthContinueLocal')}</button>
    </div>
  );

  return (
    <div className="nesio-ob-step">
      <div className="nesio-ob-step-icon" aria-hidden>🔐</div>
      <h2 className="nesio-ob-step-title">{t(locale, 'onboardingAuthHelloTemplate', { name: displayName })}</h2>
      <p className="nesio-ob-step-sub">
        {t(locale, 'onboardingAuthBenefit')}
      </p>

      {/* Google */}
      <button type="button" className="nesio-ob-auth-btn nesio-ob-auth-btn--google" onClick={handleGoogle} disabled={loading}>
        {/* eslint-disable no-restricted-syntax -- Google 官方品牌色,固定值不随主题 */}
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {/* eslint-enable no-restricted-syntax */}
        {loading ? t(locale, 'onboardingAuthRedirecting') : t(locale, 'onboardingAuthGoogleBtn')}
      </button>

      {/* Email */}
      {emailMode ? (
        <>
          <input
            type="email"
            className="nesio-ob-input"
            placeholder={t(locale, 'onboardingAuthEmailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleEmail(); }}
            autoComplete="email"
            autoFocus
          />
          <button type="button" className="nesio-ob-primary-btn" onClick={handleEmail} disabled={loading || !email.trim()}>
            {loading ? t(locale, 'onboardingAuthSending') : t(locale, 'onboardingAuthSendLink')}
          </button>
        </>
      ) : (
        <button type="button" className="nesio-ob-auth-btn" onClick={() => setEmailMode(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden>
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          {t(locale, 'onboardingAuthEmailBtn')}
        </button>
      )}

      {error && <p className="nesio-ob-error">{error}</p>}
      <button type="button" className="nesio-ob-skip-btn" onClick={onDone}>
        {t(locale, 'onboardingAuthSkipLocal')}
      </button>
    </div>
  );
}

// ── Tips overlay ──────────────────────────────────────

export function FirstUseTips({ onDone, locale }: { onDone: () => void; locale: PortalLocale }) {
  const [step, setStep] = useState(0);
  const dict = portalLocaleToDictionaryLocale(locale);
  const tips = [
    { emoji: '📋', title: t(locale, 'onboardingTipTodayTitle'), body: t(locale, 'onboardingTipTodayBody'), zone: 'today' as const },
    // QA 新手引导补三招:粉碎任务 / 长按问一问 / 发送邮件
    { emoji: '⚡', title: L(dict, '任务大?粉碎它', 'Big task? Shatter it'), body: L(dict, '今日焦点卡上点「拆一下」,把大事拆成 3 个立刻能动手的小步。', 'Tap "Break down" on a focus card — it splits into 3 steps you can start right now.'), zone: 'today' as const },
    { emoji: '💎', title: t(locale, 'onboardingTipCenterTitle'), body: t(locale, 'onboardingTipCenterBody'), zone: 'center' as const },
    { emoji: '🔍', title: L(dict, '长按问一问', 'Hold to Ask'), body: L(dict, '长按中间按钮直接问:「护照放在哪」「上次买的药」,记过的都能找回。', 'Hold the center button and just ask: "Where is my passport?" — anything you noted comes back.'), zone: 'center' as const },
    { emoji: '✉️', title: L(dict, '邮件直接回', 'Reply to email in place'), body: L(dict, '连接 Gmail 后,邮件记忆里点「回复」—— AI 起草,你过目、点发送。', 'Connect Gmail, then tap Reply on an email memory — AI drafts, you review and send.'), zone: 'memory' as const },
    { emoji: '🗂', title: t(locale, 'onboardingTipMemoryTitle'), body: t(locale, 'onboardingTipMemoryBody'), zone: 'memory' as const },
  ];
  const tip = tips[step];
  const isLast = step === tips.length - 1;

  // 激活式最后一步:真的存进第一条记忆,并当场找回 —— 引导结束时
  // 用户已经亲历过一次「扔进来 → 找得到」,而不是只被告知过。
  const [firstText, setFirstText] = useState(t(locale, 'onboardingActivatePlaceholderDefault'));
  const [activatePhase, setActivatePhase] = useState<'input' | 'found'>('input');
  const [savedName, setSavedName] = useState('');

  function saveFirstMemory() {
    const text = firstText.trim();
    if (!text) return;
    // 一句话笔记的句子本身就是记忆 —— 24 字符会把 "hallway drawer" 截成 "ha",
    // 问一问只能对着残句瞎猜(QA 实锤)。放宽到 60,超长再截。
    const name = text.slice(0, 60);
    ingestLifeNode({
      name,
      type: 'object',
      source: 'manual',
      confidence: 1,
      rawInput: text,
      tags: [t(locale, 'onboardingActivateFirstTag')],
      attributes: {},
      relations: [],
    });
    setSavedName(name);
    setActivatePhase('found');
  }

  return (
    <div className="nesio-tips-overlay" role="dialog" aria-modal="false" aria-label={t(locale, 'onboardingTipsAriaLabel')}>
      <div className={`nesio-tips-hl nesio-tips-hl--${tip.zone}`} aria-hidden />
      {/* zone 也挂到卡片上:caret 按目标图标(左=今天/中=中键/右=记忆)定位,不再永远居中 */}
      <div className={`nesio-tips-card nesio-tips-card--${tip.zone}`}>
        <div className="nesio-tips-dots" aria-hidden>
          {tips.map((_, i) => <span key={i} className={`nesio-tips-dot${i === step ? ' nesio-tips-dot--active' : ''}`} />)}
        </div>
        <div className="nesio-tips-emoji" aria-hidden>{isLast && activatePhase === 'found' ? '✨' : tip.emoji}</div>
        {isLast ? (
          activatePhase === 'input' ? (
            <>
              <h3 className="nesio-tips-title">{t(locale, 'onboardingActivateTryTitle')}</h3>
              <p className="nesio-tips-body">{t(locale, 'onboardingActivateTryBody')}</p>
              <input
                className="nesio-ob-input"
                value={firstText}
                onChange={(e) => setFirstText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveFirstMemory(); }}
                style={{ marginTop: '0.5rem' }}
              />
              <div className="nesio-tips-actions">
                <button type="button" className="nesio-ob-primary-btn" onClick={saveFirstMemory} disabled={!firstText.trim()}>
                  {t(locale, 'onboardingActivateSave')}
                </button>
                <button type="button" className="nesio-ob-skip-btn" onClick={onDone}>{t(locale, 'onboardingActivateSkip')}</button>
              </div>
            </>
          ) : (
            <>
              <h3 className="nesio-tips-title">{t(locale, 'onboardingActivateFoundTitle')}</h3>
              <p className="nesio-tips-body">{t(locale, 'onboardingActivateFoundBody')}</p>
              <div style={{ background: 'var(--portal-accent-soft, rgba(88,140,227,0.1))', borderRadius: 12, padding: '0.7rem 0.9rem', margin: '0.5rem 0', textAlign: 'left' }}>
                <p style={{ fontSize: '0.76rem', margin: 0, color: 'var(--portal-muted)' }}>{t(locale, 'onboardingActivateAskExample')}</p>
                <p style={{ fontSize: '0.82rem', margin: '0.35rem 0 0', fontWeight: 600 }}>📦 {savedName}</p>
              </div>
              <p className="nesio-tips-body">{t(locale, 'onboardingActivateSummary')}</p>
              <div className="nesio-tips-actions">
                <button type="button" className="nesio-ob-primary-btn" onClick={onDone}>{t(locale, 'onboardingActivateStart')}</button>
              </div>
            </>
          )
        ) : (
          <>
            <h3 className="nesio-tips-title">{tip.title}</h3>
            <p className="nesio-tips-body">{tip.body}</p>
            <div className="nesio-tips-actions">
              <button type="button" className="nesio-ob-primary-btn" onClick={() => setStep(step + 1)}>{t(locale, 'onboardingTipNext')}</button>
              <button type="button" className="nesio-ob-skip-btn" onClick={onDone}>{t(locale, 'onboardingSkip')}</button>
            </div>
          </>
        )}
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

  function syncProfileFromSession(session: AuthSessionResult) {
    const name = deriveDisplayNameFromSession(session);
    if (!name) return;
    try {
      const profile = loadProfileSettings();
      if (!profile.displayName) {
        saveProfileSettings({ displayName: name });
        setDisplayName(name);
      }
    } catch {
      setDisplayName(name);
    }
  }

  function markOnboardingDone() {
    try {
      markNesioOnboardingDoneForAuth();
    } catch { /* ignore */ }
  }

  function completeOnboardingAfterAuth(options: { showTips?: boolean } = {}) {
    markOnboardingDone();
    setVisible(false);
    try {
      if (options.showTips !== false && !localStorage.getItem(TIPS_SHOWN_KEY)) setShowTips(true);
    } catch {
      if (options.showTips !== false) setShowTips(true);
    }
    loadMirrorFromCloud().catch(() => undefined);
  }

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('nesio-onboarding-visibility-change', {
      detail: { active: visible },
    }));
    return () => {
      window.dispatchEvent(new CustomEvent('nesio-onboarding-visibility-change', {
        detail: { active: false },
      }));
    };
  }, [visible]);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const profile = loadProfileSettings();
        if (cancelled) return;
        setDisplayName(profile.displayName || '');
        setLocale(profile.locale || 'zh');

        const done = localStorage.getItem(ONBOARDING_DONE_KEY) === '1' ||
          localStorage.getItem(LEGACY_ONBOARDING_DONE_KEY) === '1';
        const callbackArrived = hasAuthCallbackSuccess();
        const callbackReady = hasAuthReadyCallbackSuccess();

        const session = await readAuthSession();
        if (cancelled) return;
        if (isAuthReadySession(session)) {
          syncProfileFromSession(session);
          completeOnboardingAfterAuth({ showTips: false });
          clearAuthCallbackParams();
          return;
        }

        if (callbackReady) {
          completeOnboardingAfterAuth({ showTips: false });
          clearAuthCallbackParams();
          return;
        }

        if (callbackArrived) clearAuthCallbackParams();

        if (done) {
          if (!localStorage.getItem(TIPS_SHOWN_KEY)) setShowTips(true);
          return;
        }

        setVisible(true);
      } catch {
        if (!cancelled) setVisible(true);
      }
    }

    function handleAuthReady(event: Event) {
      const detail = (event as CustomEvent<AuthReadyEventDetail>).detail;
      if ((!detail?.ok && !detail?.loggedIn && detail?.authReady !== true) || detail?.profileBootstrapBlocking === true) return;
      readAuthSession().then((session) => {
        if (cancelled) return;
        if (isAuthReadySession(session)) {
          syncProfileFromSession(session);
          completeOnboardingAfterAuth({ showTips: false });
          clearAuthCallbackParams();
        }
      }).catch(() => undefined);
    }

    hydrate();
    window.addEventListener('nesio-auth-session-imported', handleAuthReady);
    window.addEventListener('nesio-auth-session-ready', handleAuthReady);
    window.addEventListener(NESIO_ONBOARDING_COMPLETE_EVENT, handleAuthReady);
    return () => {
      cancelled = true;
      window.removeEventListener('nesio-auth-session-imported', handleAuthReady);
      window.removeEventListener('nesio-auth-session-ready', handleAuthReady);
      window.removeEventListener(NESIO_ONBOARDING_COMPLETE_EVENT, handleAuthReady);
    };
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
    markOnboardingDone();
    setVisible(false);
    setShowTips(true);
    loadMirrorFromCloud().catch(() => undefined);
  }

  function handleTipsDone() {
    try { localStorage.setItem(TIPS_SHOWN_KEY, '1'); } catch { /* ignore */ }
    setShowTips(false);
  }

  if (showTips) return <FirstUseTips onDone={handleTipsDone} locale={locale} />;
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
