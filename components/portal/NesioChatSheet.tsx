'use client';

/**
 * NesioChatSheet — 问一问
 * WeChat-style full-screen chat window.
 * Long-press center button to open.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { addLifeNode, searchLifeGraphFuzzy, type LifeNode } from '@/lib/portal/life-graph';

interface ChatMessage { role: 'user' | 'model'; text: string; }

interface UiMessage {
  id: string;
  role: 'user' | 'model' | 'status';
  text: string;
  sources?: Array<{ title: string; url: string }>;
  savedToMemory?: boolean;
}

const CHAT_HISTORY_KEY = 'nesio-chat-history-v1';
const MAX_STORED = 60;

function loadHistory(): UiMessage[] {
  try { return JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) ?? '[]') as UiMessage[]; }
  catch { return []; }
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
function CameraView({ onResult, onClose }: {
  onResult: (label: string, nodes: LifeNode[]) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => () => { stream?.getTracks().forEach((t) => t.stop()); }, [stream]);

  async function openCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.play().catch(() => undefined);
      }
    } catch { fileRef.current?.click(); }
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
      const res = await fetch('/api/portal/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, mode: 'identify' }),
      });
      const data = await res.json() as { objects?: string[]; labels?: string[] };
      const items = data.objects ?? data.labels ?? [];
      const found = new Map<string, LifeNode>();
      for (const item of items) {
        for (const n of searchLifeGraphFuzzy(item, 3)) found.set(n.id, n);
      }
      onResult(items.join('、') || '（未识别到）', Array.from(found.values()).slice(0, 6));
    } catch { onResult('识别失败', []); }
    setAnalyzing(false);
  }

  if (stream) {
    return (
      <div className="nesio-camera-live">
        <button type="button" className="nesio-wechat-back-btn nesio-camera-back" onClick={() => { stream.getTracks().forEach((t) => t.stop()); setStream(null); onClose(); }}>←</button>
        {/* muted is required on iOS for autoplay */}
        <video ref={videoRef} autoPlay muted playsInline className="nesio-camera-video" />
        <button type="button" className="nesio-camera-shutter" onClick={capture} aria-label="拍照">
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
        <div className="nesio-camera-entry-btns">
          <button type="button" className="nesio-wechat-plus-item" onClick={openCamera}>
            <span className="nesio-wechat-plus-icon">📷</span><span>打开摄像头</span>
          </button>
          <button type="button" className="nesio-wechat-plus-item" onClick={() => fileRef.current?.click()}>
            <span className="nesio-wechat-plus-icon">🖼</span><span>相册</span>
          </button>
        </div>
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
  // voiceMode: false = text input, true = hold-to-talk bar
  const [voiceMode, setVoiceMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showPlus, setShowPlus] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [menuMsg, setMenuMsg] = useState<UiMessage | null>(null);
  const [detailNode, setDetailNode] = useState<LifeNode | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<{ stop(): void } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceTextRef = useRef('');

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
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch('/api/portal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim(), history }),
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
      const errMsg: UiMessage = {
        id: `e-${Date.now()}`,
        role: 'model',
        text: isTimeout ? '响应超时，请重试。' : '网络错误，请重试。',
      };
      setMessages((prev) => [...prev, errMsg]);
    }
    setSending(false);
  }, [messages, sending]);

  function handleSave(msg: UiMessage) {
    addLifeNode({
      name: msg.text.slice(0, 60), type: 'event', source: 'manual', confidence: 0.9,
      tags: ['宝盒对话'], attributes: { fullText: msg.text, savedFromChat: true },
      relations: [], rawInput: msg.text,
    });
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, savedToMemory: true } : m));
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  }

  function handleCopy(msg: UiMessage) {
    navigator.clipboard.writeText(msg.text).catch(() => undefined);
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
    if (!r) return;
    r.onresult = (e) => {
      voiceTextRef.current = Array.from(e.results).map((res) => res[0].transcript).join('');
    };
    r.onend = () => { setRecording(false); };
    r.onerror = () => { setRecording(false); };
    r.start();
    recognitionRef.current = r;
    setRecording(true);
  }

  function stopRecordingAndSend() {
    recognitionRef.current?.stop();
    setRecording(false);
    const text = voiceTextRef.current.trim();
    voiceTextRef.current = '';
    if (text) void sendMessage(text);
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
        <CameraView onResult={handleCameraResult} onClose={() => setShowCamera(false)} />
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

      {/* Plus panel */}
      {showPlus && (
        <div className="nesio-wechat-plus-panel">
          <button type="button" className="nesio-wechat-plus-item" onClick={() => { setShowPlus(false); const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=(e)=>{ const f=(e.target as HTMLInputElement).files?.[0]; if(!f) return; const reader=new FileReader(); reader.onload=(ev)=>{ setShowCamera(false); const dataUrl=ev.target?.result as string; const userMsg:UiMessage={id:`u-${Date.now()}`,role:'user',text:'📷 识别图片'}; const next=[...messages,userMsg]; setMessages(next); fetch('/api/portal/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:dataUrl,mode:'identify'})}).then(r=>r.json()).then((data:{ objects?: string[]; labels?: string[] })=>{ const items=data.objects??data.labels??[]; const found=new Map<string,LifeNode>(); for(const item of items){for(const n of searchLifeGraphFuzzy(item,3))found.set(n.id,n);} const nodes=Array.from(found.values()).slice(0,6); const aiText=nodes.length>0?`识别到：${items.join('、')}\n\n找到 ${nodes.length} 条相关记录：\n${nodes.map(n=>`• ${n.name}`).join('\n')}`:`识别到：${items.join('、')||'（未识别到）'}\n\n记忆库里暂时没有相关记录。`; const aiMsg:UiMessage={id:`a-${Date.now()}`,role:'model',text:aiText}; const withAi=[...next,aiMsg]; setMessages(withAi); saveHistory(withAi);}).catch(()=>undefined);}; reader.readAsDataURL(f);}; inp.click(); }}>
            <span className="nesio-wechat-plus-icon">🖼</span>
            <span>相册</span>
          </button>
          <button type="button" className="nesio-wechat-plus-item" onClick={() => { setShowPlus(false); setShowCamera(true); }}>
            <span className="nesio-wechat-plus-icon">📷</span>
            <span>拍摄</span>
          </button>
          <button type="button" className="nesio-wechat-plus-item" onClick={() => { setShowPlus(false); setVoiceMode(true); }}>
            <span className="nesio-wechat-plus-icon">🎙</span>
            <span>语音输入</span>
          </button>
        </div>
      )}

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
              onPointerUp={stopRecordingAndSend}
              onPointerLeave={() => { if (recording) { recognitionRef.current?.stop(); setRecording(false); } }}
              onPointerCancel={() => { if (recording) { recognitionRef.current?.stop(); setRecording(false); } }}
              aria-label="按住说话"
            >
              {recording ? '松开发送' : '按住 说话'}
            </button>
            <button
              type="button"
              className="nesio-wechat-emoji-btn"
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
              className="nesio-wechat-emoji-btn"
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
