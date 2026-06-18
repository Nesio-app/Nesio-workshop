'use client';

import { useEffect, useRef, useState } from 'react';
import { withBase } from '@/lib/portal/paths';

const QUICK_LINKS = [
  { label: '智友', href: '/secretary', icon: '💬' },
  { label: 'Gemini', href: '/secretary/chat?friend=gemini', icon: '✦' },
  { label: '群聊', href: '/secretary', icon: '👥' },
];

export default function PortalQuickChat() {
  const [open, setOpen] = useState(false);
  const startY = useRef(0);

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
        aria-label="快速聊天"
        aria-hidden={!open}
      >
        <button
          type="button"
          className="portal-quick-chat-handle"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? '收起' : '展开快速聊天'}
        />
        <p className="portal-quick-chat-title">快速聊天</p>
        <div className="portal-quick-chat-actions">
          {QUICK_LINKS.map((link) => (
            <a
              key={link.label}
              className="portal-quick-chat-action"
              href={withBase(link.href)}
              onClick={() => setOpen(false)}
            >
              <span aria-hidden>{link.icon}</span>
              <span>{link.label}</span>
            </a>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="portal-quick-chat-fab"
        aria-label="上滑打开聊天"
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
