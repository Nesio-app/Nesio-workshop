'use client';

/**
 * NesioChatSheet — 问一问
 * WeChat-style full-screen chat window.
 * Long-press center button to open.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { addLifeNode, getLifeGraph, searchLifeGraphFuzzy, type LifeNode } from '@/lib/portal/life-graph';
import { loadProfileSettings } from '@/lib/portal/profile';
import { smartSearch } from '@/lib/portal/smart-search';
import { parseTemporalQuery, isInSpan } from '@/lib/portal/temporal-query';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import { loadCalendarFromLocal } from '@/lib/portal/calendar-local-store';
import MemoryFlashBanner, { useMemoryFlash } from '@/components/portal/MemoryFlashBanner';

interface ChatMessage { role: 'user' | 'model'; text: string; }

interface UiMessage {
  id: string;
  role: 'user' | 'model' | 'status';
  text: string;
  sources?: Array<{ title: string; url: string }>;
  savedToMemory?: boolean;
}

// ─── Client-side context builder (3-layer hybrid retrieval) ──────────────────
// Inspired by Chronos (2025) temporal-aware retrieval + IA-RAG interval algebra.
// Runs in the browser where localStorage and sessionStorage are available.
//
// Layer 1 — Temporal/structured retrieval (highest priority):
//   Parse date expressions ("7月9号", "下周", "今天") → filter by attributes.start
// Layer 2 — Text + entity match (smartSearch, already includes temporal boost):
//   BM25-style token matching + entity extraction
// Layer 3 — Temporal baseline (always injected at top):
//   Today + next 7 days events, so AI always has a time horizon
//
// Research: U-shaped context recall curve → important info at HEAD of context.

type CalendarEvent = { id?: string; title?: string; start?: string; end?: string; calendarName?: string };

function fmtEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' });
}

function fmtNode(n: LifeNode): string {
  const startStr = n.attributes.start as string | undefined;
  const dateLabel = startStr
    ? fmtEventDate(startStr)
    : new Date(n.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  return `• [${n.type}] ${n.name} (${dateLabel})`;
}

function buildMemoryContext(query: string): string {
  const graph = getLifeGraph();
  const temporal = parseTemporalQuery(query);

  // Layer 1: date-matched nodes (attributes.start matches the parsed date)
  const dateNodes: LifeNode[] = temporal.hasDate
    ? graph.filter((n) => {
        const s = n.attributes.start as string | undefined;
        return s ? isInSpan(new Date(s), temporal) : false;
      })
    : [];

  // Layer 2: text/entity search — smartSearch already applies temporal boost
  const searchNodes = smartSearch(query, null).nodes.slice(0, 12);

  // Layer 3: upcoming 7-day events (always in context — temporal baseline)
  const now = Date.now();
  const week7 = now + 7 * 86_400_000;
  const upcomingNodes = graph
    .filter((n) => {
      const s = n.attributes.start as string | undefined;
      if (!s) return false;
      const t = new Date(s).getTime();
      return t >= now - 86_400_000 && t <= week7;
    })
    .sort((a, b) =>
      new Date(a.attributes.start as string).getTime() -
      new Date(b.attributes.start as string).getTime(),
    )
    .slice(0, 8);

  // Assemble: date matches HEAD → search results → upcoming → recent
  const seen = new Set<string>();
  const head: LifeNode[] = [];
  const body: LifeNode[] = [];

  for (const n of dateNodes) { if (!seen.has(n.id)) { seen.add(n.id); head.push(n); } }
  for (const n of upcomingNodes) { if (!seen.has(n.id)) { seen.add(n.id); head.push(n); } }
  for (const n of searchNodes) { if (!seen.has(n.id)) { seen.add(n.id); body.push(n); } }
  // Fill remaining slots with recent nodes
  for (const n of graph.slice(0, 10)) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    body.push(n);
    if (body.length >= 12) break;
  }

  const parts: string[] = [`【用户记忆库】共 ${graph.length} 条`];

  if (dateNodes.length > 0) {
    parts.push(`\n【${temporal.label}的日程/事件】（精确命中，优先参考）`);
    parts.push(...dateNodes.map(fmtNode));
  }

  if (upcomingNodes.length > 0 && !temporal.hasDate) {
    parts.push('\n【今天起7天内的安排】');
    parts.push(...upcomingNodes.map(fmtNode));
  }

  if (body.length > 0) {
    parts.push('\n【相关记忆与近期记录】');
    parts.push(...body.slice(0, 12).map(fmtNode));
  }

  return parts.join('\n');
}

function buildCalendarContext(query: string): string {
  // Primary: localStorage (24h TTL). Fallback: sessionStorage (5-min TTL, may be expired).
  let events: CalendarEvent[] = loadCalendarFromLocal() as CalendarEvent[];
  if (events.length === 0) {
    const data = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
    events = data?.events ?? [];
  }
  if (events.length === 0) return '';

  const temporal = parseTemporalQuery(query);

  // Split into date-specific vs general
  const dateEvents: CalendarEvent[] = [];
  const otherEvents: CalendarEvent[] = [];
  for (const ev of events) {
    if (!ev.start) continue;
    if (temporal.hasDate && isInSpan(new Date(ev.start), temporal)) {
      dateEvents.push(ev);
    } else {
      otherEvents.push(ev);
    }
  }

  const fmtEv = (ev: CalendarEvent) => {
    const d = ev.start ? fmtEventDate(ev.start) : '';
    return `• ${ev.title || '未命名'}${d ? ` (${d})` : ''}`;
  };

  const parts: string[] = [`【Google日历】共 ${events.length} 条`];

  if (dateEvents.length > 0) {
    parts.push(`\n【${temporal.label}的日历事件】（精确匹配，优先参考）`);
    parts.push(...dateEvents.map(fmtEv));
  }

  // Always include upcoming 30 events as time horizon
  const now = Date.now();
  const upcoming = otherEvents
    .filter((ev) => ev.start && new Date(ev.start).getTime() >= now - 86_400_000)
    .slice(0, 30);
  if (upcoming.length > 0) {
    parts.push('\n【近期日程】');
    parts.push(...upcoming.map(fmtEv));
  }

  return parts.join('\n');
}

const CHAT_HISTORY_KEY = 'nesio-chat-history-v1';
const MAX_STORED = 60;
const MAX_FILE_CHARS = 60_000; // ~15k tokens, safe for Haiku context

// ─── CSV / File parsing ───────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if ((c === ',' || c === '\t') && !inQ) {
      result.push(cur.trim()); cur = '';
    } else { cur += c; }
  }
  result.push(cur.trim());
  return result;
}

function csvToMarkdown(raw: string): string {
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return raw;
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((l) => parseCSVLine(l));
  const header = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.slice(0, 200).map((r) => `| ${r.join(' | ')} |`); // cap at 200 rows in table
  const extra = rows.length > 200 ? [`\n（共 ${rows.length} 行，显示前 200 行）`] : [];
  return [header, divider, ...body, ...extra].join('\n');
}

function isCsvLike(name: string): boolean {
  return /\.(csv|tsv)$/i.test(name);
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string ?? '');
    reader.onerror = () => reject(new Error('read error'));
    reader.readAsText(file, 'UTF-8');
  });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n\n…（内容过长，已截断至 ${max} 字符）`;
}

function loadHistory(): UiMessage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) ?? '[]') as UiMessage[];
    // Filter out messages with empty text (from earlier bugs)
    return raw.filter((m) => m.text?.trim());
  } catch { return []; }
}
function saveHistory(msgs: UiMessage[]) {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY,
      JSON.stringify(msgs.filter((m) => m.role !== 'status').slice(-MAX_STORED)));
  } catch { /* ignore */ }
}

