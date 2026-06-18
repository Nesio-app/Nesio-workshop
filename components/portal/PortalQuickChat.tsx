'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import type { PortalLocale } from '@/lib/portal/profile';
import { t } from '@/lib/portal/i18n';

type ChatTurn = { role: 'user' | 'assistant'; content: string };
type Provider = 'gemini' | 'openai' | 'doubao';

type PortalQuickChatProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const PROVIDERS: Array<{ id: Provider; label: string }> = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'openai', label: 'ChatGPT' },
  { id: 'doubao', label: '豆包' },
];

export default function PortalQuickChat({ open: controlledOpen, onOpenChange }: PortalQuickChatProps = {}) {
  const [localOpen, setLocalOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [provider, setProvider] = useState<Provider>('gemini');
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const startY = useRef(0);
  const locale: PortalLocale = loadProfileSettings().locale;
  const open = controlledOpen ?? localOpen;
  const setOpen = useCallback((next: boolean | ((value: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    if (onOpenChange) onOpenChange(value);
    else setLocalOpen(value);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  async function sendMessage() {
    const text = message.trim();
    if (!text || sending) return;
    const nextHistory = [...history, { role: 'user' as const, content: text }];
    setHistory(nextHistory);
    setMessage('');
    setSending(true);
    setStatus('');

    try {
      const response = await fetch('/api/secretary/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-baohe-access-mode': 'personal_lab',
        },
        body: JSON.stringify({
          message: text,
          history,
          model: provider,
          maxTokens: 900,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.hint || data?.detail || data?.error || `HTTP ${response.status}`);
      }
      const answer = String(data?.text || '').trim();
      if (!answer) throw new Error('智友暂时没有返回内容');
      setHistory([...nextHistory, { role: 'assistant' as const, content: answer }].slice(-8));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '智友请求失败');
      setHistory(history);
      setMessage(text);
    } finally {
      setSending(false);
    }
  }

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
        <p className="portal-quick-chat-title">{t(locale, 'quickChatTitle')} · Personal</p>
        <div className="portal-quick-chat-actions">
          {PROVIDERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={'portal-quick-chat-action' + (provider === item.id ? ' portal-quick-chat-action--active' : '')}
              onClick={() => setProvider(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="portal-quick-chat-thread" aria-live="polite">
          {history.slice(-4).map((turn, index) => (
            <p key={`${turn.role}-${index}`} className={`portal-quick-chat-msg portal-quick-chat-msg--${turn.role}`}>
              {turn.content}
            </p>
          ))}
          {status ? <p className="portal-quick-chat-error">{status}</p> : null}
        </div>
        <div className="portal-quick-chat-input-row">
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void sendMessage();
            }}
            placeholder="问智友一句..."
            aria-label="智友输入"
          />
          <button type="button" onClick={() => void sendMessage()} disabled={sending || !message.trim()}>
            {sending ? '...' : '发送'}
          </button>
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
