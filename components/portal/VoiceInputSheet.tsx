'use client';

import { useEffect, useRef, useState } from 'react';
import { routeIntent } from '@/lib/portal/intent-router';
import { addLifeNode, parseManualCapture } from '@/lib/portal/life-graph';

interface VoiceInputSheetProps {
  open: boolean;
  onClose: () => void;
}

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
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    if (!open) {
      setText('');
      setSaved(false);
      setListening(false);
      setIntentLabel('');
    } else {
      setTimeout(() => startListening(), 300);
    }
  }, [open]);

  function startListening() {
    const w = window as unknown as Record<string, unknown>;
    const SpeechRecognitionCtor = (w['SpeechRecognition'] || w['webkitSpeechRecognition']) as (new () => { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void }) | undefined;
    const SpeechRecognition = SpeechRecognitionCtor;

    if (!SpeechRecognition) {
      inputRef.current?.focus();
      return;
    }

    const rec = new SpeechRecognition!();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = false;

    rec.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join('');
      setText(transcript);
      const result = routeIntent(transcript);
      setIntentLabel(result.suggestedAction);
    };

    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);

    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function handleSend() {
    if (!text.trim()) return;
    const result = routeIntent(text);

    if (result.intent === 'MEMORY_CAPTURE') {
      const node = parseManualCapture(text);
      addLifeNode(node);
    }

    setSaved(true);
    setTimeout(() => { onClose(); setText(''); setSaved(false); }, 1200);
  }

  function handleQuickIntent(prefix: string) {
    setText(prefix);
    inputRef.current?.focus();
  }

  if (!open) return null;

  return (
    <div className="nesio-voice-sheet" role="dialog" aria-modal="true" aria-label="说一句">
      <div className="nesio-voice-sheet-backdrop" onClick={onClose} />
      <div className="nesio-voice-sheet-card">
        {/* Handle */}
        <div className="nesio-sheet-handle" aria-hidden />

        <div className="nesio-voice-sheet-header">
          <h2 className="nesio-voice-sheet-title">说一句</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {/* Transcript */}
        <div className="nesio-voice-transcript">
          {text || <span className="nesio-voice-transcript-placeholder">正在听你说…</span>}
        </div>

        {/* Waveform / status */}
        <div className="nesio-voice-status">
          {listening ? (
            <>
              <div className="nesio-voice-wave" aria-hidden>
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} className="nesio-voice-wave-bar" style={{ animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
              <span className="nesio-voice-status-label">正在聆听…</span>
            </>
          ) : (
            <span className="nesio-voice-status-label" style={{ opacity: 0.5 }}>
              {intentLabel || '点击麦克风重新开始'}
            </span>
          )}
        </div>

        {/* Quick intents */}
        <div className="nesio-voice-quick">
          {QUICK_INTENTS.map((q) => (
            <button key={q.label} type="button" className="nesio-voice-quick-btn" onClick={() => handleQuickIntent(q.prefix)}>
              {q.label}
            </button>
          ))}
        </div>

        {/* Text input fallback */}
        <div className="nesio-voice-input-row">
          <span className="nesio-voice-input-spark" aria-hidden>✦</span>
          <input
            ref={inputRef}
            className="nesio-voice-input"
            placeholder="或者打字输入…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const r = routeIntent(e.target.value);
              setIntentLabel(r.suggestedAction);
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
          />
          <button
            type="button"
            className={`nesio-voice-mic-btn${listening ? ' nesio-voice-mic-btn--active' : ''}`}
            onClick={listening ? stopListening : startListening}
            aria-label={listening ? '停止' : '开始录音'}
          >
            🎤
          </button>
        </div>

        {saved ? (
          <div className="nesio-voice-saved">✓ 已存入 Memory</div>
        ) : (
          text.trim() && (
            <button type="button" className="nesio-voice-send-btn" onClick={handleSend}>
              告诉 Nesio
            </button>
          )
        )}
      </div>
    </div>
  );
}
