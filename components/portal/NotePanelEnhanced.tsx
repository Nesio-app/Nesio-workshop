'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FLOMO_DEMO_MEMOS } from '@/lib/portal/flomo-demo';
import { t } from '@/lib/portal/i18n';
import { apiUrl } from '@/lib/portal/paths';
import { loadProfileSettings } from '@/lib/portal/profile';

interface FlomoMemo {
  slug: string;
  content: string;
  created_at: string;
  updated_at: string;
  tags: string[];
}

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

function extractTags(content: string): string[] {
  const tagMatches = content.match(/#[\w\u4e00-\u9fff]+/g) || [];
  return Array.from(new Set(tagMatches));
}

function formatFlomoReadError(error: string): string {
  if (/登录|login|token|签名/i.test(error)) {
    return '请先在 Vercel 配置有效的 FLOMO_API_TOKEN（flomo 设置 → MCP 个人 Token）';
  }
  return error;
}

function formatMemoDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;

  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotePanelEnhanced({ open, onOpenChange }: NotePanelProps) {
  const locale = loadProfileSettings().locale;
  const [memos, setMemos] = useState<FlomoMemo[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [readConfigured, setReadConfigured] = useState(false);
  const [writeConfigured, setWriteConfigured] = useState(false);
  const [usingDemo, setUsingDemo] = useState(false);
  const [loadingMemos, setLoadingMemos] = useState(false);
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'err'>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [readError, setReadError] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const tagIndex = useMemo(() => {
    const counts = new Map<string, number>();
    for (const memo of memos) {
      for (const tag of memo.tags) {
        const key = tag.startsWith('#') ? tag : `#${tag}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [memos]);

  const filteredMemos = useMemo(() => {
    if (!activeTag) return memos;
    return memos.filter((m) =>
      m.tags.some((t) => (t.startsWith('#') ? t : `#${t}`) === activeTag),
    );
  }, [memos, activeTag]);

  const loadMemos = useCallback(async () => {
    setLoadingMemos(true);
    try {
      const res = await fetch(apiUrl('/api/portal/flomo?limit=50'), { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      const writeOk = Boolean(data.writeConfigured ?? data.configured);
      const readOk = Boolean(data.readConfigured);
      setWriteConfigured(writeOk);
      setReadConfigured(readOk);
      setConfigured(writeOk || readOk);
      const live = data.ok && Array.isArray(data.memos) ? data.memos : [];
      if (live.length > 0) {
        setMemos(live);
        setUsingDemo(false);
        setReadError('');
      } else if (data.error) {
        setMemos(readOk || writeOk ? [] : FLOMO_DEMO_MEMOS);
        setUsingDemo(!readOk && !writeOk);
        setReadError(formatFlomoReadError(String(data.error)));
      } else {
        setMemos(FLOMO_DEMO_MEMOS);
        setUsingDemo(true);
        setReadError('');
      }
    } catch {
      setConfigured(false);
      setReadConfigured(false);
      setWriteConfigured(false);
      setMemos(FLOMO_DEMO_MEMOS);
      setUsingDemo(true);
      setReadError('');
    } finally {
      setLoadingMemos(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setStatus('idle');
      setStatusMsg('');
      setReadError('');
      setDraft('');
      setImages([]);
      setActiveTag(null);
      void loadMemos();
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open, loadMemos]);

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
      const res = await fetch(apiUrl('/api/portal/flomo/upload'), { method: 'POST', body: form });
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
        await loadMemos();
        return;
      }

      let content = text;
      if (imageUrls.length) {
        const links = imageUrls.join('\n');
        content = content ? `${content}\n\n${links}` : links;
      }

      const res = await fetch(apiUrl('/api/portal/flomo'), {
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
      await loadMemos();
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
        className="flomo-app"
        role="dialog"
        aria-label="flomo"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flomo-app-header">
          <button
            type="button"
            className="flomo-app-close"
            onClick={() => onOpenChange(false)}
            aria-label={t(locale, 'flomoClose')}
          >
            ×
          </button>
          <h2 className="flomo-app-title">flomo</h2>
          <span className="flomo-app-header-spacer" aria-hidden />
        </header>

        <div className="flomo-app-body">
          <aside className="flomo-sidebar" aria-label="标签">
            <button
              type="button"
              className={'flomo-sidebar-item' + (activeTag === null ? ' flomo-sidebar-item--on' : '')}
              onClick={() => setActiveTag(null)}
            >
              <span className="flomo-sidebar-label">全部</span>
              <span className="flomo-sidebar-count">{memos.length}</span>
            </button>
            {tagIndex.map(([tag, count]) => (
              <button
                key={tag}
                type="button"
                className={'flomo-sidebar-item' + (activeTag === tag ? ' flomo-sidebar-item--on' : '')}
                onClick={() => setActiveTag(tag)}
              >
                <span className="flomo-sidebar-label">{tag}</span>
                <span className="flomo-sidebar-count">{count}</span>
              </button>
            ))}
          </aside>

          <div className="flomo-main">
            {readError || usingDemo || (!readConfigured && writeConfigured) ? (
              <p className="flomo-app-banner">
                {readError
                  ? `读取失败：${readError}`
                  : configured === false
                    ? '发送：配置 FLOMO_WEBHOOK_URL；读取：配置 FLOMO_API_TOKEN（flomo MCP 个人 Token）'
                    : !readConfigured && writeConfigured
                      ? '已可发送；读取历史请在 Vercel 配置 FLOMO_API_TOKEN'
                      : '暂无笔记，当前为演示数据'}
              </p>
            ) : null}

            <div className="flomo-timeline">
              {loadingMemos ? (
                <p className="flomo-timeline-empty">加载中…</p>
              ) : filteredMemos.length === 0 ? (
                <p className="flomo-timeline-empty">
                  {activeTag ? '该标签下暂无 memo' : '还没有 memo，写一条吧'}
                </p>
              ) : (
                filteredMemos.map((memo) => (
                  <article key={memo.slug} className="flomo-memo-card">
                    <time className="flomo-memo-time" dateTime={memo.created_at}>
                      {formatMemoDate(memo.created_at || memo.updated_at)}
                    </time>
                    <p className="flomo-memo-content">{memo.content}</p>
                    {memo.tags.length > 0 ? (
                      <div className="flomo-memo-tags">
                        {memo.tags.map((tag) => {
                          const label = tag.startsWith('#') ? tag : `#${tag}`;
                          return (
                            <button
                              key={`${memo.slug}-${tag}`}
                              type="button"
                              className="flomo-memo-tag"
                              onClick={() => setActiveTag(label)}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>

            <div className="flomo-compose">
          <textarea
            ref={textareaRef}
            className="flomo-input"
            placeholder={t(locale, 'flomoPlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={5000}
          />

          {images.length > 0 ? (
            <div className="flomo-previews">
              {images.map((img, i) => (
                <div key={img.preview} className="flomo-preview">
                  <img src={img.preview} alt="" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label={t(locale, 'flomoClose')}
                  >
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
                <path d="M5 11a7 7 0 0114 0M12 18v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              className={'flomo-send flomo-send--flomo' + (canSend ? ' flomo-send--on' : '')}
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
        </div>
      </div>
    </div>
  );
}
