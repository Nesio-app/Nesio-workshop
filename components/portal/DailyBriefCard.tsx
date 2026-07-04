'use client';

/**
 * DailyBriefCard — 听今日简报
 * Podcast-host style briefing.
 * TTS: OpenAI nova (primary) → browser SpeechSynthesis (fallback, no API key needed).
 */

import { useEffect, useRef, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { getEnvironment, getCachedCalendarEvents } from '@/lib/portal/environment';
import { refreshLocation } from '@/lib/portal/location-store';
import { track } from '@/lib/portal/telemetry';
import type { CalendarEvent } from '@/lib/portal/types';
import { IconAlertTriangle, IconClock, IconPlay, IconRefresh, IconSpeaker } from './icons';

const BRIEF_CACHE_KEY = 'nesio-daily-brief-v2';

// 未登录演示简报 — 静态样例,browser TTS 播放,不读任何私人数据
const DEMO_BRIEF_SCRIPT =
  '早上好。这是一段示例简报,让你听听 Nesio 每天会怎么陪你开始一天。' +
  '今天 22 度,晴,适合把外套留在家里。上午十点有一个产品评审会,' +
  '你昨天记过要提前整理三个重点,放在了会议笔记里。' +
  '另外,Linda 的生日还有五天,你存过一个礼物灵感。' +
  '登录之后,这里播的就是你自己的今天。';
interface BriefCache { date: string; script: string; }

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error';
type TTSMode = 'openai' | 'browser';

function getEmailHighlights(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const nodes = JSON.parse(localStorage.getItem('nesio-life-graph-v1') || '[]') as Array<{
      source?: string; name?: string; rawInput?: string; createdAt?: string;
    }>;
    return nodes
      .filter((n) => n.source === 'email' && n.name)
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .slice(0, 5)
      .map((n) => n.rawInput ? `${n.name}（${n.rawInput.slice(0, 60)}）` : n.name!);
  } catch { return []; }
}

function getMemoryNotes(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const nodes = JSON.parse(localStorage.getItem('nesio-life-graph-v1') || '[]') as Array<{
      source?: string; name?: string; type?: string; createdAt?: string;
    }>;
    return nodes
      .filter((n) => n.source === 'manual' && n.name && n.type !== 'event')
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .slice(0, 3)
      .map((n) => n.name!);
  } catch { return []; }
}

