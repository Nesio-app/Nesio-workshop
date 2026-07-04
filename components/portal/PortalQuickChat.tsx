'use client';

import { useEffect, useRef, useState } from 'react';
import { ensureToolboxTrailingSlash, withBase } from '@/lib/portal/paths';
import { loadProfileSettings } from '@/lib/portal/profile';
import type { PortalLocale } from '@/lib/portal/profile';
import { t } from '@/lib/portal/i18n';

const QUICK_LINKS: Array<{ key: 'quickChatActionSecretary' | 'quickChatActionGemini' | 'quickChatActionGroup'; href: string; icon: string }> = [
  { key: 'quickChatActionSecretary', href: ensureToolboxTrailingSlash('/secretary'), icon: '💬' },
  { key: 'quickChatActionGemini', href: withBase('/secretary/chat.html?friend=gemini'), icon: '✦' },
  { key: 'quickChatActionGroup', href: withBase('/secretary/group.html'), icon: '👥' },
];

export default function PortalQuickChat() {
  const [open, setOpen] = useState(false);
  const startY = useRef(0);
  const locale: PortalLocale = loadProfileSettings().locale;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={'portal-quick-chat' + (open ? ' portal-quick-chat--open' : '')}>
      <div
        className="portal-quick-chat-panel"
        role="region"
        aria-label={t(locale, 'quickChatLabel')}
        aria-hidden={!open}
      >
        <button
          type="button"
          className="portal-quick-chat-handle"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? t(locale, 'quickChatToggleExpanded') : t(locale, 'quickChatToggle')}
        />
        <p className="portal-quick-chat-title">{t(locale, 'quickChatTitle')}</p>
        <div className="portal-quick-chat-actions">
          {QUICK_LINKS.map((link) => (
            <a
              key={link.key}
              className="portal-quick-chat-action"
              href={link.href}
              onClick={() => setOpen(false)}
            >
              <span aria-hidden>{link.icon}</span>
              <span>{t(locale, link.key)}</span>
            </a>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="portal-quick-chat-fab"
        aria-label={t(locale, 'quickChatOpenGesture')}
        onClick={() => setOpen((v) => !v)}
        onTouchStart={(e) => {
          startY.current = e.touches[0].clientY;
        }}
        onTouchEnd={(e) => {
          const dy = startY.current - e.changedTouches[0].clientY;
          if (dy > 48) setOpen(true);
          else if (dy < -48) setOpen(false);
        }}
      >
        💬
      </button>
    </div>
  );
}
