'use client';

import { useEffect, useRef, useState } from 'react';
import { routeIntent } from '@/lib/portal/intent-router';
import { addLifeNode, parseManualCapture } from '@/lib/portal/life-graph';

interface VoiceInputSheetProps { open: boolean; onClose: () => void; }

const QUICK_INTENTS = [
  { label: '记住…', prefix: '记住 ' },
  { label: '帮我安排…', prefix: '帮我安排 ' },
  { label: '提醒我…', prefix: '提醒我 ' },
];

export default function VoiceInputSheet({ open, onClose }: VoiceInputSheetProps) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [saved, setSaved] = useState(false);
  const [intentLabel, setIntentLabel] = useState('');
  const [micError, setMicError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    if (!open) { setText(''); setSaved(false); setListening(false); setIntentLabel(''); setMicError(''); recRef.current?.stop(); }
    else { setTimeout(startListening, 350); }
  }, [open]);

  function startListening() {
    setMicError('');
    const w = window as unknown as Record<string, unknown>;
    const SpeechRecognitionCtor = (w['SpeechRecognition'] || w['webkitSpeechRecognition']) as
      (new () => { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
        start: () => void; stop: () => void; }) | undefined;

    if (!SpeechRecognitionCtor) {
      setMicError('此浏览器不支持语音输入，请直接打字。');
      inputRef.current?.focus();
      return;
    }

    const rec = new SpeechRecognitionCtor();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join('');
      setText(transcript);
      setIntentLabel(routeIntent(transcript).suggestedAction);
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === 'not-allowed') setMicError('麦克风权限被拒绝，请在浏览器设置中允许。');
      else if (e.error === 'no-speech') setMicError('没有检测到语音，请再试一次。');
    };

    try { rec.start(); recRef.current = rec; setListening(true); }
    catch { setMicError('无法启动语音识别。'); }
  }

  function stopListening() { recRef.current?.stop(); setListening(false); }

  function handleSend() {
    const t = text.trim();
    if (!t) return;
    const result = routeIntent(t);
    if (result.intent === 'MEMORY_CAPTURE' || result.intent === 'REMINDER') {
      addLifeNode(parseManualCapture(t));
    }
    setSaved(true);
    setTimeout(() => { onClose(); setText(''); setSaved(false); }, 1100);
  }

  if (!open) return null;

  return (
    <div className="nesio-voice-sheet" role="dialog" aria-modal="true" aria-label="说一句">
      <div className="nesio-voice-sheet-backdrop" onClick={onClose} />
      <div className="nesio-voice-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-voice-sheet-header">
          <h2 className="nesio-voice-sheet-title">说一句</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {/* Transcript area */}
        <div className="nesio-voice-transcript" onClick={() => inputRef.current?.focus()}>
          {text || <span className="nesio-voice-transcript-placeholder">
            {listening ? '正在聆听你说的…' : '点击麦克风开始，或直接打字'}
          </span>}
        </div>

        {/* Intent label */}
        {intentLabel && !listening && (
          <div style={{ fontSize: '0.75rem', color: 'var(--portal-blue-deep)', margin: '-0.25rem 0 0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span>✦</span> {intentLabel}
          </div>
        )}

        {/* Wave / status */}
        <div className="nesio-voice-status">
          {listening ? (
            <>
              <div className="nesio-voice-wave" aria-hidden>
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} className="nesio-voice-wave-bar" style={{ animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
              <span className="nesio-voice-status-label">正在聆听…</span>
              <button type="button" onClick={stopListening} style={{ fontSize: '0.72rem', color: 'var(--portal-muted)', marginLeft: '0.5rem' }}>停止</button>
            </>
          ) : micError ? (
            <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{micError}</span>
          ) : null}
        </div>

        {/* Quick intent chips */}
        <div className="nesio-voice-quick">
          {QUICK_INTENTS.map((q) => (
            <button key={q.label} type="button" className="nesio-voice-quick-btn"
              onClick={() => { setText(q.prefix); inputRef.current?.focus(); }}>
              {q.label}
            </button>
          ))}
        </div>

        {/* Text input */}
        <div className="nesio-voice-input-row">
          <span className="nesio-voice-input-spark">✦</span>
          <input
            ref={inputRef}
            className="nesio-voice-input"
            placeholder="或者打字输入…"
            value={text}
            onChange={(e) => { setText(e.target.value); if (e.target.value) setIntentLabel(routeIntent(e.target.value).suggestedAction); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
          />
          <button type="button"
            className={`nesio-voice-mic-btn${listening ? ' nesio-voice-mic-btn--active' : ''}`}
            onClick={listening ? stopListening : startListening}
            aria-label={listening ? '停止录音' : '开始录音'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
            </svg>
          </button>
        </div>

        {/* Send / saved */}
        {saved ? (
          <div className="nesio-voice-saved">✓ 已存入 Memory</div>
        ) : text.trim() ? (
          <button type="button" className="nesio-voice-send-btn" onClick={handleSend}>告诉 Nesio</button>
        ) : null}
      </div>
    </div>
  );
}