export default function DailyBriefCard({
  canUsePrivateData,
  memoryCount: _memoryCount,
  memoryNotes: _memoryNotesProp,
  circular,
}: {
  canUsePrivateData: boolean;
  memoryCount: number;
  memoryNotes: readonly string[];
  circular?: boolean;
}) {
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [displayName, setDisplayName] = useState('');
  const [cachedScript, setCachedScript] = useState('');
  const [progress, setProgress] = useState(0);
  const [ttsMode, setTtsMode] = useState<TTSMode>('openai');
  const [errorMsg, setErrorMsg] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    // Positive-form gate — anonymous-private-data-gate contract requires
    // private reads to live inside the explicit signed-in branch.
    if (canUsePrivateData) {
      setDisplayName(loadProfileSettings().displayName || '');
      void refreshLocation(); // warm the location cache for the brief
      try {
        const cached = JSON.parse(localStorage.getItem(BRIEF_CACHE_KEY) || 'null') as BriefCache | null;
        if (cached?.date === todayKey() && cached.script) setCachedScript(cached.script);
      } catch { /* ignore */ }
    } else {
      setDisplayName('');
      setCachedScript('');
    }
  }, [canUsePrivateData]);

  function stopAll() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; audioRef.current = null; }
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null; }
    if (utteranceRef.current && typeof window !== 'undefined') { window.speechSynthesis?.cancel(); utteranceRef.current = null; }
  }

  // ── Browser SpeechSynthesis fallback ──────────────────────────────────────

  // Chrome 的 getVoices() 首次调用常为空(语音表异步加载),等 voiceschanged
  // 一小段时间再取,否则中文脚本可能落到默认英文音(QA P3 修复 2026-07-04)。
  function voicesReady(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      const now = synth.getVoices();
      if (now.length > 0) { resolve(now); return; }
      const timer = setTimeout(() => { synth.onvoiceschanged = null; resolve(synth.getVoices()); }, timeoutMs);
      synth.onvoiceschanged = () => { clearTimeout(timer); synth.onvoiceschanged = null; resolve(synth.getVoices()); };
    });
  }

  async function playWithBrowserTTS(script: string): Promise<void> {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setErrorMsg('语音不可用，请配置 OpenAI TTS 或使用支持语音的浏览器');
      setPlayState('error');
      return;
    }
    const voices = await voicesReady();
    return new Promise((resolve) => {
      setTtsMode('browser');
      track('brief_tts_fallback');
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(script);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.0;
      utterance.pitch = 1.05;

      const cnVoice = voices.find((v) => v.lang.startsWith('zh') || v.lang.includes('CN'));
      if (cnVoice) utterance.voice = cnVoice;

      utteranceRef.current = utterance;

      // Watchdog(QA P2 修复 2026-07-04):部分 WebView/无语音包设备上
      // speak() 后回调永不触发,UI 会停在无反馈状态——设计红线要求
      // 每个异步动作必有可见失败态。8s 内没开播就明确报错。
      const watchdog = setTimeout(() => {
        window.speechSynthesis.cancel();
        setErrorMsg('语音引擎没有响应，请稍后再试');
        setPlayState('error');
        resolve();
      }, 8000);

      utterance.onstart = () => {
        clearTimeout(watchdog);
        setPlayState('playing');
        // Simulate progress since SpeechSynthesis has no duration API
        let pct = 0;
        progressRef.current = setInterval(() => {
          pct = Math.min(pct + 1, 98);
          setProgress(pct);
        }, (script.length * 80) / 100); // rough estimate
      };
      utterance.onend = () => {
        setPlayState('done'); setProgress(100);
        if (progressRef.current) clearInterval(progressRef.current);
        resolve();
      };
      utterance.onerror = (e) => {
        clearTimeout(watchdog);
        if (e.error === 'interrupted') { resolve(); return; } // intentional stop
        setErrorMsg('浏览器语音播放失败');
        setPlayState('error');
        if (progressRef.current) clearInterval(progressRef.current);
        resolve();
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  // ── OpenAI TTS → fallback to browser ──────────────────────────────────────
  async function playScript(script: string) {
    setPlayState('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/portal/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script, voice: 'nova', speed: 1.05 }),
      });

      if (res.ok && res.headers.get('content-type')?.includes('audio')) {
        setTtsMode('openai');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onplay = () => {
          setPlayState('playing');
          progressRef.current = setInterval(() => {
            if (audio.duration) setProgress(Math.round((audio.currentTime / audio.duration) * 100));
          }, 300);
        };
        audio.onpause = () => { setPlayState('paused'); if (progressRef.current) clearInterval(progressRef.current); };
        audio.onended = () => {
          setPlayState('done'); setProgress(100);
          if (progressRef.current) clearInterval(progressRef.current);
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          // OpenAI audio failed mid-play — fall back to browser TTS
          void playWithBrowserTTS(script);
        };
        await audio.play();
        return;
      }

      // OpenAI TTS not available or returned error — use browser TTS
      await playWithBrowserTTS(script);
    } catch {
      await playWithBrowserTTS(script);
    }
  }

  async function generateAndPlay() {
    if (!canUsePrivateData) return;
    setPlayState('loading');
    setProgress(0);
    setErrorMsg('');

    const env = getEnvironment();
    const events: CalendarEvent[] = getCachedCalendarEvents();
    const emailHighlights = getEmailHighlights();
    const memoryNotes = getMemoryNotes();

    try {
      const res = await fetch('/api/portal/daily-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          weather: env.weather,
          location: env.location?.label || undefined,
          events, emailHighlights, memoryNotes,
        }),
      });
      const data = await res.json() as { ok?: boolean; script?: string };
      if (!data.ok || !data.script) {
        setErrorMsg('简报生成失败，请重试');
        setPlayState('error');
        return;
      }
      const script = data.script;
      try { localStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify({ date: todayKey(), script })); } catch { /* ignore */ }
      setCachedScript(script);
      await playScript(script);
    } catch {
      setErrorMsg('网络错误，请重试');
      setPlayState('error');
    }
  }

  function togglePause() {
    if (ttsMode === 'browser') {
      if (playState === 'playing') { window.speechSynthesis?.pause(); setPlayState('paused'); }
      else { window.speechSynthesis?.resume(); setPlayState('playing'); }
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (playState === 'playing') { audio.pause(); }
    else if (playState === 'paused') { audio.play(); setPlayState('playing'); }
  }

  function handlePlay() {
    if (!canUsePrivateData) {
      // 演示模式:先让人听到价值,再谈登录(网页测试问题 #1:曾无解释跳登录)
      track('brief_play', { state: 'demo' });
      if (playState === 'playing' || playState === 'paused') { togglePause(); return; }
      stopAll();
      setProgress(0);
      void playWithBrowserTTS(DEMO_BRIEF_SCRIPT);
      return;
    }
    track('brief_play', { state: playState });
    if (playState === 'playing') { togglePause(); return; }
    if (playState === 'paused') { togglePause(); return; }
    if (playState === 'error' || playState === 'done') {
      stopAll();
      setProgress(0);
      if (cachedScript) { void playScript(cachedScript); return; }
    }
    if (cachedScript && playState === 'idle') { stopAll(); setProgress(0); void playScript(cachedScript); return; }
    void generateAndPlay();
  }

  function handleRegenerate() {
    stopAll();
    setProgress(0);
    setCachedScript('');
    setErrorMsg('');
    try { localStorage.removeItem(BRIEF_CACHE_KEY); } catch { /* ignore */ }
    void generateAndPlay();
  }

  // ── Circular mode ──────────────────────────────────────────────────────────
  if (circular) {
    const isPlaying = playState === 'playing';
    const isLoading = playState === 'loading';
    const isPaused = playState === 'paused';
    const isError = playState === 'error';
    const isDone = playState === 'done';

    const icon = isPlaying
      ? <span className="nesio-brief-strip-wave nesio-brief-strip-wave--sm" aria-hidden>{Array.from({ length: 4 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}</span>
      : isLoading ? <IconClock size={18} />
      : isError ? <IconAlertTriangle size={18} />
      : isPaused ? <IconPlay size={18} />
      : isDone ? <IconRefresh size={18} />
      : <IconSpeaker size={18} />;

    const label = isPlaying ? '暂停'
      : isLoading ? '生成中'
      : isError ? '重试'
      : isPaused ? '继续'
      : isDone ? '重播'
      : '听简报';

    return (
      // flex:1 与右侧此刻按钮平分行宽(此前缺失导致左小右长,QA P3 修复)
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
        <button
          type="button"
          style={{ width: '100%' }}
          className={`nesio-brief-circle${isPlaying ? ' nesio-brief-circle--playing' : ''}${isError ? ' nesio-brief-circle--error' : ''}`}
          onClick={handlePlay}
          aria-label="听今日简报"
          disabled={isLoading}
        >
          <span className="nesio-brief-circle-icon" aria-hidden>{icon}</span>
          <span className="nesio-brief-circle-label">{label}</span>
        </button>

        {isError && errorMsg && (
          <p style={{ fontSize: '0.6rem', color: 'var(--status-risk)', marginTop: 3, textAlign: 'center', maxWidth: 80, lineHeight: 1.3 }}>{errorMsg}</p>
        )}

        {(isPlaying || isPaused || isDone) && (
          <div style={{ width: 56, marginTop: 4 }}>
            <div style={{ width: '100%', height: 3, background: 'rgba(88,140,227,0.15)', borderRadius: 2 }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--portal-blue-deep)', borderRadius: 2, transition: 'width 0.3s linear' }} />
            </div>
          </div>
        )}

        {isDone && (
          <button type="button" onClick={handleRegenerate} style={{ marginTop: 2, fontSize: '0.58rem', color: 'var(--portal-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
            重新生成
          </button>
        )}

        {ttsMode === 'browser' && (isPlaying || isDone) && (
          <p style={{ fontSize: '0.58rem', color: 'var(--portal-muted)', marginTop: 2 }}>系统语音</p>
        )}
      </div>
    );
  }

  // ── Strip mode ─────────────────────────────────────────────────────────────
  if (!canUsePrivateData) {
    return (
      <div className="nesio-brief-strip">
        <span className="nesio-brief-strip-label">
          {playState === 'playing' ? '▶ 示例简报播放中' : <><IconSpeaker size={13} /> 每日简报</>}
        </span>
        <button type="button" className="nesio-brief-strip-btn" onClick={handlePlay}>
          {playState === 'playing' ? '暂停' : '试听示例'}
        </button>
        <a href="/login" className="nesio-brief-strip-btn" style={{ opacity: 0.75 }}>登录听自己的</a>
      </div>
    );
  }

  return (
    <div className="nesio-brief-strip">
      <span className="nesio-brief-strip-label">
        {playState === 'playing' ? <><span className="nesio-brief-strip-wave" aria-hidden>{Array.from({ length: 4 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}</span>播放中</>
          : playState === 'done' ? '✓ 简报播放完毕'
          : playState === 'error' ? `${errorMsg || '语音暂不可用'}`
          : playState === 'paused' ? '已暂停'
          : <><IconSpeaker size={13} /> 听今日简报</>}
      </span>
      {playState === 'playing' ? (
        <button type="button" className="nesio-brief-strip-btn nesio-brief-strip-btn--stop" onClick={togglePause}>暂停</button>
      ) : playState === 'paused' ? (
        <button type="button" className="nesio-brief-strip-btn" onClick={togglePause}>继续</button>
      ) : (
        <button type="button" className="nesio-brief-strip-btn" disabled={playState === 'loading'}
          onClick={playState === 'done' || playState === 'error' ? handleRegenerate : handlePlay}>
          {playState === 'loading' ? '生成中…' : playState === 'done' ? '重新生成' : cachedScript ? '播放' : '生成简报'}
        </button>
      )}
    </div>
  );
}
