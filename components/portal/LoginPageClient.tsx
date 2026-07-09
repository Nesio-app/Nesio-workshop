'use client';

import { useEffect, useState } from 'react';
import { loadProfileSettings, saveProfileSettings, type PortalLocale } from '@/lib/portal/profile';
import { getAuthRedirectTo, importSupabaseHashSession } from '@/lib/portal/auth-client';
import { isAppStoreBuild } from '@/lib/portal/app-build.mjs';

type AuthState = 'idle' | 'loading' | 'email_sent' | 'error';
type AuthMode = 'login' | 'register';

async function startAuth(provider: string, authMode: AuthMode, email?: string): Promise<{ ok: boolean; url?: string; error?: string; status?: number }> {
  try {
    const redirectTo = getAuthRedirectTo();
    const res = await fetch('/api/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, authMode, email, redirectTo }),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) as { ok?: boolean; url?: string; error?: string } : {};
    return { ok: Boolean(data.ok), url: data.url, error: data.error, status: res.status };
  } catch { return { ok: false, error: 'network' }; }
}

function friendlyAuthError(error: string | undefined, zh: boolean): string {
  if (error === 'provider_not_configured' || error === 'missing_supabase_config') {
    return zh ? '登录服务还没有配置好，请先本地使用。' : 'Sign-in is not configured yet. You can use Nesio locally.';
  }
  if (error === 'supabase_otp_failed') {
    return zh ? '登录邮件没有发出，请稍后再试，或先本地使用。' : 'The sign-in email was not sent. Try again later or use Nesio locally.';
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
  const zh = locale === 'zh';
  // App Store 构建强制显示 Sign in with Apple(Guideline 4.8:提供 Google 登录就必须提供
  // Apple 登录)。Web PWA 暂不显示,等 Supabase 里 Apple Service ID 配好后再放开。
  const appStore = isAppStoreBuild();

  useEffect(() => {
    setLocale(loadProfileSettings().locale);
  }, []);

  useEffect(() => {
    let cancelled = false;
    importSupabaseHashSession().then((result) => {
      if (!cancelled && result.imported && result.ok) {
        window.location.href = '/';
      }
    });
    return () => { cancelled = true; };
  }, []);

  async function handleGoogle() {
    setState('loading'); setError('');
    const r = await startAuth('google', tab);
    if (r.ok && r.url) { window.location.href = r.url; }
    else { setError(friendlyAuthError(r.error, zh)); setState('error'); }
  }

  async function handleApple() {
    setState('loading'); setError('');
    const r = await startAuth('apple', tab);
    if (r.ok && r.url) { window.location.href = r.url; }
    else { setError(friendlyAuthError(r.error, zh)); setState('error'); }
  }

  async function handleEmail() {
    if (!email.trim()) return;
    setState('loading'); setError('');
    const r = await startAuth('email', tab, email.trim());
    if (r.ok) { setState('email_sent'); }
    else { setError(friendlyAuthError(r.error, zh)); setState('error'); }
  }

  return (
    <div className="nesio-login-root">
      <div className="nesio-login-bg" aria-hidden />
      <div className="nesio-login-card">
        {/* Logo */}
        <div className="nesio-login-logo-row">
          <img src="/icons/treasurebox-pwa-192.png" alt="Nesio" className="nesio-login-logo-img" />
          <span className="nesio-ob-brand" style={{ fontSize: '1.3rem' }}>Nesio</span>
        </div>

        {state === 'email_sent' ? (
          <div className="nesio-login-sent">
            <div style={{ fontSize: '2.5rem', textAlign: 'center', marginBottom: '0.75rem' }}>📬</div>
            <h2 className="nesio-ob-step-title">{zh ? '查一下邮件' : 'Check your email'}</h2>
            <p className="nesio-ob-step-sub">{zh ? `登录链接已发到 ${email}，点击链接完成登录。` : `A sign-in link was sent to ${email}.`}</p>
            <a href="/" className="nesio-ob-primary-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: '1rem' }}>
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

            <p className="nesio-ob-step-sub" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
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
              onKeyDown={(e) => { if (e.key === 'Enter') handleEmail(); }}
              autoComplete="email"
            />

            <button type="button" className="nesio-ob-primary-btn" onClick={handleEmail} disabled={state === 'loading' || !email.trim()}>
              {state === 'loading' ? (zh ? '发送中…' : 'Sending…') : (zh ? `发送${tab === 'register' ? '注册' : '登录'}链接` : `Send ${tab === 'register' ? 'sign-up' : 'sign-in'} link`)}
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
            <div className="nesio-ob-lang-row" style={{ marginTop: '1.25rem' }}>
              <button type="button" className={`nesio-ob-lang-btn${zh ? ' nesio-ob-lang-btn--active' : ''}`} onClick={() => { setLocale('zh'); saveProfileSettings({ locale: 'zh' }); }}>简体中文</button>
              <button type="button" className={`nesio-ob-lang-btn${!zh ? ' nesio-ob-lang-btn--active' : ''}`} onClick={() => { setLocale('en'); saveProfileSettings({ locale: 'en' }); }}>English</button>
            </div>

            <a href="/" className="nesio-ob-skip-btn" style={{ display: 'block', textAlign: 'center', marginTop: '0.5rem', textDecoration: 'none' }}>
              {zh ? '暂不登录，本地使用' : 'Skip — use locally'}
            </a>

            <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.75rem', color: 'var(--portal-muted, #8a94a6)' }}>
              <a href="/privacy" style={{ color: 'inherit' }}>{zh ? '隐私政策' : 'Privacy Policy'}</a>
              <span style={{ margin: '0 0.4rem' }}>·</span>
              <a href="/support" style={{ color: 'inherit' }}>{zh ? '支持' : 'Support'}</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
