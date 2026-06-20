'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FLOMO_DEMO_MEMOS } from '@/lib/portal/flomo-demo';
import { t } from '@/lib/portal/i18n';
import { apiUrl } from '@/lib/portal/paths';
import { loadProfileSettings } from '@/lib/portal/profile';
import {
  createAppApiClient,
  type ProductionRuntimeProviderAction,
} from '@/lib/portal/app-api-client';

const FLOMO_MEMO_LIMIT = 48;
const MEMO_COLLAPSE_CHARS = 180;

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

function formatFlomoReadError(error: string): string {
  if (/Local Storage|access_token|FLOMO_API_KEY|Webhook/i.test(error)) return error;
  if (/登录|login|过期|无效/i.test(error)) {
    return t(loadProfileSettings().locale, 'notePanelReadFailPrefix', {
      msg: t(loadProfileSettings().locale, 'notePanelTokenExpired'),
    });
  }
  return error;
}

function formatMemoDate(iso: string): string {
  const date = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hours}:${minutes} | API`;
}

function MemoCard({ memo, onTagClick }: { memo: FlomoMemo; onTagClick: (tag: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const content = memo.content.trim();
  const needsExpand = content.length > MEMO_COLLAPSE_CHARS;
  const shown = needsExpand && !expanded ? `${content.slice(0, MEMO_COLLAPSE_CHARS).trim()}…` : content;

  return (
    <article className="flomo-memo-card">
      <header className="flomo-memo-head">
        <time className="flomo-memo-time" dateTime={memo.created_at}>
          {formatMemoDate(memo.created_at || memo.updated_at)}
        </time>
        <button type="button" className="flomo-memo-menu" aria-label={t(loadProfileSettings().locale, 'flomoMenuMore')} tabIndex={-1}>
          ···
        </button>
      </header>
      <p className="flomo-memo-content">{shown}</p>
      {needsExpand && !expanded ? (
        <button type="button" className="flomo-memo-expand" onClick={() => setExpanded(true)}>
          {t(loadProfileSettings().locale, 'flomoExpand')}
        </button>
      ) : null}
      {memo.tags.length > 0 ? (
        <div className="flomo-memo-tags">
          {memo.tags.map((tag) => {
            const label = tag.startsWith('#') ? tag : `#${tag}`;
            return (
              <button
                key={`${memo.slug}-${tag}`}
                type="button"
                className="flomo-memo-tag"
                onClick={() => onTagClick(label)}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [flomoProviderAction, setFlomoProviderAction] =
    useState<ProductionRuntimeProviderAction | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const displayMemos = useMemo(() => memos.slice(0, FLOMO_MEMO_LIMIT), [memos]);

  const tagIndex = useMemo(() => {
    const counts = new Map<string, number>();
    for (const memo of displayMemos) {
      for (const tag of memo.tags) {
        const key = tag.startsWith('#') ? tag : `#${tag}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [displayMemos]);

  const filteredMemos = useMemo(() => {
    let list = displayMemos;
    if (activeTag) {
      list = list.filter((m) =>
        m.tags.some((t) => (t.startsWith('#') ? t : `#${t}`) === activeTag),
      );
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((m) => m.content.toLowerCase().includes(q));
    }
    return list;
  }, [displayMemos, activeTag, searchQuery]);

  const loadMemos = useCallback(async () => {
    setLoadingMemos(true);
    try {
      const res = await fetch(apiUrl(`/api/portal/flomo?limit=${FLOMO_MEMO_LIMIT}`), {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      const writeOk = Boolean(data.writeConfigured ?? data.configured);
      const readOk = Boolean(data.readConfigured);
      setWriteConfigured(writeOk);
      setReadConfigured(readOk);
      setConfigured(writeOk || readOk);
      const live = data.ok && Array.isArray(data.memos) ? data.memos : [];
      if (live.length > 0) {
        setMemos(live.slice(0, FLOMO_MEMO_LIMIT));
        setUsingDemo(false);
        setReadError('');
      } else if (data.error) {
        setMemos(readOk || writeOk ? [] : FLOMO_DEMO_MEMOS.slice(0, FLOMO_MEMO_LIMIT));
        setUsingDemo(!readOk && !writeOk);
        setReadError(formatFlomoReadError(String(data.error)));
      } else {
        setMemos(FLOMO_DEMO_MEMOS.slice(0, FLOMO_MEMO_LIMIT));
        setUsingDemo(true);
        setReadError('');
      }
    } catch {
      setConfigured(false);
      setReadConfigured(false);
      setWriteConfigured(false);
      setMemos(FLOMO_DEMO_MEMOS.slice(0, FLOMO_MEMO_LIMIT));
      setUsingDemo(true);
      setReadError('');
    } finally {
      setLoadingMemos(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const client = createAppApiClient();
    client.fetchProductionRuntimeHealth()
      .then((runtime) => {
        if (cancelled) return;
        const provider = runtime.providerActionMatrix.find(
          (provider) => provider.id === 'flomo',
        );
        setFlomoProviderAction(provider ?? null);
      })
      .catch(() => {
        if (!cancelled) setFlomoProviderAction(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setStatus('idle');
      setStatusMsg('');
      setReadError('');
      setDraft('');
      setImages([]);
      setActiveTag(null);
      setSidebarOpen(false);
      setComposeOpen(false);
      setSearchOpen(false);
      setSearchQuery('');
      void loadMemos();
    }
  }, [open, loadMemos]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const openCompose = () => {
    setComposeOpen(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

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

    const flomoRuntimeReady =
      flomoProviderAction?.actionStatus === 'server_ready' &&
      flomoProviderAction?.startEndpoint === '/api/portal/flomo' &&
      flomoProviderAction?.serverOnly === true;

    if (!flomoRuntimeReady) {
      setStatus('err');
      setStatusMsg(t(locale, 'notePanelFlomoNotReady'));
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
      setComposeOpen(false);
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
        aria-label={t(locale, 'flomoTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flomo-app-header">
          <button
            type="button"
            className="flomo-header-btn flomo-sidebar-toggle"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen
              ? t(locale, 'notePanelToggleCollapsed')
              : t(locale, 'notePanelToggleExpanded')}
            aria-expanded={sidebarOpen}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 7h16M4 12h10M4 17h16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <h2 className="flomo-app-title">{t(locale, 'flomoTitle')}</h2>
          <button
            type="button"
            className={'flomo-header-btn flomo-search-toggle' + (searchOpen ? ' flomo-search-toggle--on' : '')}
            onClick={() => setSearchOpen((v) => !v)}
            aria-label={t(locale, 'notePanelSearch')}
            aria-expanded={searchOpen}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {searchOpen ? (
          <div className="flomo-search-bar">
            <input
              type="search"
              className="flomo-search-input"
              placeholder={t(locale, 'notePanelSearchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
        ) : null}

        <div className="flomo-app-body">
          {sidebarOpen ? (
            <button
              type="button"
              className="flomo-sidebar-backdrop"
              aria-label={t(locale, 'notePanelCloseSidebar')}
              onClick={() => setSidebarOpen(false)}
            />
          ) : null}
          <aside
            className={'flomo-sidebar' + (sidebarOpen ? ' flomo-sidebar--open' : '')}
            aria-label={t(locale, 'notePanelTag')}
            aria-hidden={!sidebarOpen}
          >
            <button
              type="button"
              className={
                'flomo-sidebar-all' + (activeTag === null ? ' flomo-sidebar-all--on' : '')
              }
              onClick={() => {
                setActiveTag(null);
                setSidebarOpen(false);
              }}
            >
              {t(locale, 'notePanelTagAll')}
              <span className="flomo-sidebar-all-count">{displayMemos.length}</span>
            </button>
            <p className="flomo-sidebar-section">{t(locale, 'notePanelAllTags')}</p>
            {tagIndex.map(([tag, count]) => (
              <button
                key={tag}
                type="button"
                className={'flomo-sidebar-item' + (activeTag === tag ? ' flomo-sidebar-item--on' : '')}
                onClick={() => {
                  setActiveTag(tag);
                  setSidebarOpen(false);
                }}
              >
                <span className="flomo-sidebar-hash">#</span>
                <span className="flomo-sidebar-label">{tag.replace(/^#/, '')}</span>
                <span className="flomo-sidebar-count">{count}</span>
              </button>
            ))}
          </aside>

          <div className={'flomo-main' + (sidebarOpen ? ' flomo-main--dimmed' : '')}>
            {usingDemo || readError || !readConfigured || configured === false ? (
              <p className="flomo-app-banner">
                {readError
                  ? t(locale, 'notePanelReadFailPrefix', { msg: formatFlomoReadError(readError) })
                    : configured === false
                      ? t(locale, 'notePanelNeedConfig')
                      : !readConfigured && writeConfigured
                        ? t(locale, 'notePanelReadNeedKey')
                        : t(locale, 'notePanelDemoData')}
              </p>
            ) : null}

            <div className="flomo-timeline">
              {loadingMemos ? (
                <div className="flomo-timeline-skeleton" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flomo-memo-card flomo-memo-card--skeleton" />
                  ))}
                </div>
              ) : filteredMemos.length === 0 ? (
                <p className="flomo-timeline-empty">
                  {activeTag || searchQuery ? t(locale, 'notePanelNoMatch') : t(locale, 'notePanelNoMemo')}
                </p>
              ) : (
                filteredMemos.map((memo) => (
                  <MemoCard key={memo.slug} memo={memo} onTagClick={setActiveTag} />
                ))
              )}
            </div>

            {!composeOpen ? (
              <button
                type="button"
                className="flomo-fab"
                onClick={openCompose}
                aria-label={t(locale, 'flomoPlaceholder')}
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            ) : (
              <div className="flomo-compose flomo-compose--sheet">
                <div className="flomo-compose-card">
                  <textarea
                    ref={textareaRef}
                    className="flomo-input"
                    placeholder={t(locale, 'flomoPlaceholder')}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={4}
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
                    <p
                      className={'flomo-status' + (status === 'err' ? ' flomo-status--err' : '')}
                      role="status"
                    >
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
                        <path
                          d="M5 17l5-5 4 4 3-3 4 4"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <span className="flomo-toolbar-divider" aria-hidden />
                    <button
                      type="button"
                      className="flomo-tool flomo-tool--bold"
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
                        <path
                          d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="flomo-tool"
                      onClick={() => {
                        const w = window as Window & {
                          SpeechRecognition?: new () => {
                            lang: string;
                            start: () => void;
                            onresult:
                              | ((ev: {
                                  results: { [i: number]: { [j: number]: { transcript: string } } };
                                }) => void)
                              | null;
                          };
                          webkitSpeechRecognition?: new () => {
                            lang: string;
                            start: () => void;
                            onresult:
                              | ((ev: {
                                  results: { [i: number]: { [j: number]: { transcript: string } } };
                                }) => void)
                              | null;
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
                        <path
                          d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 16.5-12.5z"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>

                    <button
                      type="button"
                      className="flomo-compose-dismiss"
                      onClick={() => setComposeOpen(false)}
                      aria-label={t(locale, 'notePanelCollapse')}
                    >
                      {t(locale, 'notePanelCollapse')}
                    </button>

                    <button
                      type="button"
                      className={'flomo-send' + (canSend ? ' flomo-send--on' : '')}
                      disabled={sending}
                      onClick={onSend}
                      aria-label={t(locale, 'flomoSend')}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M4 12l16-7-4 7 4 7-16-7z"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </footer>
                </div>

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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
