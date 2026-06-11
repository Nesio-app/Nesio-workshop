'use client';

import { useEffect, useRef, useState } from 'react';
import { t } from '@/lib/portal/i18n';
import { loadProfileSettings } from '@/lib/portal/profile';

interface NotePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PendingImage {
  preview: string;
  file: File;
}

function isMobileFlomo(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function tryFlomoScheme(content: string, imageUrls: string[]) {
  if (!isMobileFlomo()) return false;
  const params = new URLSearchParams();
  if (content) params.set('content', content);
  if (imageUrls.length) {
    params.set('image_urls', JSON.stringify(imageUrls.slice(0, 9)));
  }
  const href = `flomo://create?${params.toString()}`;
  window.location.href = href;
  return true;
}

export default function NotePanel({ open, onOpenChange }: NotePanelProps) {
  const locale = loadProfileSettings().locale;
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'err'>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStatus('idle');
      setStatusMsg('');
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  const insertAtCursor = (before: string, after = '') => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next =
      draft.slice(0, start) + before + draft.slice(start, end) + after + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + before.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const onPickImages = (files: FileList | null) => {
    if (!files?.length) return;
    const next: PendingImage[] = [...images];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 4 * 1024 * 1024) {
        setStatus('err');
        setStatusMsg(t(locale, 'flomoImageTooLarge'));
        continue;
      }
      if (next.length >= 9) break;
      next.push({ file, preview: URL.createObjectURL(file) });
    }
    setImages(next);
  };

  const removeImage = (idx: number) => {
    setImages((prev) => {
      const copy = [...prev];
      const [removed] = copy.splice(idx, 1);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return copy;
    });
  };

  const uploadImages = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (const img of images) {
      const form = new FormData();
      form.append('file', img.file);
      const res = await fetch('/api/portal/flomo/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) urls.push(String(data.url));
    }
    return urls;
  };

  const onSend = async () => {
    const text = draft.trim();
    if (!text && images.length === 0) {
      setStatus('err');
      setStatusMsg(t(locale, 'flomoNeedContent'));
      return;
    }

    setSending(true);
    setStatus('idle');
    setStatusMsg(t(locale, 'flomoSending'));

    try {
      let imageUrls: string[] = [];
      if (images.length) {
        imageUrls = await uploadImages();
      }

      if (imageUrls.length && tryFlomoScheme(text, imageUrls)) {
        setDraft('');
        setImages((prev) => {
          prev.forEach((p) => URL.revokeObjectURL(p.preview));
          return [];
        });
        setStatus('ok');
        setStatusMsg(t(locale, 'flomoSent'));
        window.setTimeout(() => onOpenChange(false), 600);
        return;
      }

      let content = text;
      if (imageUrls.length) {
        const links = imageUrls.map((u) => u).join('\n');
        content = content ? `${content}\n\n${links}` : links;
      }

      const res = await fetch('/api/portal/flomo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'send failed');
      }

      setDraft('');
      setImages((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.preview));
        return [];
      });
      setStatus('ok');
      setStatusMsg(t(locale, 'flomoSent'));
      window.setTimeout(() => onOpenChange(false), 700);
    } catch {
      setStatus('err');
      setStatusMsg(t(locale, 'flomoFailed'));
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  const canSend = (draft.trim().length > 0 || images.length > 0) && !sending;

  return (
    <div className="flomo-overlay" role="presentation" onClick={() => onOpenChange(false)}>
      <div
        className="flomo-sheet"
        role="dialog"
        aria-label="Flomo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flomo-handle" aria-hidden>
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>

        <textarea
          ref={textareaRef}
          className="flomo-input"
          placeholder={t(locale, 'flomoPlaceholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          maxLength={5000}
        />

        {images.length > 0 ? (
          <div className="flomo-previews">
            {images.map((img, i) => (
              <div key={img.preview} className="flomo-preview">
                <img src={img.preview} alt="" />
                <button type="button" onClick={() => removeImage(i)} aria-label={t(locale, 'flomoClose')}>
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {statusMsg ? (
          <p className={'flomo-status' + (status === 'err' ? ' flomo-status--err' : '')} role="status">
            {statusMsg}
          </p>
        ) : null}

        <footer className="flomo-toolbar">
          <button
            type="button"
            className="flomo-tool"
            onClick={() => insertAtCursor('#')}
            title={t(locale, 'flomoTag')}
            aria-label={t(locale, 'flomoTag')}
          >
            #
          </button>
          <button
            type="button"
            className="flomo-tool"
            onClick={() => imageRef.current?.click()}
            title={t(locale, 'flomoImage')}
            aria-label={t(locale, 'flomoImage')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="8.5" cy="10" r="1.5" fill="currentColor" />
              <path d="M5 17l5-5 4 4 3-3 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="flomo-toolbar-divider" aria-hidden />
          <button
            type="button"
            className="flomo-tool"
            onClick={() => insertAtCursor('**', '**')}
            title={t(locale, 'flomoBold')}
            aria-label={t(locale, 'flomoBold')}
          >
            B
          </button>
          <button
            type="button"
            className="flomo-tool"
            onClick={() => insertAtCursor('\n- ')}
            title={t(locale, 'flomoList')}
            aria-label={t(locale, 'flomoList')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="flomo-tool flomo-tool--mic"
            onClick={() => {
              const w = window as Window & {
                SpeechRecognition?: new () => {
                  lang: string;
                  start: () => void;
                  onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
                };
                webkitSpeechRecognition?: new () => {
                  lang: string;
                  start: () => void;
                  onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
                };
              };
              const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
              if (!SR) return;
              const rec = new SR();
              rec.lang = locale === 'en' ? 'en-US' : 'zh-CN';
              rec.onresult = (ev) => {
                const chunk = ev.results[0]?.[0]?.transcript;
                if (chunk) setDraft((d) => (d ? `${d} ${chunk}` : chunk));
              };
              rec.start();
            }}
            title={t(locale, 'flomoVoice')}
            aria-label={t(locale, 'flomoVoice')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.6" />
              <path d="M5 11a7 7 0 0014 0M12 18v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>

          <button
            type="button"
            className={'flomo-send' + (canSend ? ' flomo-send--on' : '')}
            disabled={!canSend}
            onClick={onSend}
            aria-label={t(locale, 'flomoSend')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 12l16-7-4 7 4 7-16-7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </button>
        </footer>

        <input
          ref={imageRef}
          type="file"
          accept="image/*"
          multiple
          className="portal-avatar-file"
          onChange={(e) => {
            onPickImages(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
