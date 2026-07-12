'use client';

import { useEffect, useState } from 'react';
import NesioMark from './NesioMark';
import type { PortalLocale } from '@/lib/portal/profile';
import { isAppStoreBuild } from '@/lib/portal/app-build.mjs';

/**
 * 「添加到主屏」引导(第三波 · 免费 PWA 装机)。装成 PWA 的用户留存显著更高。
 *  - Chrome/Edge/Android:接 beforeinstallprompt,给「安装」按钮直接触发系统安装。
 *  - iOS Safari(无 beforeinstallprompt):显示手动提示(分享 → 添加到主屏幕)。
 *  - 已装(standalone)或 App Store 原生构建:不显示(原生 App 无「加主屏」概念)。
 *  - 可关闭,关掉后 14 天内不再打扰(localStorage 冷却)。延迟出现,不抢第一屏。
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'nesio-a2hs-dismissed-until';
const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const APPEAR_DELAY_MS = 4000;

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const notOtherBrowser = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return iOS && webkit && notOtherBrowser;
}

function dismissedRecently(): boolean {
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY) || '0');
    return Date.now() < until;
  } catch { return false; }
}

export default function InstallPrompt({ locale = 'zh' }: { locale?: PortalLocale }) {
  const zh = locale === 'zh';
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [mode, setMode] = useState<'none' | 'chrome' | 'ios'>('none');

  useEffect(() => {
    if (isAppStoreBuild() || isStandalone() || dismissedRecently()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      window.setTimeout(() => setMode('chrome'), APPEAR_DELAY_MS);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // iOS Safari 不触发 beforeinstallprompt → 延迟后给手动提示
    let iosTimer: ReturnType<typeof setTimeout> | undefined;
    if (isIosSafari()) iosTimer = setTimeout(() => setMode((m) => (m === 'none' ? 'ios' : m)), APPEAR_DELAY_MS);

    const onInstalled = () => { setMode('none'); setDeferred(null); };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  function close() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + COOLDOWN_MS)); } catch { /* ignore */ }
    setMode('none');
  }

  async function install() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch { /* ignore */ }
    setDeferred(null);
    setMode('none');
  }

  if (mode === 'none') return null;

  return (
    <div role="dialog" aria-live="polite" style={{
      position: 'fixed', left: '50%', transform: 'translateX(-50%)',
      bottom: 'calc(var(--portal-bottom-nav-clearance, 84px) + env(safe-area-inset-bottom, 0px))',
      width: 'min(92vw, 420px)', zIndex: 60,
      background: 'var(--sheet-opaque, #fff)', color: 'var(--portal-ink, #2c2c2c)',
      border: '1px solid var(--portal-line, #d7deea)', borderRadius: 16,
      boxShadow: '0 8px 30px rgba(15, 30, 60, 0.18)', padding: '0.9rem 1rem',
      display: 'flex', alignItems: 'center', gap: '0.75rem',
    }}>
      <NesioMark size={34} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.92rem' }}>
          {zh ? '把 Nesio 装到主屏' : 'Add Nesio to your Home Screen'}
        </p>
        <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: 'var(--portal-muted, #8a94a6)' }}>
          {mode === 'ios'
            ? (zh ? '点击底部「分享」→「添加到主屏幕」' : 'Tap Share → “Add to Home Screen”')
            : (zh ? '像 App 一样打开,离线也能用' : 'Opens like an app, works offline too')}
        </p>
      </div>
      {mode === 'chrome' && (
        <button type="button" onClick={install} style={{
          flexShrink: 0, background: 'var(--portal-accent, #588ce3)', color: 'var(--portal-on-accent, #fff)',
          border: 'none', borderRadius: 999, padding: '0.45rem 0.9rem', fontSize: '0.85rem',
          fontWeight: 600, cursor: 'pointer',
        }}>{zh ? '安装' : 'Install'}</button>
      )}
      <button type="button" onClick={close} aria-label={zh ? '关闭' : 'Dismiss'} style={{
        flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--portal-muted, #8a94a6)', fontSize: '1.1rem', lineHeight: 1, padding: '0.2rem',
      }}>✕</button>
    </div>
  );
}