// ─── SpeechRecognition type ────────────────────────────────────────────────────
type SR = new () => {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start(): void; stop(): void;
};

// ─── Bubble context menu ───────────────────────────────────────────────────────
function BubbleMenu({ msg, onClose, onSave, onCopy }: {
  msg: UiMessage; onClose: () => void; onSave: () => void; onCopy: () => void;
}) {
  return (
    <>
      <button type="button" className="nesio-bubble-menu-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-bubble-menu">
        <button type="button" className="nesio-bubble-menu-item" onClick={() => { onCopy(); onClose(); }}>
          <span className="nesio-bubble-menu-icon">⎘</span>复制
        </button>
        {!msg.savedToMemory && (
          <button type="button" className="nesio-bubble-menu-item" onClick={() => { onSave(); onClose(); }}>
            <span className="nesio-bubble-menu-icon">＋</span>存入记忆
          </button>
        )}
        <button type="button" className="nesio-bubble-menu-item nesio-bubble-menu-item--cancel" onClick={onClose}>取消</button>
      </div>
    </>
  );
}

// ─── Memory detail ─────────────────────────────────────────────────────────────
function MemoryDetail({ node, onClose }: { node: LifeNode; onClose: () => void }) {
  const attrs = Object.entries(node.attributes)
    .filter(([k, v]) => v !== null && !['subtasksJson', 'context', 'done', 'doneAt', 'savedFromChat', 'fullText'].includes(k));
  return (
    <div className="nesio-memory-detail">
      <div className="nesio-memory-detail-header">
        <button type="button" className="nesio-wechat-back-btn" onClick={onClose}>←</button>
        <span className="nesio-wechat-title">记忆详情</span>
        <span />
      </div>
      <div className="nesio-memory-detail-body">
        <h3 className="nesio-memory-detail-name">{node.name}</h3>
        <p className="nesio-memory-detail-meta">{node.type} · {new Date(node.createdAt).toLocaleDateString('zh-CN')}</p>
        {node.rawInput && <p className="nesio-memory-detail-raw">{node.rawInput}</p>}
        {attrs.length > 0 && (
          <ul className="nesio-memory-detail-attrs">
            {attrs.map(([k, v]) => (
              <li key={k}><span className="nesio-memory-detail-key">{k}</span><span className="nesio-memory-detail-val">{String(v)}</span></li>
            ))}
          </ul>
        )}
        {(node.tags ?? []).length > 0 && (
          <div className="nesio-memory-detail-tags">
            {(node.tags ?? []).map((t) => <span key={t} className="nesio-focus-card-hint">{t}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Camera view ──────────────────────────────────────────────────────────────
function CameraView({ onResult, onClose, autoOpen = false }: {
  onResult: (label: string, nodes: LifeNode[]) => void;
  onClose: () => void;
  autoOpen?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [cameraError, setCameraError] = useState('');

  // Stop tracks on unmount
  useEffect(() => () => { stream?.getTracks().forEach((t) => t.stop()); }, [stream]);

  // Attach stream to video element AFTER React renders it
  useEffect(() => {
    if (!stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    videoRef.current.addEventListener('loadedmetadata', () => {
      videoRef.current?.play().catch(() => undefined);
    }, { once: true });
    // Fallback play in case loadedmetadata already fired
    videoRef.current.play().catch(() => undefined);
  }, [stream]);

  // Auto-open camera when launched from 拍摄 button
  useEffect(() => { if (autoOpen) void openCamera(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openCamera() {
    setCameraError('');
    try {
      // Try back camera first, fall back to any camera
      let s: MediaStream | null = null;
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      } catch {
        s = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      setStream(s);
    } catch (err) {
      console.warn('[camera] getUserMedia failed:', err);
      setCameraError('无法访问摄像头，请检查权限或改用相册');
    }
  }

  async function capture() {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    await analyze(canvas.toDataURL('image/jpeg', 0.8));
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => void analyze(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function analyze(dataUrl: string) {
    setAnalyzing(true);
    try {
      const [header, base64] = dataUrl.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
      const res = await fetch('/api/portal/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'image', imageBase64: base64, mimeType }),
      });
      const data = await res.json() as { ok?: boolean; nodes?: Array<{ name: string; type: string }>; summary?: string };
      if (data.ok && data.nodes?.length) {
        const names = data.nodes.map((n) => n.name).join('、');
        const found = new Map<string, LifeNode>();
        for (const node of data.nodes) {
          for (const n of searchLifeGraphFuzzy(node.name, 2)) found.set(n.id, n);
        }
        onResult(names || data.summary || '（未识别到）', Array.from(found.values()).slice(0, 6));
      } else {
        onResult(data.summary || '（未识别到）', []);
      }
    } catch { onResult('识别失败', []); }
    setAnalyzing(false);
  }

  // Show camera live view once stream is ready (video srcObject set by useEffect)
  if (stream) {
    return (
      <div className="nesio-camera-live">
        <button
          type="button"
          className="nesio-wechat-back-btn nesio-camera-back"
          onClick={() => { stream.getTracks().forEach((t) => t.stop()); setStream(null); onClose(); }}
        >←</button>
        {/* muted + playsInline required on iOS for autoplay in PWA */}
        <video ref={videoRef} autoPlay muted playsInline className="nesio-camera-video" />
        <button type="button" className="nesio-chat-camera-shutter" onClick={capture} aria-label="拍照">
          <span className="nesio-camera-shutter-ring" />
        </button>
        {analyzing && <p className="nesio-camera-status">识别中…</p>}
      </div>
    );
  }

  return (
    <div className="nesio-camera-entry">
      <button type="button" className="nesio-wechat-back-btn" onClick={onClose}>← 返回</button>
      {analyzing ? (
        <p className="nesio-camera-status">识别中…</p>
      ) : (
        <>
          {cameraError && <p className="nesio-camera-status" style={{ color: 'var(--status-risk)' }}>{cameraError}</p>}
          <div className="nesio-camera-entry-btns">
            <button type="button" className="nesio-wechat-plus-item" onClick={openCamera}>
              <span className="nesio-wechat-plus-icon">📷</span><span>打开摄像头</span>
            </button>
            <button type="button" className="nesio-wechat-plus-item" onClick={() => fileRef.current?.click()}>
              <span className="nesio-wechat-plus-icon">🖼</span><span>从相册选图</span>
            </button>
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="nesio-hidden" onChange={handleFile} />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function NesioChatSheet({
  open,
  onClose,
  canUsePrivateData = false,
}: {
  open: boolean;
  onClose: () => void;
  canUsePrivateData?: boolean;
}) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const { flashNodes, triggerFlash, dismiss: dismissFlash } = useMemoryFlash();
  // voiceMode: false = text input, true = hold-to-talk bar
  const [voiceMode, setVoiceMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showPlus, setShowPlus] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraAutoOpen, setCameraAutoOpen] = useState(false);
  const [menuMsg, setMenuMsg] = useState<UiMessage | null>(null);
  const [detailNode, setDetailNode] = useState<LifeNode | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<{ stop(): void } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceTextRef = useRef('');
  // Loaded file context — persists across messages in this session
  const fileContextRef = useRef<{ name: string; content: string } | null>(null);

  useEffect(() => { if (open) setMessages(loadHistory()); }, [open]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || sending) return;
    const userMsg: UiMessage = { id: `u-${Date.now()}`, role: 'user', text: text.trim() };
    const nextMsgs = [...messages, userMsg];
    setMessages(nextMsgs);
    setInput('');
    setSending(true);
    setShowPlus(false);

    const history: ChatMessage[] = nextMsgs
      .slice(-21, -1)
      .filter((m) => m.role === 'user' || m.role === 'model')
      .map((m) => ({ role: m.role as 'user' | 'model', text: m.text }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch('/api/portal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          history,
          coachStyle: loadProfileSettings().coachStyle || 'warm',
          fileContext: fileContextRef.current
            ? { name: fileContextRef.current.name, content: fileContextRef.current.content }
            : undefined,
          memoryContext: buildMemoryContext(text.trim()),
          calendarContext: buildCalendarContext(text.trim()),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json() as { ok?: boolean; response?: string; sources?: Array<{ title: string; url: string }> };
      const aiMsg: UiMessage = {
        id: `a-${Date.now()}`,
        role: 'model',
        text: data.response?.trim() || '（暂时没有找到相关信息）',
        sources: data.sources ?? [],
      };
      const withAi = [...nextMsgs, aiMsg];
      setMessages(withAi);
      saveHistory(withAi);
    } catch (err) {
      clearTimeout(timeout);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      // 兜底：从本地记忆模糊搜索
      const localHits = searchLifeGraphFuzzy(text.trim(), 5);
      const fallbackText = localHits.length
        ? `AI 暂时不可用，但我在记忆库里找到了这些相关线索：\n${localHits.map((n) => `• ${n.name}`).join('\n')}`
        : isTimeout ? '响应超时，请重试。' : 'AI 暂时不可用，记忆库里也没找到相关线索。';
      const errMsg: UiMessage = { id: `e-${Date.now()}`, role: 'model', text: fallbackText };
      setMessages((prev) => [...prev, errMsg]);
    }
    setSending(false);
  }, [messages, sending]);

  function handleSave(msg: UiMessage) {
    const savedNode = addLifeNode({
      name: msg.text.slice(0, 60), type: 'event', source: 'manual', confidence: 0.9,
      tags: ['宝盒对话'], attributes: { fullText: msg.text, savedFromChat: true },
      relations: [], rawInput: msg.text,
    });
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, savedToMemory: true } : m));
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    triggerFlash(savedNode);
  }

  function handleCopy(msg: UiMessage) {
    navigator.clipboard.writeText(msg.text).catch(() => undefined);
  }

  async function handleFileUpload(file: File) {
    setShowPlus(false);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isText = ['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log'].includes(ext);
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp'].includes(ext) || file.type.startsWith('image/');

    // 图片 → 走识别流程
    if (isImage) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const [hdr, b64] = dataUrl.split(',');
        const mime = hdr.match(/:(.*?);/)?.[1] || 'image/jpeg';
        const userMsg: UiMessage = { id: `u-${Date.now()}`, role: 'user', text: `📷 ${file.name}` };
        const next = [...messages, userMsg];
        setMessages(next);
        fetch('/api/portal/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'image', imageBase64: b64, mimeType: mime }),
        }).then((r) => r.json()).then((data: { ok?: boolean; nodes?: Array<{ name: string; type: string }>; summary?: string }) => {
          const names = data.nodes?.map((n) => n.name).join('、') || data.summary || '（未识别到内容）';
          const aiMsg: UiMessage = { id: `a-${Date.now()}`, role: 'model', text: `识别到：${names}\n\n可以继续问我关于这张图片的问题。` };
          const withAi = [...next, aiMsg];
          setMessages(withAi); saveHistory(withAi);
        }).catch(() => {
          const aiMsg: UiMessage = { id: `a-${Date.now()}`, role: 'model', text: '图片识别失败，请重试。' };
          setMessages((prev) => [...prev, aiMsg]);
        });
      };
      reader.readAsDataURL(file);
      return;
    }

    if (!isText) {
      const notice: UiMessage = {
        id: `m-${Date.now()}`, role: 'model',
        text: `暂时只支持文本（CSV/TXT/JSON 等）和图片文件。"${file.name}" 是 .${ext || '未知'} 格式，暂不支持。`,
      };
      setMessages((prev) => [...prev, notice]);
      return;
    }

    try {
      let raw = await readFileAsText(file);
      let content = raw;

      if (isCsvLike(file.name)) {
        // Convert CSV to readable Markdown table
        content = `文件：${file.name}\n行数：${raw.trim().split(/\r?\n/).length - 1} 条记录\n\n${csvToMarkdown(raw)}`;
      } else {
        content = `文件：${file.name}\n\n${raw}`;
      }

      content = truncate(content, MAX_FILE_CHARS);
      fileContextRef.current = { name: file.name, content };

      const rowCount = isCsvLike(file.name)
        ? `${raw.trim().split(/\r?\n/).length - 1} 行数据`
        : `${(raw.length / 1024).toFixed(1)} KB`;

      const notice: UiMessage = {
        id: `f-${Date.now()}`, role: 'model',
        text: `📎 已加载 **${file.name}**（${rowCount}）\n\n可以问我这个文件里的任何问题，比如：\n• 这里有多少条记录？\n• 帮我总结一下\n• 谁的金额最高？`,
      };
      setMessages((prev) => [...prev, notice]);
    } catch {
      const errMsg: UiMessage = {
        id: `e-${Date.now()}`, role: 'model',
        text: `读取文件失败，请确认文件没有损坏。`,
      };
      setMessages((prev) => [...prev, errMsg]);
    }
  }

  // Voice input (tap mic → voiceMode; hold-to-talk in voiceMode)
  function getSR(): InstanceType<SR> | null {
    const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return null;
    const r = new Ctor();
    r.lang = 'zh-CN'; r.interimResults = true; r.continuous = false;
    return r;
  }

  function startRecording() {
    voiceTextRef.current = '';
    const r = getSR();
    if (!r) {
      // SpeechRecognition not available — surface a clear message
      const errMsg: UiMessage = { id: `e-${Date.now()}`, role: 'model', text: '当前浏览器不支持语音输入，请切换到键盘文字输入。' };
      setMessages((prev) => [...prev, errMsg]);
      setVoiceMode(false);
      return;
    }
    r.onresult = (e) => {
      voiceTextRef.current = Array.from(e.results).map((res) => res[0].transcript).join('');
    };
    // onend fires after all results are delivered — safe to send here
    r.onend = () => {
      setRecording(false);
      const text = voiceTextRef.current.trim();
      voiceTextRef.current = '';
      if (text) void sendMessage(text);
    };
    r.onerror = () => { setRecording(false); voiceTextRef.current = ''; };
    r.start();
    recognitionRef.current = r;
    setRecording(true);
  }

  function stopRecording() {
    // Just stop; onend will fire and handle sending
    recognitionRef.current?.stop();
  }

  function startBubbleLongPress(msg: UiMessage) {
    longPressRef.current = setTimeout(() => setMenuMsg(msg), 500);
  }
  function cancelBubbleLongPress() {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
  }

  function handleCameraResult(label: string, nodes: LifeNode[]) {
    setShowCamera(false);
    const userMsg: UiMessage = { id: `u-${Date.now()}`, role: 'user', text: '📷 识别图片' };
    const aiText = nodes.length > 0
      ? `识别到：${label}\n\n记忆库里找到 ${nodes.length} 条相关记录：\n${nodes.map((n) => `• ${n.name}（${n.type}）`).join('\n')}`
      : `识别到：${label}\n\n记忆库里暂时没有找到相关记录。`;
    const aiMsg: UiMessage = { id: `a-${Date.now()}`, role: 'model', text: aiText };
    const next = [...messages, userMsg, aiMsg];
    setMessages(next); saveHistory(next);
  }

  if (!open) return null;

  if (showCamera) {
    return (
      <div className="nesio-wechat-fullscreen" role="dialog" aria-label="拍照识别">
        <CameraView
          onResult={handleCameraResult}
          onClose={() => { setShowCamera(false); setCameraAutoOpen(false); }}
          autoOpen={cameraAutoOpen}
        />
      </div>
    );
  }

  if (detailNode) {
    return (
      <div className="nesio-wechat-fullscreen" role="dialog" aria-label="记忆详情">
        <MemoryDetail node={detailNode} onClose={() => setDetailNode(null)} />
      </div>
    );
  }

  return (
    <div className="nesio-wechat-fullscreen" role="dialog" aria-modal="true" aria-label="问一问">
      {/* 关联记忆闪现 */}
      <MemoryFlashBanner nodes={flashNodes} onDismiss={dismissFlash} />

      {/* Header */}
      <div className="nesio-wechat-header">
        <button type="button" className="nesio-wechat-back-btn" onClick={onClose} aria-label="关闭">←</button>
        <span className="nesio-wechat-title">问一问</span>
        <button type="button" className="nesio-wechat-more-btn" onClick={() => { setMessages([]); saveHistory([]); }}>
          新对话
        </button>
      </div>

      {/* Messages */}
      <div className="nesio-wechat-messages" ref={listRef}>
        {messages.length === 0 && !sending && (
          <div className="nesio-wechat-empty">
            <p className="nesio-wechat-empty-icon">✦</p>
            <p className="nesio-wechat-empty-title">问我任何事</p>
            <div className="nesio-wechat-suggestions">
              {['我的护照放在哪里', '今天该吃什么', '帮我总结这周做了什么'].map((s) => (
                <button key={s} type="button" className="nesio-wechat-suggestion" onClick={() => void sendMessage(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === 'status') {
            return (
              <div key={msg.id} className="nesio-wechat-status-bubble">
                <span className="nesio-wechat-status-dot" />{msg.text}
              </div>
            );
          }
          const isUser = msg.role === 'user';
          return (
            <div key={msg.id} className={`nesio-wechat-row nesio-wechat-row--${isUser ? 'user' : 'ai'}`}>
              {!isUser && <span className="nesio-wechat-avatar">✦</span>}
              <div className="nesio-wechat-bubble-wrap">
                <div
                  className={`nesio-wechat-bubble nesio-wechat-bubble--${isUser ? 'user' : 'ai'}`}
                  onPointerDown={() => !isUser && startBubbleLongPress(msg)}
                  onPointerUp={cancelBubbleLongPress}
                  onPointerLeave={cancelBubbleLongPress}
                  onPointerCancel={cancelBubbleLongPress}
                  onContextMenu={(e) => { e.preventDefault(); if (!isUser) setMenuMsg(msg); }}
                >
                  <p className="nesio-wechat-bubble-text">{msg.text}</p>
                  {msg.savedToMemory && <p className="nesio-wechat-saved-badge">✓ 已存入记忆</p>}
                </div>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="nesio-wechat-sources">
                    {msg.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="nesio-wechat-source-chip">
                        🔗 {s.title || s.url.replace(/^https?:\/\//, '').split('/')[0]}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {sending && (
          <div className="nesio-wechat-row nesio-wechat-row--ai">
            <span className="nesio-wechat-avatar">✦</span>
            <div className="nesio-wechat-bubble nesio-wechat-bubble--ai nesio-wechat-bubble--thinking">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      {/* Emoji picker panel */}
      {showEmoji && (
        <div className="nesio-emoji-panel">
          {['😊','😂','🥰','😍','😭','🤔','👍','🙏','❤️','🔥','✅','⚠️','📌','💡','🎉','👏','💪','🫡','😅','🥲','🤣','😁','🙂','😏','😒','😤','🥳','🤩','😴','😇'].map((em) => (
            <button
              key={em}
              type="button"
              className="nesio-emoji-btn-item"
              onClick={() => { setInput((v) => v + em); setShowEmoji(false); inputRef.current?.focus(); }}
            >
              {em}
            </button>
          ))}
        </div>
      )}

      {/* Plus panel */}
      {showPlus && (
        <div className="nesio-wechat-plus-panel">
          <button type="button" className="nesio-wechat-plus-item" onClick={() => { setShowPlus(false); const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=(e)=>{ const f=(e.target as HTMLInputElement).files?.[0]; if(!f) return; const reader=new FileReader(); reader.onload=(ev)=>{ const dataUrl=ev.target?.result as string; const [hdr,b64]=dataUrl.split(','); const mime=hdr.match(/:(.*?);/)?.[1]||'image/jpeg'; const userMsg:UiMessage={id:`u-${Date.now()}`,role:'user',text:'📷 识别图片'}; const next=[...messages,userMsg]; setMessages(next); fetch('/api/portal/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'image',imageBase64:b64,mimeType:mime})}).then(r=>r.json()).then((data:{ ok?:boolean; nodes?:Array<{name:string;type:string}>; summary?:string })=>{ if(data.ok&&data.nodes?.length){const names=data.nodes.map(n=>n.name).join('、'); const found=new Map<string,LifeNode>(); for(const node of data.nodes){for(const n of searchLifeGraphFuzzy(node.name,2))found.set(n.id,n);} const nodes=Array.from(found.values()).slice(0,6); const aiText=nodes.length>0?`识别到：${names}\n\n找到 ${nodes.length} 条相关记录：\n${nodes.map(n=>`• ${n.name}`).join('\n')}`:`识别到：${names}\n\n记忆库里暂时没有相关记录。`; const aiMsg:UiMessage={id:`a-${Date.now()}`,role:'model',text:aiText}; const withAi=[...next,aiMsg]; setMessages(withAi); saveHistory(withAi);}else{const aiMsg:UiMessage={id:`a-${Date.now()}`,role:'model',text:data.summary||'图片识别暂时不可用。'}; const withAi=[...next,aiMsg]; setMessages(withAi); saveHistory(withAi);}}).catch(()=>{const aiMsg:UiMessage={id:`a-${Date.now()}`,role:'model',text:'图片识别失败，请重试。'}; setMessages(prev=>[...prev,aiMsg]);});}; reader.readAsDataURL(f);}; inp.click(); }}>
            <span className="nesio-wechat-plus-icon">🖼</span>
            <span>相册</span>
          </button>
          <button type="button" className="nesio-wechat-plus-item" onClick={() => { setShowPlus(false); setCameraAutoOpen(true); setShowCamera(true); }}>
            <span className="nesio-wechat-plus-icon">📷</span>
            <span>拍摄</span>
          </button>
          <button type="button" className="nesio-wechat-plus-item" onClick={() => { setShowPlus(false); setVoiceMode(true); }}>
            <span className="nesio-wechat-plus-icon">🎙</span>
            <span>语音输入</span>
          </button>
          <button type="button" className="nesio-wechat-plus-item" onClick={() => filePickerRef.current?.click()}>
            <span className="nesio-wechat-plus-icon">📄</span>
            <span>文件</span>
          </button>
        </div>
      )}

      {/* Hidden file picker for document/CSV upload */}
      <input
        ref={filePickerRef}
        type="file"
        accept=".csv,.tsv,.txt,.md,.json,.xml,.yaml,.yml,.log,image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFileUpload(file);
          e.target.value = '';
        }}
      />

      {/* Input bar */}
      <div className="nesio-wechat-input-bar">
        {voiceMode ? (
          /* Voice mode: keyboard toggle | Hold to Talk | emoji | + */
          <>
            <button
              type="button"
              className="nesio-wechat-mode-btn"
              onClick={() => setVoiceMode(false)}
              aria-label="切换到键盘"
            >
              ⌨️
            </button>
            <button
              type="button"
              className={`nesio-wechat-hold-btn${recording ? ' nesio-wechat-hold-btn--active' : ''}`}
              onPointerDown={(e) => { e.preventDefault(); startRecording(); }}
              onPointerUp={stopRecording}
              onPointerLeave={() => { if (recording) stopRecording(); }}
              onPointerCancel={() => { if (recording) stopRecording(); }}
              aria-label="按住说话"
            >
              {recording ? '松开发送' : '按住 说话'}
            </button>
            <button
              type="button"
              className={`nesio-wechat-emoji-btn${showEmoji ? ' nesio-wechat-emoji-btn--active' : ''}`}
              onClick={() => { setShowEmoji((v) => !v); setShowPlus(false); }}
              aria-label="表情"
            >
              😊
            </button>
            <button
              type="button"
              className={`nesio-wechat-plus-btn${showPlus ? ' nesio-wechat-plus-btn--active' : ''}`}
              onClick={() => setShowPlus((v) => !v)}
              aria-label="更多"
            >
              ＋
            </button>
          </>
        ) : (
          /* Text mode: mic toggle | input | send or + */
          <>
            <button
              type="button"
              className="nesio-wechat-mode-btn"
              onClick={() => setVoiceMode(true)}
              aria-label="切换到语音"
            >
              🎙
            </button>
            <input
              ref={inputRef}
              className="nesio-wechat-input"
              type="text"
              placeholder="问一问…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sendMessage(input); } }}
              disabled={sending}
            />
            <button
              type="button"
              className={`nesio-wechat-emoji-btn${showEmoji ? ' nesio-wechat-emoji-btn--active' : ''}`}
              onClick={() => { setShowEmoji((v) => !v); setShowPlus(false); }}
              aria-label="表情"
            >
              😊
            </button>
            {input.trim() ? (
              <button
                type="button"
                className="nesio-wechat-send-btn"
                onClick={() => void sendMessage(input)}
                disabled={sending}
                aria-label="发送"
              >
                发送
              </button>
            ) : (
              <button
                type="button"
                className={`nesio-wechat-plus-btn${showPlus ? ' nesio-wechat-plus-btn--active' : ''}`}
                onClick={() => setShowPlus((v) => !v)}
                aria-label="更多"
              >
                ＋
              </button>
            )}
          </>
        )}
      </div>

      {/* Bubble context menu */}
      {menuMsg && (
        <BubbleMenu
          msg={menuMsg}
          onClose={() => setMenuMsg(null)}
          onSave={() => handleSave(menuMsg)}
          onCopy={() => handleCopy(menuMsg)}
        />
      )}
    </div>
  );
}
