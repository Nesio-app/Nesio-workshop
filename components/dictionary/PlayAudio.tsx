'use client';

import { useCallback, useRef, useState } from 'react';
import type { LangCode } from '@/lib/dictionary/types';

interface PlayAudioProps {
  text: string;
  lang: LangCode;
  label?: string;
  className?: string;
}

export default function PlayAudio({ text, lang, label = 'Play', className = '' }: PlayAudioProps) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(async () => {
    if (!text.trim() || playing || loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/dictionary/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), lang }),
      });
      if (!res.ok) throw new Error('TTS failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onplay = () => setPlaying(true);
      audio.onended = () => {
        setPlaying(false);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setPlaying(false);
        setLoading(false);
      };
      await audio.play();
    } catch {
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }, [text, lang, playing, loading]);

  return (
    <button
      type="button"
      onClick={play}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${className}`}
      aria-label={label}
      title={label}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-dict-sky border-t-transparent rounded-full animate-spin" />
      ) : (
        <svg className="w-4 h-4 text-dict-coral" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path d="M8 5v14l11-7L8 5z" />
        </svg>
      )}
      <span>{loading ? '...' : label}</span>
    </button>
  );
}
