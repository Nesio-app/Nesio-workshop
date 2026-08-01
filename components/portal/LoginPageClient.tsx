'use client';

import { useEffect, useState } from 'react';
import NesioMark from './NesioMark';
import { loadProfileSettings, saveProfileSettings, type PortalLocale } from '@/lib/portal/profile';
import { getAuthRedirectTo, importSupabaseHashSession } from '@/lib/portal/auth-client';
import { isAppStoreBuild } from '@/lib/portal/app-build.mjs';
import { IconMail } from './icons';

type AuthState = 'idle' | 'loading' | 'email_sent' | 'error';
type AuthMode = 'login' | 'register';

async function startAuth(provider: string, authMode: AuthMode, email?: string): Promise<{ ok: boolean; url?: string; error?: string; status?: number }> {
  try {
    const redirectTo = getAuthRedirectTo();
    // 10 秒不回就当网络问题 —— 原来没有超时,这一跳卡住按钮就永远停在「跳转中…」。
    const res = await fetch('/api/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, authMode, email, redirectTo }),
      signal: (() => { try { return AbortSignal.timeout(10_000); } catch { return undefined; } })(),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) as { ok?: boolean; url?: string; error?: string } : {};
    return { ok: Boolean(data.ok), url: data.url, error: data.error, status: res.status };
  } catch { return { ok: false, error: 'network' }; }
}

function friendlyAuthError(error: string | undefined, zh: boolean): string {
  // 服务端说 ok 但没给跳转地址 —— 罕见,但不给话说就成了「点了没反应」。
  if (error === 'no_redirect_url') {
    return zh ? '没拿到跳转地址,再试一次。' : "Didn't get a redirect link — try again.";
  }
  if (error === 'provider_not_configured' || error === 'missing_supabase_config') {
    return zh ? '登录服务还没有配置好，请先本地使用。' : 'Sign-in is not configured yet. You can use Nesio locally.';
  }
  if (error === 'supabase_otp_failed') {
    return zh ? '登录邮件没有发出，请稍后再试，或先本地使用。' : 'The sign-in email was not sent. Try again later or use Nesio locally.';
  }
  if (error === 'not_invited') {
    // 邀请制(2026-07-31)。这句要**说清楚是名单问题,不是他填错了** ——
    // 说成「登录失败」的话,人会反复试密码、重发验证码,最后以为是自己账号坏了。
    // 同时留出口:Nesio 不登录也能用本地功能,那不是安慰话,是真的。
    return zh
      ? '这个邮箱还不在名单上。Nesio 现在是邀请制 —— 跟主人说一声，把你加进来就行。不登录也能先本地用。'
      : 'This email is not on the list yet. Nesio is invite-only right now — ask the owner to add you. You can still use it locally without signing in.';
  }
  if (error === 'user_not_found') {
    return zh ? '没有找到这个邮箱，请切换到注册。' : 'No account was found for this email. Switch to create account.';
  }
  if (error === 'user_already_exists') {
    return zh ? '这个邮箱已经注册过，请切换到登录。' : 'This email already has an account. Switch to sign in.';
  }
  if (error === 'auth_start_exception') {
    return zh ? '登录服务暂时不可用，请先本地使用。' : 'Sign-in is temporarily unavailable. You can use Nesio locally.';
  }
  if (error === 'network') {
    return zh ? '连接登录服务失败，请检查网络后再试。' : 'Could not reach the sign-in service. Check your connection and try again.';
  }
  return zh ? '发送失败，请检查邮箱地址或先本地使用。' : 'Failed to send. Check your email or use Nesio locally.';
}

