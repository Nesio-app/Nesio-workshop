'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import NesioMark from './NesioMark';
import { L, t } from '@/lib/portal/i18n';
import { IconTarget, IconSmile, IconMic, IconZap, IconStar, IconBulb, IconMail, IconLock } from './icons';
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
export const TIPS_SHOWN_KEY = 'nesio-tips-shown-v1';

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

// 设置页「预览引导」用 ?preview=tour|welcome 强制重放,绕过登录态的短路(否则永不出现)。
function readPreviewParam(): 'tour' | 'welcome' | null {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('preview');
  return v === 'tour' || v === 'welcome' ? v : null;
}

function clearPreviewParam() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.has('preview')) {
    url.searchParams.delete('preview');
    window.history.replaceState(null, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
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
        <NesioMark className="nesio-ob-logo" />
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
      <div className="nesio-ob-step-icon" aria-hidden><IconSmile size={30} /></div>
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
      <div className="nesio-ob-step-icon" aria-hidden><IconMail size={30} /></div>
      <h2 className="nesio-ob-step-title">{t(locale, 'onboardingAuthCheckEmailTitle')}</h2>
      <p className="nesio-ob-step-sub">{t(locale, 'onboardingAuthLinkSentTemplate', { email })}</p>
      <button type="button" className="nesio-ob-primary-btn" onClick={onDone}>{t(locale, 'onboardingAuthContinueLocal')}</button>
    </div>
  );

  return (
    <div className="nesio-ob-step">
      <div className="nesio-ob-step-icon" aria-hidden><IconLock size={30} /></div>
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

type TourStep = {
  Icon: React.ComponentType<{ size?: number }>;
  title: string;
  body: string;
  target: string | null;                 // data-tour 值;null = 居中
  place?: 'above' | 'below' | 'auto';
  round?: boolean;                        // 圆形高亮(中键)
  tap?: boolean;                          // 可交互:让用户真的点/长按目标(浮层放行点击)
  longpress?: boolean;                    // tap 提示写「长按」
};

export function FirstUseTips({ onDone, locale }: { onDone: () => void; locale: PortalLocale }) {
  const [step, setStep] = useState(0);
  const dict = portalLocaleToDictionaryLocale(locale);
  // 聚光式 coach-mark:每步定位到对应 UI(data-tour),高亮 + 气泡指过去;中键步可真实点/长按。
  const steps: TourStep[] = [
    { Icon: IconTarget, title: t(locale, 'onboardingTipTodayTitle'), body: t(locale, 'onboardingTipTodayBody'), target: 'today', place: 'above' },
    { Icon: IconSmile, title: L(dict, '今天第一拍:心情', "Today's first beat: mood"), body: L(dict, '这里点一下心情,记下此刻的情绪和精力 —— 后面洞察会把它连成规律。', 'Tap here to log how you feel and your energy — Insights weaves it into patterns later.'), target: 'mood', place: 'auto' },
    { Icon: IconMic, title: L(dict, '存一条试试', 'Save one — try it'), body: L(dict, '点中间按钮:说一句、拍一下、或收一条链接,先存成草稿。存一条试试。', 'Tap the center button — say a line, snap a photo, or drop in a link. It saves as a draft. Try saving one.'), target: 'center', place: 'above', round: true, tap: true },
    { Icon: IconZap, title: L(dict, '任务太大?拆一下', 'Too big? Break it down'), body: L(dict, '今天要紧的事上点「拆一下」—— 把一件大事拆成 3 个立刻能动手的小步。', 'On a focus item, tap "Break down" — a big task becomes 3 steps you can start right now.'), target: 'breakdown', place: 'below' },
    { Icon: IconStar, title: t(locale, 'onboardingTipMemoryTitle'), body: L(dict, '你记过的一切都在「记忆」里。长按任意卡片:标为核心记忆,或加进某个项目。', 'Everything you noted lives in Memory. Long-press any card: mark it Core, or add it to a Project.'), target: 'memory', place: 'above' },
    { Icon: IconBulb, title: L(dict, '洞察:把点连成线', 'Insights: connect the dots'), body: L(dict, '点左上角这个晶体进洞察 —— 心情、关系、足迹、花销会被连成规律,轻轻提醒。', 'Tap this crystal top-left for Insights — mood, people, places and spending linked into gentle patterns.'), target: 'insights', place: 'below' },
    { Icon: IconMic, title: L(dict, '长按中间按钮有惊喜', 'Long-press the center for a surprise'), body: L(dict, '长按中间按钮松手,调出「问一问」—— 直接问念念「护照放哪」「上次买的药」,记过的都能找回。试试长按。', 'Long-press & release the center button to open Ask — ask Nessa "Where’s my passport?" or "that medicine I bought"; anything noted comes back. Give it a long-press.'), target: 'center', place: 'above', round: true, tap: true, longpress: true },
  ];
  const cur = steps[step];
  const StepIcon = cur.Icon;
  const isLast = step === steps.length - 1;

  // 目标元素的位置(每步/尺寸变化重测;元素还没布好用 rAF 重试)
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!cur.target) { setRect(null); return; }
    let raf = 0; let tries = 0;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${cur.target}"]`) as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { setRect(r); return; }
      }
      if (tries++ < 30) raf = requestAnimationFrame(measure);
      else setRect(null); // 找不到就退化成居中,不至于卡住
    };
    measure();
    const onChange = () => measure();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onChange); window.removeEventListener('scroll', onChange, true); };
  }, [step, cur.target]);

  const dots = (
    <div className="nesio-tips-dots" aria-hidden>
      {steps.map((_, i) => <span key={i} className={`nesio-tips-dot${i === step ? ' nesio-tips-dot--active' : ''}`} />)}
    </div>
  );

  const content = (
    <>
      {dots}
      <div className="nesio-tips-emoji" aria-hidden><StepIcon size={26} /></div>
      <h3 className="nesio-tips-title">{cur.title}</h3>
      <p className="nesio-tips-body">{cur.body}</p>
      {cur.tap && (
        <div className="nesio-coach-taphint" aria-hidden>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11V6a2 2 0 014 0v5" /><path d="M13 8a2 2 0 014 0v3" /><path d="M17 9a2 2 0 014 0v4a7 7 0 01-7 7h-2a7 7 0 01-6-4l-1.5-3a1.6 1.6 0 012.7-1.6L9 13" /></svg>
          {cur.longpress ? L(dict, '长按这个按钮试试', 'Long-press this button') : L(dict, '点一下这个按钮试试', 'Tap this button to try')}
        </div>
      )}
      <div className="nesio-tips-actions">
        <span className="nesio-tips-count">{step + 1}/{steps.length}</span>
        <button type="button" className="nesio-ob-skip-btn" onClick={onDone}>{t(locale, 'onboardingSkip')}</button>
        <button type="button" className="nesio-ob-primary-btn" onClick={() => (isLast ? onDone() : setStep(step + 1))}>
          {isLast ? L(dict, '开始使用', 'Start') : t(locale, 'onboardingTipNext')}
        </button>
      </div>
    </>
  );

  // 几何:气泡贴目标上/下方,水平夹在视口内;caret 指向目标中心
  const geo = (() => {
    if (typeof window === 'undefined' || !rect) return null;
    const VW = window.innerWidth, VH = window.innerHeight;
    const bw = Math.min(300, VW - 24);
    const gap = 14, pad = 8;
    const cx = rect.left + rect.width / 2;
    const place: 'above' | 'below' = cur.place === 'auto' ? (rect.top > VH / 2 ? 'above' : 'below') : (cur.place ?? 'above');
    const left = Math.min(Math.max(cx - bw / 2, 12), VW - bw - 12);
    const caretX = Math.min(Math.max(cx - left, 24), bw - 24);
    return { VH, bw, gap, pad, place, left, caretX };
  })();

  // 可交互步:不再放行点真实按钮(会打开拍/说/收把导览盖住、卡在原步),改为在高亮处盖一个
  // 透明命中区,点它=完成这步直接进下一步/收尾。既有「点一下试试」的手感,又保证能往下走。
  const overlayCls = [
    'nesio-coach-overlay',
    geo ? '' : 'nesio-coach-overlay--dim',
  ].filter(Boolean).join(' ');

  return (
    <div className={overlayCls} role="dialog" aria-modal="true" aria-label={t(locale, 'onboardingTipsAriaLabel')}>
      {geo && rect && (
        <div className="nesio-coach-spot" aria-hidden
          style={{ left: rect.left - geo.pad, top: rect.top - geo.pad, width: rect.width + geo.pad * 2, height: rect.height + geo.pad * 2, borderRadius: cur.round ? '50%' : 16 }} />
      )}
      {cur.tap && geo && rect && (
        <button type="button" className="nesio-coach-hit"
          aria-label={cur.longpress ? L(dict, '长按这个按钮试试', 'Long-press this button') : L(dict, '点一下这个按钮试试', 'Tap this button')}
          style={{ left: rect.left - geo.pad, top: rect.top - geo.pad, width: rect.width + geo.pad * 2, height: rect.height + geo.pad * 2, borderRadius: cur.round ? '50%' : 16 }}
          onClick={() => (isLast ? onDone() : setStep(step + 1))} />
      )}
      {geo && rect ? (
        <div key={step} className={`nesio-coach-bubble nesio-coach-bubble--${geo.place}`}
          style={geo.place === 'above'
            ? { left: geo.left, width: geo.bw, bottom: geo.VH - rect.top + geo.gap }
            : { left: geo.left, width: geo.bw, top: rect.bottom + geo.gap }}>
          <span className="nesio-coach-caret" style={{ left: geo.caretX }} aria-hidden />
          {content}
        </div>
      ) : (
        <div className="nesio-coach-bubble nesio-coach-bubble--center">{content}</div>
      )}
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
  // 预览模式(设置页「预览引导」触发):此时别让登录态事件把强制显示的引导关掉。
  const previewModeRef = useRef(false);

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

        // 「预览引导」强制重放:在登录态短路之前判定,否则已登录用户永远看不到引导。
        // 不在这里清 URL 参数 —— hydrate 可能被 React 双调用/重挂,清早了第二次就读不到、
        // 强制显示丢失(welcome 尤其明显)。留到用户看完/跳过时再清,保证每次 hydrate 同解。
        const preview = readPreviewParam();
        if (preview === 'tour') { previewModeRef.current = true; setShowTips(true); return; }
        if (preview === 'welcome') { previewModeRef.current = true; setStep('welcome'); setVisible(true); return; }

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
      if (previewModeRef.current) return; // 预览强制显示中,别被登录态事件关掉
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
    clearPreviewParam();
    previewModeRef.current = false;
    markOnboardingDone();
    setVisible(false);
    setShowTips(true);
    loadMirrorFromCloud().catch(() => undefined);
  }

  function handleTipsDone() {
    clearPreviewParam();
    previewModeRef.current = false;
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
