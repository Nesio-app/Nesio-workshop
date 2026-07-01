'use client';

/**
 * NesioChatSheet — 宝盒多功能面板
 * Opened by tapping the center Nesio button.
 * Three tabs: 💬 聊天 / 🔍 搜索 / 📷 识别
 */

import { useEffect, useRef, useState } from 'react';
import { addLifeNode, searchLifeGraphFuzzy, type LifeNode } from '@/lib/portal/life-graph';
import { smartSearch, type SearchUnderstood } from '@/lib/portal/smart-search';
interface ChatMessage { role: 'user' | 'model'; text: string; }

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'chat' | 'search' | 'camera';

interface UiMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  sources?: Array<{ title: string; url: string }>;
  savedToMemory?: boolean;
}

const CHAT_HISTORY_KEY = 'nesio-chat-history-v1';
const MAX_STORED_MESSAGES = 60;

function loadHistory(): UiMessage[] {
  try {
    return JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) ?? '[]') as UiMessage[];
  } catch { return []; }
}

function saveHistory(msgs: UiMessage[]) {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(msgs.slice(-MAX_STORED_MESSAGES)));
  } catch { /* ignore */ }
}

// ─── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab({ canUsePrivateData }: { canUsePrivateData: boolean }) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<{ stop(): void } | null>(null);

  useEffect(() => { setMessages(loadHistory()); }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || sending) return;
    const userMsg: UiMessage = { id: `u-${Date.now()}`, role: 'user', text: text.trim() };
    const nextMsgs = [...messages, userMsg];
    setMessages(nextMsgs);
    setInput('');
    setSending(true);

    // Build history for API (exclude non-model messages, cap at 10 turns)
    const history: ChatMessage[] = nextMsgs
      .slice(-21, -1)
      .filter((m) => m.role === 'user' || m.role === 'model')
      .map((m) => ({ role: m.role as 'user' | 'model', text: m.text }));

    try {
      const res = await fetch('/api/portal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim(), history }),
      });
      const data = await res.json() as { ok?: boolean; response?: string; sources?: Array<{ title: string; url: string }> };
      const aiMsg: UiMessage = {
        id: `a-${Date.now()}`,
        role: 'model',
        text: data.response ?? '出了点问题，稍后再试。',
        sources: data.sources ?? [],
      };
      const withAi = [...nextMsgs, aiMsg];
      setMessages(withAi);
      saveHistory(withAi);
    } catch {
      const errMsg: UiMessage = { id: `e-${Date.now()}`, role: 'model', text: '网络错误，请重试。' };
      setMessages((prev) => [...prev, errMsg]);
    }
    setSending(false);
  }

  function handleSaveToMemory(msg: UiMessage) {
    addLifeNode({
      name: msg.text.slice(0, 60),
      type: 'event',
      source: 'manual',
      confidence: 0.9,
      tags: ['宝盒对话'],
      attributes: { fullText: msg.text, savedFromChat: true },
      relations: [],
      rawInput: msg.text,
    });
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, savedToMemory: true } : m)),
    );
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  }

  function startVoice() {
    type SpeechRecognitionCtor = new () => { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void; };
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang = 'zh-CN'; r.interimResults = true; r.continuous = false;
    r.onresult = (e) => {
      const transcript = Array.from(e.results).map((res) => res[0].transcript).join('');
      setInput(transcript);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
    recognitionRef.current = r;
    setListening(true);
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(input); }
  }

  function clearHistory() {
    setMessages([]);
    saveHistory([]);
  }

  return (
    <div className="nesio-chat-tab">
      {/* Message list */}
      <div className="nesio-chat-messages" ref={listRef}>
        {messages.length === 0 ? (
          <div className="nesio-chat-empty">
            <p className="nesio-chat-empty-icon">✦</p>
            <p className="nesio-chat-empty-title">问我任何事</p>
            <p className="nesio-chat-empty-hint">可以查找你的记录，也可以问外部的事情</p>
            <div className="nesio-chat-suggestions">
              {['我的护照放在哪里', '帮我总结一下这周做了什么', '推荐一本适合我的书'].map((s) => (
                <button key={s} type="button" className="nesio-chat-suggestion" onClick={() => void sendMessage(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div key={msg.id} className={`nesio-chat-msg nesio-chat-msg--${msg.role}`}>
                {msg.role === 'model' && <span className="nesio-chat-msg-avatar">✦</span>}
                <div className="nesio-chat-msg-bubble">
                  <p className="nesio-chat-msg-text">{msg.text}</p>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="nesio-chat-sources">
                      {msg.sources.map((s) => (
                        <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="nesio-chat-source-chip">
                          🔗 {s.title || s.url.replace(/^https?:\/\//, '').split('/')[0]}
                        </a>
                      ))}
                    </div>
                  )}
                  {msg.role === 'model' && (
                    <button
                      type="button"
                      className={`nesio-chat-save-btn${msg.savedToMemory ? ' nesio-chat-save-btn--saved' : ''}`}
                      onClick={() => handleSaveToMemory(msg)}
                      disabled={msg.savedToMemory}
                    >
                      {msg.savedToMemory ? '✓ 已存入记忆' : '＋ 存入记忆'}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="nesio-chat-msg nesio-chat-msg--model">
                <span className="nesio-chat-msg-avatar">✦</span>
                <div className="nesio-chat-msg-bubble nesio-chat-msg-bubble--thinking">
                  <span /><span /><span />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Input row */}
      <div className="nesio-chat-input-row">
        <button
          type="button"
          className={`nesio-chat-mic-btn${listening ? ' nesio-chat-mic-btn--active' : ''}`}
          onPointerDown={startVoice}
          onPointerUp={() => { stopVoice(); if (input.trim()) void sendMessage(input); }}
          onPointerCancel={stopVoice}
          aria-label={listening ? '松开发送' : '按住说话'}
        >
          {listening ? '🔴' : '🎙'}
        </button>
        <textarea
          ref={inputRef}
          className="nesio-chat-input"
          placeholder="问宝盒…"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button
          type="button"
          className="nesio-chat-send-btn"
          onClick={() => void sendMessage(input)}
          disabled={!input.trim() || sending}
          aria-label="发送"
        >
          {sending ? <span className="nesio-focus-decompose-spinner" /> : '↑'}
        </button>
      </div>

      {messages.length > 2 && (
        <button type="button" className="nesio-chat-clear-btn" onClick={clearHistory}>新对话</button>
      )}
    </div>
  );
}

// ─── Search Tab ───────────────────────────────────────────────────────────────

function SearchResultDetail({ node, onClose }: { node: LifeNode; onClose: () => void }) {
  const attrs = Object.entries(node.attributes)
    .filter(([k, v]) => v !== null && !['subtasksJson', 'context', 'done', 'doneAt'].includes(k));
  return (
    <div className="nesio-chat-detail">
      <button type="button" className="nesio-chat-detail-back" onClick={onClose}>← 返回</button>
      <h3 className="nesio-chat-detail-title">{node.name}</h3>
      <p className="nesio-chat-detail-meta">{node.type} · {new Date(node.createdAt).toLocaleDateString('zh-CN')}</p>
      {node.rawInput && <p className="nesio-chat-detail-raw">{node.rawInput}</p>}
      {attrs.length > 0 && (
        <ul className="nesio-chat-detail-attrs">
          {attrs.map(([k, v]) => (
            <li key={k}><span className="nesio-chat-detail-key">{k}</span><span className="nesio-chat-detail-val">{String(v)}</span></li>
          ))}
        </ul>
      )}
      {node.tags && node.tags.length > 0 && (
        <div className="nesio-chat-detail-tags">
          {node.tags.map((t) => <span key={t} className="nesio-focus-card-hint">{t}</span>)}
        </div>
      )}
    </div>
  );
}

function SearchTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LifeNode[]>([]);
  const [understood, setUnderstood] = useState<SearchUnderstood | null>(null);
  const [selected, setSelected] = useState<LifeNode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setUnderstood(null); return; }
    const { nodes: sr, understood: u } = smartSearch(query.trim(), null);
    setResults(sr.slice(0, 12));
    setUnderstood(u);
  }, [query]);

  if (selected) return <SearchResultDetail node={selected} onClose={() => setSelected(null)} />;

  const TYPE_ICON: Record<string, string> = {
    person: '👤', place: '📍', object: '📦', event: '📅',
    commitment: '✓', health_state: '❤️', note: '📝',
  };

  return (
    <div className="nesio-chat-search-tab">
      <div className="nesio-chat-search-bar">
        <input
          ref={inputRef}
          className="nesio-chat-search-input"
          type="text"
          placeholder="搜索你的记忆…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {query && <button type="button" className="nesio-chat-search-clear" onClick={() => setQuery('')}>✕</button>}
      </div>

      {understood && (query.trim()) && (
        <div className="nesio-search-understood-row">
          {understood.people.map((p) => <span key={p} className="nesio-search-chip nesio-search-chip--person">👤 {p}</span>)}
          {understood.places.map((p) => <span key={p} className="nesio-search-chip nesio-search-chip--place">📍 {p}</span>)}
          {understood.objects.map((o) => <span key={o} className="nesio-search-chip nesio-search-chip--object">📦 {o}</span>)}
          {understood.domain && <span className="nesio-search-chip nesio-search-chip--domain">{understood.domain}</span>}
        </div>
      )}

      <div className="nesio-chat-search-results">
        {!query.trim() ? (
          <p className="nesio-chat-search-hint">输入任何词、人名、地点、物品…</p>
        ) : results.length === 0 ? (
          <p className="nesio-chat-search-hint">没有找到相关记录</p>
        ) : (
          results.map((node) => (
            <button
              key={node.id}
              type="button"
              className="nesio-chat-result-card"
              onClick={() => setSelected(node)}
            >
              <span className="nesio-chat-result-icon">{TYPE_ICON[node.type] ?? '📌'}</span>
              <div className="nesio-chat-result-body">
                <p className="nesio-chat-result-name">{node.name}</p>
                <p className="nesio-chat-result-meta">
                  {node.type} · {new Date(node.createdAt).toLocaleDateString('zh-CN')}
                  {node.rawInput && ` · ${node.rawInput.slice(0, 30)}`}
                </p>
              </div>
              <span className="nesio-chat-result-arrow">›</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Camera / Identify Tab ────────────────────────────────────────────────────

function CameraTab() {
  const [photo, setPhoto] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [identified, setIdentified] = useState<string[]>([]);
  const [matches, setMatches] = useState<LifeNode[]>([]);
  const [selected, setSelected] = useState<LifeNode | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  useEffect(() => () => { cameraStream?.getTracks().forEach((t) => t.stop()); }, [cameraStream]);

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setCameraStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch { fileRef.current?.click(); }
  }

  async function captureFrame() {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    cameraStream?.getTracks().forEach((t) => t.stop());
    setCameraStream(null);
    await analyzeImage(dataUrl);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => { await analyzeImage(ev.target?.result as string); };
    reader.readAsDataURL(file);
  }

  async function analyzeImage(dataUrl: string) {
    setPhoto(dataUrl);
    setAnalyzing(true);
    setIdentified([]);
    setMatches([]);
    try {
      const res = await fetch('/api/portal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, mode: 'identify' }),
      });
      const data = await res.json() as { ok?: boolean; objects?: string[]; labels?: string[]; summary?: string };
      const items = data.objects ?? data.labels ?? [];
      setIdentified(items);
      // Search memory for each identified item
      const found = new Map<string, LifeNode>();
      for (const item of items) {
        const nodes = searchLifeGraphFuzzy(item, 3);
        for (const n of nodes) found.set(n.id, n);
      }
      setMatches(Array.from(found.values()).slice(0, 8));
    } catch { /* ignore */ }
    setAnalyzing(false);
  }

  if (selected) return <SearchResultDetail node={selected} onClose={() => setSelected(null)} />;

  if (cameraStream) {
    return (
      <div className="nesio-chat-camera-live">
        <video ref={videoRef} autoPlay playsInline className="nesio-chat-camera-video" />
        <button type="button" className="nesio-chat-camera-shutter" onClick={captureFrame} aria-label="拍照">
          <span className="nesio-chat-camera-shutter-ring" />
        </button>
      </div>
    );
  }

  const TYPE_ICON: Record<string, string> = {
    person: '👤', place: '📍', object: '📦', event: '📅',
    commitment: '✓', health_state: '❤️', note: '📝',
  };

  return (
    <div className="nesio-chat-camera-tab">
      {!photo ? (
        <div className="nesio-chat-camera-entry">
          <p className="nesio-chat-camera-hint">拍一张照片，Nesio 会识别内容并在记忆库里找相关记录</p>
          <div className="nesio-chat-camera-actions">
            <button type="button" className="nesio-chat-camera-btn" onClick={openCamera}>
              📷 打开摄像头
            </button>
            <button type="button" className="nesio-chat-camera-btn nesio-chat-camera-btn--alt" onClick={() => fileRef.current?.click()}>
              🖼 选择图片
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="nesio-hidden" onChange={handleFile} />
        </div>
      ) : (
        <div className="nesio-chat-camera-result">
          <div className="nesio-chat-camera-preview-row">
            <img src={photo} alt="识别图片" className="nesio-chat-camera-preview" />
            <button type="button" className="nesio-chat-camera-retake" onClick={() => { setPhoto(null); setIdentified([]); setMatches([]); }}>
              重拍
            </button>
          </div>

          {analyzing && <p className="nesio-chat-camera-status">✦ 识别中…</p>}

          {identified.length > 0 && (
            <div className="nesio-chat-camera-identified">
              <p className="nesio-insights-section-label">识别到</p>
              <div className="nesio-chat-identified-tags">
                {identified.map((item) => <span key={item} className="nesio-focus-card-hint">{item}</span>)}
              </div>
            </div>
          )}

          {matches.length > 0 && (
            <div className="nesio-chat-camera-matches">
              <p className="nesio-insights-section-label">记忆库中找到</p>
              {matches.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className="nesio-chat-result-card"
                  onClick={() => setSelected(node)}
                >
                  <span className="nesio-chat-result-icon">{TYPE_ICON[node.type] ?? '📌'}</span>
                  <div className="nesio-chat-result-body">
                    <p className="nesio-chat-result-name">{node.name}</p>
                    <p className="nesio-chat-result-meta">{node.type} · {new Date(node.createdAt).toLocaleDateString('zh-CN')}</p>
                  </div>
                  <span className="nesio-chat-result-arrow">›</span>
                </button>
              ))}
            </div>
          )}

          {!analyzing && identified.length === 0 && (
            <p className="nesio-chat-camera-status">识别暂无结果，换张图片试试</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Sheet ───────────────────────────────────────────────────────────────

const TABS: Array<{ id: Tab; icon: string; label: string }> = [
  { id: 'chat', icon: '💬', label: '聊天' },
  { id: 'search', icon: '🔍', label: '搜索' },
  { id: 'camera', icon: '📷', label: '识别' },
];

export default function NesioChatSheet({
  open,
  onClose,
  canUsePrivateData = false,
  defaultTab = 'chat',
}: {
  open: boolean;
  onClose: () => void;
  canUsePrivateData?: boolean;
  defaultTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(defaultTab);

  useEffect(() => { if (open) setTab(defaultTab); }, [open, defaultTab]);

  if (!open) return null;

  return (
    <div className="nesio-chat-sheet-overlay" role="dialog" aria-modal="true" aria-label="宝盒">
      <button type="button" className="nesio-chat-sheet-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-chat-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />

        {/* Header */}
        <div className="nesio-chat-sheet-header">
          <span className="nesio-chat-sheet-title">✦ 宝盒</span>
          <button type="button" className="nesio-insights-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {/* Tab bar */}
        <div className="nesio-chat-tab-bar">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`nesio-chat-tab-btn${tab === t.id ? ' nesio-chat-tab-btn--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="nesio-chat-sheet-body">
          {tab === 'chat' && <ChatTab canUsePrivateData={canUsePrivateData} />}
          {tab === 'search' && <SearchTab />}
          {tab === 'camera' && <CameraTab />}
        </div>
      </div>
    </div>
  );
}