export default function LoginPageClient() {
  const [locale, setLocale] = useState<PortalLocale>('zh');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<AuthState>('idle');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [reason, setReason] = useState('');
  const zh = locale === 'zh';
  // App Store 构建强制显示 Sign in with Apple(Guideline 4.8:提供 Google 登录就必须提供
  // Apple 登录)。Web PWA 暂不显示,等 Supabase 里 Apple Service ID 配好后再放开。
  const appStore = isAppStoreBuild();

  useEffect(() => {
    setLocale(loadProfileSettings().locale);
    try {
      const q = new URLSearchParams(window.location.search).get('reason') || '';
      setReason(q);
      if (q === 'not_registered') setTab('register');
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    importSupabaseHashSession().then((result) => {
      if (cancelled || !result.imported) return;
      if (result.status === 'account_not_registered') {
        setReason('not_registered');
        setTab('register');
        return;
      }
      if (result.ok) window.location.href = '/';
    });
    return () => { cancelled = true; };
  }, []);


  /**
   * 走 OAuth。原来的写法有个死胡同:setState('loading') 之后,只有拿到 url 并且
   * 浏览器真的跳走才会变。拿到 ok 但 url 是空的、或者赋值了 location 却没跳成,
   * 按钮就永久停在「跳转中…」(标注 图2 那张)。这里补两条退路:
   *   · url 空 → 当失败处理,给可点的错误;
   *   · 跳转指令发出后 12 秒还站在这一页 → 说明没跳成,恢复按钮并说明白。
   */
  async function startOauthFlow(provider: 'google' | 'apple') {
    setState('loading'); setError('');
    try { localStorage.setItem('nesio-auth-intent-v1', tab); } catch { /* ignore */ }
    const r = await startAuth(provider, tab);
    if (!r.ok || !r.url) {
      setError(friendlyAuthError(r.ok ? 'no_redirect_url' : r.error, zh));
      setState('error');
      return;
    }
    window.setTimeout(() => {
      setState((cur) => {
        if (cur !== 'loading') return cur;
        setError(zh ? '没跳过去 —— 再点一次试试。' : "Didn't get through — tap again.");
        return 'error';
      });
    }, 12_000);
    window.location.href = r.url;
  }

  async function handleGoogle() {
    await startOauthFlow('google');
  }

  async function handleApple() {
    await startOauthFlow('apple');
  }

  async function handleEmail() {
    if (!email.trim()) return;
    setState('loading'); setError('');
    const r = await startAuth('email', tab, email.trim());
    if (r.ok) { setState('email_sent'); }
    else { setError(friendlyAuthError(r.error, zh)); setState('error'); }
  }

  // QA:「登录和注册功能一模一样」—— 邮箱此前只有魔法链接。补密码流:
  // 注册=设密码建账号;登录=填密码直进。魔法链接保留作「忘记/无密码」备选。
  const [password, setPassword] = useState('');
  async function handlePassword() {
    if (!email.trim() || !password) return;
    setState('loading'); setError('');
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: tab, email: email.trim(), password }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; needsEmailConfirm?: boolean };
      if (data.ok && data.needsEmailConfirm) { setState('email_sent'); return; }
      if (data.ok) { window.location.href = '/'; return; }
      const msg = data.error === 'invalid_credentials'
        ? (zh ? '邮箱或密码不对。忘了密码可以用下面的邮件链接登录。' : 'Wrong email or password. Forgot it? Use the email link below.')
        : data.error === 'user_already_exists'
          ? (zh ? '这个邮箱已经注册过,请切换到登录。' : 'This email already has an account — switch to sign in.')
          : data.error === 'password_too_short'
            ? (zh ? '密码至少 8 位。' : 'Password must be at least 8 characters.')
            : friendlyAuthError(data.error, zh);
      setError(msg); setState('error');
    } catch { setError(friendlyAuthError('network', zh)); setState('error'); }
  }

  return (
    <div className="nesio-login-root">
      <div className="nesio-login-bg" aria-hidden />
      <div className="nesio-login-card">
        {/* Logo */}
        <div className="nesio-login-logo-row">
          <NesioMark className="nesio-login-logo-img" />
          <span className="nesio-ob-brand" style={{ fontSize: 'var(--text-h2)' }}>Nesio</span>
        </div>

        {state === 'email_sent' ? (
          <div className="nesio-login-sent">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-3)', color: 'var(--portal-accent)' }} aria-hidden><IconMail size={38} /></div>
            <h2 className="nesio-ob-step-title">{zh ? '查一下邮件' : 'Check your email'}</h2>
            <p className="nesio-ob-step-sub">{zh ? `登录链接已发到 ${email}，点击链接完成登录。` : `A sign-in link was sent to ${email}.`}</p>
            <a href="/" className="nesio-ob-primary-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 'var(--space-4)' }}>
              {zh ? '返回首页' : 'Back to home'}
            </a>
          </div>
        ) : (
          <>
            {/* Tab: login / register */}
            <div className="nesio-login-tabs">
              <button type="button" className={`nesio-login-tab${tab === 'login' ? ' nesio-login-tab--active' : ''}`} onClick={() => setTab('login')}>
                {zh ? '登录' : 'Sign in'}
              </button>
              <button type="button" className={`nesio-login-tab${tab === 'register' ? ' nesio-login-tab--active' : ''}`} onClick={() => setTab('register')}>
                {zh ? '注册' : 'Create account'}
              </button>
            </div>

            {reason === 'not_registered' && (
              <p className="nesio-ob-step-sub" style={{ textAlign: 'center', marginBottom: 'var(--space-3)', color: 'var(--status-gentle, #c9923f)' }}>
                {zh ? '这个 Google 账号还没注册过 Nesio。在下面用它「创建账号」即可。' : "This Google account isn't registered with Nesio yet. Use it to create an account below."}
              </p>
            )}
            {reason === 'connect_requires_account' && (
              <p className="nesio-ob-step-sub" style={{ textAlign: 'center', marginBottom: 'var(--space-3)', color: 'var(--portal-accent, #588ce3)' }}>
                {zh ? '连接邮箱 / 日历 / 银行等私有数据源,需要先登录账号。' : 'Connecting private sources (email, calendar, banks) requires an account.'}
              </p>
            )}
            <p className="nesio-ob-step-sub" style={{ textAlign: 'center', marginBottom: 'var(--space-5)' }}>
              {tab === 'login'
                ? (zh ? '登录后，Memory 与 Today Feed 跨设备同步。' : 'Sign in to sync your Memory and Today across devices.')
                : (zh ? '新用户创建账号。首次 Google 授权或邮件确认后，Nesio 会建立你的账户。' : 'Create a new account. Google or email confirmation creates your Nesio account.')}
            </p>

            {/* Sign in with Apple —— 仅 App Store 构建(4.8)。HIG:与其他登录按钮同等醒目,置顶。 */}
            {appStore && (
              /* eslint-disable no-restricted-syntax -- Apple 品牌黑,HIG 固定值不随主题 */
              <button
                type="button"
                className="nesio-ob-auth-btn"
                style={{ background: '#000', color: '#fff', border: 'none' }}
                onClick={handleApple}
                disabled={state === 'loading'}
              >
                <svg viewBox="0 0 384 512" width="18" height="18" fill="#fff" aria-hidden>
                  <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zM255.6 68c30.6-36.3 27.8-69.4 26.9-81.3-26.9 1.6-58 18.4-75.7 39.1-19.5 22.2-31 49.7-28.5 79.1 29.1 2.3 55.6-12.7 77.3-36.9z"/>
                </svg>
                {state === 'loading' ? (zh ? '跳转中…' : 'Redirecting…') : (zh ? '通过 Apple 登录' : 'Sign in with Apple')}
              </button>
              /* eslint-enable no-restricted-syntax */
            )}

            {/* Google */}
            <button type="button" className="nesio-ob-auth-btn nesio-ob-auth-btn--google" onClick={handleGoogle} disabled={state === 'loading'}>
              {/* eslint-disable no-restricted-syntax -- Google 官方品牌色,固定值不随主题 */}
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {/* eslint-enable no-restricted-syntax */}
              {state === 'loading' ? (zh ? '跳转中…' : 'Redirecting…') : (zh ? `用 Google ${tab === 'register' ? '注册' : '登录'}` : `${tab === 'register' ? 'Sign up' : 'Sign in'} with Google`)}
            </button>

            <div className="nesio-login-divider"><span>{zh ? '或用邮件' : 'or with email'}</span></div>

            <input
              type="email"
              className="nesio-ob-input"
              placeholder={zh ? '你的邮箱地址' : 'your@email.com'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <input
              type="password"
              className="nesio-ob-input"
              placeholder={tab === 'register' ? (zh ? '设置密码(至少 8 位)' : 'Set a password (8+ characters)') : (zh ? '密码' : 'Password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePassword(); }}
              autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
            />

            <button type="button" className="nesio-ob-primary-btn" onClick={handlePassword} disabled={state === 'loading' || !email.trim() || !password}>
              {state === 'loading'
                ? (zh ? '请稍等…' : 'One moment…')
                : tab === 'register' ? (zh ? '创建账号' : 'Create account') : (zh ? '登录' : 'Sign in')}
            </button>

            {/* 无密码备选:魔法链接(也兼作「忘记密码」的出路) */}
            <button
              type="button"
              onClick={handleEmail}
              disabled={state === 'loading' || !email.trim()}
              style={{ width: '100%', marginTop: 'var(--space-2)', background: 'none', border: 'none', color: 'var(--portal-muted, #8a94a6)', fontSize: 'var(--text-sm)', cursor: 'pointer', textDecoration: 'underline' }}
            >
              {zh ? (tab === 'register' ? '不设密码,用邮件链接注册' : '忘记密码?用邮件链接登录') : (tab === 'register' ? 'No password — sign up with an email link' : 'Forgot password? Sign in with an email link')}
            </button>

            {error && <p className="nesio-ob-error">{error}</p>}

            {tab === 'register' && (
              <p className="nesio-login-note">
                {zh
                  ? '注册会在 Supabase Auth 中创建账户；你仍可以先选择“本地使用”。'
                  : 'Sign-up creates an account in Supabase Auth. You can still use local mode first.'}
              </p>
            )}

            {/* Language */}
            <div className="nesio-ob-lang-row" style={{ marginTop: 'var(--space-5)' }}>
              <button type="button" className={`nesio-ob-lang-btn${zh ? ' nesio-ob-lang-btn--active' : ''}`} onClick={() => { setLocale('zh'); saveProfileSettings({ locale: 'zh' }); }}>简体中文</button>
              <button type="button" className={`nesio-ob-lang-btn${!zh ? ' nesio-ob-lang-btn--active' : ''}`} onClick={() => { setLocale('en'); saveProfileSettings({ locale: 'en' }); }}>English</button>
            </div>

            <a href="/" className="nesio-ob-skip-btn" style={{ display: 'block', textAlign: 'center', marginTop: 'var(--space-2)', textDecoration: 'none' }}>
              {zh ? '暂不登录，本地使用' : 'Skip — use locally'}
            </a>

            <p style={{ textAlign: 'center', marginTop: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--portal-muted, #8a94a6)' }}>
              <a href="/terms" style={{ color: 'inherit' }}>{zh ? '服务条款' : 'Terms'}</a>
              <span style={{ margin: '0 var(--space-2)' }}>·</span>
              <a href="/privacy" style={{ color: 'inherit' }}>{zh ? '隐私政策' : 'Privacy Policy'}</a>
              <span style={{ margin: '0 var(--space-2)' }}>·</span>
              <a href="/support" style={{ color: 'inherit' }}>{zh ? '支持' : 'Support'}</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
