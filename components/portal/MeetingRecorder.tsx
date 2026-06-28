'use client';

/**
 * MeetingRecorder — Granola-style meeting notes.
 * Records audio → real-time transcript → AI structured notes → Life Graph + Calendar link.
 */

import { useEffect, useRef, useState } from 'react';
import { addLifeNode } from '@/lib/portal/life-graph';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import type { CalendarEvent } from '@/lib/portal/types';

interface MeetingRecorderProps { open: boolean; onClose: () => void; }

interface MeetingNote {
  title: string;
  date: string;
  duration: string;
  summary: string;
  keyPoints: string[];
  actions: string[];
  people: string[];
  linkedEvent?: string;
}

type RecordState = 'idle' | 'recording' | 'processing' | 'done' | 'error';

export default function MeetingRecorder({ open, onClose }: MeetingRecorderProps) {
  const [recState, setRecState] = useState<RecordState>('idle');
  const [transcript, setTranscript] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<MeetingNote | null>(null);
  const [saved, setSaved] = useState(false);
  const [upcomingEvent, setUpcomingEvent] = useState<CalendarEvent | null>(null);

  const recRef = useRef<{ stop: () => void } | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!open) { stopAll(); setRecState('idle'); setTranscript(''); setNote(null); setSaved(false); setElapsed(0); }
    else { findUpcomingEvent(); }
  }, [open]);

  function findUpcomingEvent() {
    const cal = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
    const now = Date.now();
    const event = cal?.events?.find((e) => {
      const start = new Date(e.start).getTime();
      return Math.abs(start - now) < 2 * 3600_000; // within 2h of now
    });
    setUpcomingEvent(event || null);
  }

  function stopAll() {
    recRef.current?.stop();
    mediaRef.current?.stop();
    clearInterval(timerRef.current ?? undefined);
    window.speechSynthesis?.cancel();
  }

  async function startRecording() {
    setTranscript('');
    setRecState('recording');
    startTimeRef.current = Date.now();
    chunksRef.current = [];

    // Start elapsed timer
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    // SpeechRecognition for live transcript
    const w = window as unknown as Record<string, unknown>;
    const SpeechRecognitionCtor = (w['SpeechRecognition'] || w['webkitSpeechRecognition']) as (new () => {
      lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
      onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>> }) => void) | null;
      onend: (() => void) | null; onerror: (() => void) | null;
      start: () => void; stop: () => void;
    }) | undefined;

    if (SpeechRecognitionCtor) {
      const rec = new SpeechRecognitionCtor();
      rec.lang = 'zh-CN';
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        let text = '';
        Array.from(e.results).forEach((r) => { text += r[0].transcript + (r[0].transcript.endsWith('。') ? '\n' : ''); });
        setTranscript(text);
      };
      rec.onend = () => { /* continuous mode — restart if still recording */ };
      rec.start();
      recRef.current = rec;
    }

    // Also try MediaRecorder for audio backup
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(1000);
      mediaRef.current = mr;
    } catch { /* mic not available */ }
  }

  async function stopAndProcess() {
    stopAll();
    setRecState('processing');
    clearInterval(timerRef.current ?? undefined);

    const durationSec = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const durationStr = `${Math.floor(durationSec / 60)}分${durationSec % 60}秒`;

    try {
      const res = await fetch('/api/portal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'text',
          content: `这是一段会议记录转录文字，请生成结构化会议笔记：\n\n${transcript || '（无转录内容）'}\n\n会议时长：${durationStr}${upcomingEvent ? `\n关联日历：${upcomingEvent.title}` : ''}`,
        }),
      });

      const data = await res.json() as { ok?: boolean; nodes?: Array<Record<string, unknown>>; summary?: string };

      // Also ask for structured meeting notes via Gemini
      const geminiKey = '';// handled server-side
      const notesRes = await fetch('/api/portal/meeting-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, duration: durationStr, calendarEvent: upcomingEvent?.title }),
      }).catch(() => null);

      let structuredNote: MeetingNote;
      if (notesRes?.ok) {
        structuredNote = await notesRes.json() as MeetingNote;
      } else {
        // Fallback: parse from Life Graph nodes
        structuredNote = {
          title: upcomingEvent?.title || `会议 ${new Date().toLocaleDateString('zh-CN')}`,
          date: new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' }),
          duration: durationStr,
          summary: data.summary || transcript.slice(0, 100) || '会议记录',
          keyPoints: transcript.split('\n').filter((l) => l.trim()).slice(0, 5),
          actions: [],
          people: [],
          linkedEvent: upcomingEvent?.title,
        };
      }

      setNote(structuredNote);
      setRecState('done');
    } catch {
      setRecState('error');
    }
  }

  function saveNote() {
    if (!note) return;
    addLifeNode({
      type: 'event',
      name: note.title,
      attributes: {
        date: note.date,
        duration: note.duration,
        summary: note.summary,
        keyPoints: note.keyPoints.join(' | '),
        actions: note.actions.join(' | '),
      },
      source: 'voice',
      confidence: 0.9,
      relations: note.people.map((p) => ({ targetId: p, relation: 'participant' })),
      tags: ['会议记录', '说一句'],
      rawInput: transcript.slice(0, 200),
    });
    setSaved(true);
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    setTimeout(() => { onClose(); setSaved(false); setNote(null); }, 1000);
  }

  function formatElapsed(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  if (!open) return null;

  return (
    <div className="nesio-meeting-overlay" role="dialog" aria-modal="true" aria-label="会议记录">
      <div className="nesio-voice-sheet-backdrop" onClick={recState === 'idle' || recState === 'done' ? onClose : undefined} />
      <div className="nesio-meeting-card">
        <div className="nesio-sheet-handle" aria-hidden />

        <div className="nesio-voice-sheet-header">
          <div>
            <h2 className="nesio-voice-sheet-title">
              {recState === 'idle' && '会议记录'}
              {recState === 'recording' && '🔴 录音中'}
              {recState === 'processing' && 'Nesio 正在整理笔记…'}
              {recState === 'done' && '会议笔记'}
              {recState === 'error' && '处理失败'}
            </h2>
            {upcomingEvent && (
              <p style={{ fontSize: '0.72rem', color: 'var(--portal-blue-deep)', marginTop: '0.1rem' }}>
                📅 {upcomingEvent.title}
              </p>
            )}
          </div>
          {(recState === 'idle' || recState === 'done' || recState === 'error') && (
            <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
          )}
        </div>

        {/* IDLE */}
        {recState === 'idle' && (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--portal-muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
              开始录音后，Nesio 实时转录，结束时自动生成结构化笔记，并存入 Memory。
            </p>
            {upcomingEvent ? (
              <div style={{ background: 'rgba(88,140,227,0.08)', borderRadius: '0.75rem', padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--portal-muted)' }}>
                将关联日历事件：<strong style={{ color: 'var(--portal-ink)' }}>{upcomingEvent.title}</strong>
              </div>
            ) : null}
            <button type="button" className="nesio-ob-primary-btn" onClick={startRecording}>
              开始录音
            </button>
          </div>
        )}

        {/* RECORDING */}
        {recState === 'recording' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', margin: '0.75rem 0' }}>
              <span style={{ color: '#ef4444', fontSize: '0.85rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {formatElapsed(elapsed)}
              </span>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: '1.5rem' }}>
                {Array.from({ length: 7 }, (_, i) => (
                  <span key={i} className="nesio-voice-wave-bar" style={{ animationDelay: `${i * 0.1}s`, background: '#ef4444' }} />
                ))}
              </div>
            </div>

            <div className="nesio-voice-transcript" style={{ maxHeight: '12rem', overflowY: 'auto', fontSize: '0.82rem' }}>
              {transcript || <span className="nesio-voice-transcript-placeholder">正在记录，说话后会在这里显示…</span>}
            </div>

            <button type="button" className="nesio-ob-primary-btn" style={{ marginTop: '1rem', background: '#ef4444', boxShadow: '0 4px 16px rgba(239,68,68,0.3)' }} onClick={stopAndProcess}>
              停止并生成笔记
            </button>
          </>
        )}

        {/* PROCESSING */}
        {recState === 'processing' && (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--portal-muted)' }}>
            <div style={{ width: '2.5rem', height: '2.5rem', border: '3px solid rgba(88,140,227,0.2)', borderTopColor: 'var(--portal-blue-deep)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
            <p style={{ fontSize: '0.85rem' }}>AI 正在提取关键信息…</p>
          </div>
        )}

        {/* DONE */}
        {recState === 'done' && note && (
          <>
            <div className="nesio-meeting-note">
              <p className="nesio-meeting-note-meta">{note.date} · {note.duration}</p>
              <p className="nesio-meeting-note-summary">{note.summary}</p>

              {note.keyPoints.length > 0 && (
                <>
                  <p className="nesio-settings-section-label">关键内容</p>
                  <ul className="nesio-meeting-note-list">
                    {note.keyPoints.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </>
              )}

              {note.actions.length > 0 && (
                <>
                  <p className="nesio-settings-section-label">待办行动</p>
                  <ul className="nesio-meeting-note-list nesio-meeting-note-list--action">
                    {note.actions.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </>
              )}

              {note.linkedEvent && (
                <p style={{ fontSize: '0.7rem', color: 'var(--portal-blue-deep)', marginTop: '0.75rem' }}>
                  📅 已关联：{note.linkedEvent}
                </p>
              )}
            </div>

            <button type="button" className="nesio-ob-primary-btn" style={{ marginTop: '1rem' }} onClick={saveNote}>
              {saved ? '✓ 已存入 Memory' : '存入 Memory'}
            </button>
          </>
        )}

        {recState === 'error' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <p style={{ color: '#ef4444', fontSize: '0.85rem' }}>处理失败，请重试。</p>
            <button type="button" className="nesio-ob-primary-btn" style={{ marginTop: '1rem' }} onClick={() => setRecState('idle')}>重试</button>
          </div>
        )}
      </div>
    </div>
  );
}
