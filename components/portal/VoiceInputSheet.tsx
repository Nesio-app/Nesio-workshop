'use client';

/**
 * 说一句 — recording bottom sheet that:
 * 1. Opens with SpeechRecognition streaming transcript
 * 2. Shows real-time text + intent label
 * 3. On send: POSTs to /api/portal/analyze
 * 4. Saves returned nodes to Life Graph
 * 5. Triggers re-run of Reasoning Engine
 */

import { useEffect, useRef, useState } from 'react';
import { addLifeNode, isPrivateExternalNode, searchLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { routeIntent } from '@/lib/portal/intent-router';
import MeetingRecorder from './MeetingRecorder';

interface VoiceInputSheetProps {
  open: boolean;
  intent?: 'note' | 'ask';
  canUsePrivateData?: boolean;
  onClose: () => void;
}

const QUICK_INTENTS = [
  { label: '记住…', prefix: '记住 ' },
  { label: '帮我安排…', prefix: '帮我安排 ' },
  { label: '提醒我…', prefix: '提醒我 ' },
  { label: '我今天…', prefix: '我今天 ' },
];

type SendState = 'idle' | 'analyzing' | 'saved' | 'error';

export default function VoiceInputSheet({ open, intent = 'note', canUsePrivateData = false, onClose }: VoiceInputSheetProps) {
  const [mode, setMode] = useState<'note' | 'meeting'>('note');
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [sendState, setSendState] = useState<SendState>('idle');
  const [intentLabel, setIntentLabel] = useState('');
  const [micError, setMicError] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [askResults, setAskResults] = useState<LifeNode[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const isAskMode = intent === 'ask';

  useEffect(() => {
    if (!open) {
      setText(''); setSendState('idle'); setListening(false);
      setIntentLabel(''); setMicError(''); setSavedCount(0); setAskResults([]);
      recRef.current?.stop();
    } else {
      if (isAskMode) {
        setTimeout(() => inputRef.current?.focus(), 120);
      } else {
        setTimeout(startListening, 300);
      }
    }
  }, [open, isAskMode]);

  // Update intent label as user types/speaks
  useEffect(() => {
    if (text.trim()) setIntentLabel(routeIntent(text).suggestedAction);
    else setIntentLabel('');
  }, [text]);

  function startListening() {
    setMicError('');
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w['SpeechRecognition'] || w['webkitSpeechRecognition']) as
      (new () => {
        lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>> }) => void) | null;
        onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
        start: () => void; stop: () => void;
      }) | undefined;

    if (!Ctor) {
      setMicError('此浏览器不支持语音输入，请直接打字。');
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    const rec = new Ctor();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let final = '';
      let interim = '';
      Array.from(e.results).forEach((r) => {
        const t = r[0].transcript;
        if ((r as { isFinal?: boolean }).isFinal) final += t;
        else interim += t;
      });
      setText(final + interim);
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === 'not-allowed') setMicError('麦克风权限被拒，请在浏览器设置中允许后重试。');
      else if (e.error === 'no-speech') { /* silently retry */ }
    };

    try { rec.start(); recRef.current = rec; setListening(true); }
    catch { setMicError('无法启动语音识别，请直接打字。'); }
  }

  function stopListening() { recRef.current?.stop(); setListening(false); }

  async function handleSend() {
    const t = text.trim();
    if (!t) return;

    if (isAskMode) {
      stopListening();
      const matches = searchLifeGraph(t).filter((node) => canUsePrivateData || !isPrivateExternalNode(node));
      setAskResults(matches.slice(0, 4));
      setSendState('saved');
      return;
    }

    setSendState('analyzing');

    try {
      const res = await fetch('/api/portal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'text', content: t }),
      });
      const data = await res.json() as {
        ok?: boolean;
        nodes?: Array<{ type: string; name: string; attributes: Record<string, string>; relations: unknown[]; tags: string[]; source: string; confidence: number; rawInput?: string }>;
        summary?: string;
      };

      if (data.ok && data.nodes?.length) {
        data.nodes.forEach((node) => addLifeNode({ ...node, source: 'voice' } as Parameters<typeof addLifeNode>[0]));
        setSavedCount(data.nodes.length);
      } else {
        // Fallback: save raw text
        addLifeNode({ type: 'object', name: t.slice(0, 30), attributes: { note: t }, source: 'voice', confidence: 0.65, relations: [], tags: ['说一句'], rawInput: t });
        setSavedCount(1);
      }
      setSendState('saved');
      setTimeout(() => { onClose(); setText(''); setSendState('idle'); }, 1100);
    } catch {
      // Even on error, save locally
      addLifeNode({ type: 'object', name: t.slice(0, 30), attributes: { note: t }, source: 'voice', confidence: 0.6, relations: [], tags: ['说一句'], rawInput: t });
      setSavedCount(1);
      setSendState('saved');
      setTimeout(() => { onClose(); setText(''); setSendState('idle'); }, 1100);
    }
  }

  if (!open) return null;

  return (
    <>
    {/* Meeting recorder takes over when in meeting mode */}
    <MeetingRecorder open={mode === 'meeting'} onClose={() => { setMode('note'); onClose(); }} />

    <div className="nesio-voice-sheet" role="dialog" aria-modal="true" aria-label={isAskMode ? '问宝盒' : '说一句'} style={{ display: mode === 'meeting' ? 'none' : undefined }}>
      <div className="nesio-voice-sheet-backdrop" onClick={onClose} />
      <div className="nesio-voice-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />

        <div className="nesio-voice-sheet-header">
          <h2 className="nesio-voice-sheet-title">{isAskMode ? '问宝盒' : '说一句'}</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {!isAskMode && (
              <button type="button"
                style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--portal-blue-deep)', background: 'rgba(88,140,227,0.1)', padding: '0.2rem 0.6rem', borderRadius: '999px' }}
                onClick={() => { stopListening(); setMode('meeting'); }}
                title="切换到会议记录模式">
                🎙 会议记录
              </button>
            )}
            <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label="关闭">✕</button>
          </div>
        </div>

        {!isAskMode && (
          <div className="nesio-voice-transcript" onClick={() => { stopListening(); inputRef.current?.focus(); }}>
            {text
              ? <span>{text}</span>
              : <span className="nesio-voice-transcript-placeholder">
                  {listening
                    ? '正在听这一句，说完后会显示…'
                    : '点下方麦克风开始，或直接打字'}
                </span>}
          </div>
        )}

        {/* Intent label */}
        {intentLabel && (
          <div className="nesio-voice-intent-label">
            <span>✦</span> {intentLabel}
          </div>
        )}

        {/* Waveform / status */}
        <div className="nesio-voice-status">
          {listening ? (
            <>
              <div className="nesio-voice-wave" aria-hidden>
                {Array.from({ length: 7 }, (_, i) => (
                  <span key={i} className="nesio-voice-wave-bar" style={{ animationDelay: `${i * 0.09}s` }} />
                ))}
              </div>
              <span className="nesio-voice-status-label">{isAskMode ? '正在听这一句…' : '正在记录…'}</span>
              <button type="button" style={{ fontSize: '0.72rem', color: 'var(--portal-muted)', marginLeft: '0.5rem', padding: '0.2rem 0.5rem' }} onClick={stopListening}>
                停止
              </button>
            </>
          ) : micError ? (
            <span style={{ fontSize: '0.73rem', color: '#ef4444', textAlign: 'center', lineHeight: 1.4 }}>{micError}</span>
          ) : text ? (
            <span style={{ fontSize: '0.72rem', color: 'var(--portal-muted)' }}>{isAskMode ? '输入完成 · 点「问宝盒」查找线索' : '识别完成 · 点「告诉 Nesio」保存'}</span>
          ) : null}
        </div>

        {/* Quick intent chips */}
        {!isAskMode && (
          <div className="nesio-voice-quick">
            {QUICK_INTENTS.map((q) => (
              <button key={q.label} type="button" className="nesio-voice-quick-btn"
                onClick={() => { stopListening(); setText(q.prefix); setTimeout(() => inputRef.current?.focus(), 50); }}>
                {q.label}
              </button>
            ))}
          </div>
        )}

        {/* Text input fallback */}
        <div className="nesio-voice-input-row">
          <span className="nesio-voice-input-spark">✦</span>
          <input
            ref={inputRef}
            className="nesio-voice-input"
            placeholder={isAskMode ? '或者打字问宝盒…' : '或者打字输入…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <button
            type="button"
            className={`nesio-voice-mic-btn${listening ? ' nesio-voice-mic-btn--active' : ''}`}
            onClick={listening ? stopListening : startListening}
            aria-label={listening ? '停止录音' : '开始录音'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
            </svg>
          </button>
        </div>

        {/* Send button */}
        {isAskMode && sendState === 'saved' ? (
          <div className="nesio-voice-saved nesio-ask-answer" style={{ textAlign: 'left', color: 'var(--portal-ink)', background: 'rgba(88,140,227,0.08)', borderRadius: '1rem' }}>
            {askResults.length ? (
              <>
                <p style={{ fontWeight: 700, marginBottom: '0.45rem' }}>我找到了这些可能相关的线索</p>
                {askResults.map((node) => (
                  <p key={node.id} style={{ marginTop: '0.35rem', color: 'var(--portal-muted)' }}>
                    {node.name} · 来自：{node.source === 'voice' ? '你说的一句话' : node.source}
                  </p>
                ))}
              </>
            ) : (
              <p>还没找到相关线索。你可以先把这件事放进宝盒。</p>
            )}
          </div>
        ) : sendState === 'saved' ? (
          <div className="nesio-voice-saved">✓ 已存入 Memory（{savedCount} 条）</div>
        ) : sendState === 'analyzing' ? (
          <div className="nesio-voice-send-btn" style={{ opacity: 0.6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <span className="nesio-camera-recognizing-dot" style={{ background: '#fff' }} />Nesio 正在分析…
          </div>
        ) : text.trim() ? (
          <button type="button" className="nesio-voice-send-btn" onClick={handleSend}>
            {isAskMode ? '问宝盒' : '告诉 Nesio'}
          </button>
        ) : null}
      </div>
    </div>
    </>
  );
}
