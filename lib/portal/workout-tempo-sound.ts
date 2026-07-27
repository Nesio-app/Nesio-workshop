/**
 * 跟练节拍音 —— HTMLAudioElement 短 WAV,绝不碰振荡器上下文 / 震动马达。
 *
 * 历史:壳内 WebView 里首次激活音频硬件(振荡器上下文 / HTMLAudio / 震动马达皆然)可能
 * 同步阻塞主线程且不返回 → 「一点跟拍做永久卡死」。所以:
 *  1) 只用预加载短 WAV + HTMLAudioElement.play()
 *  2) 原生壳(Capacitor)与 Android WebView 默认静音(视觉节拍仍在);桌面/普通浏览器放行
 *  3) play() 一律丢进宏任务,先让 UI setState 落盘,再尽力播;失败静默
 *  4) 可用 localStorage `nesio-workout-sound-force-v1=1` 强制开声(真机自测用)
 */

import { isNativePlatform } from './platform-capabilities';

const FORCE_KEY = 'nesio-workout-sound-force-v1';
const TICK_SRC = '/assets/sounds/workout-tick.wav';
const DING_SRC = '/assets/sounds/workout-ding.wav';

let tickEl: HTMLAudioElement | null = null;
let dingEl: HTMLAudioElement | null = null;
let primed = false;
let disabled = false;

function forceEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(FORCE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 是否允许尝试播节拍音(不安全环境默认 false,避免再卡死)。 */
export function isWorkoutTempoSoundAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  if (disabled) return false;
  if (forceEnabled()) return true;
  if (isNativePlatform()) return false;
  const ua = navigator.userAgent || '';
  // Android System WebView —— 历史卡死主场
  if (/Android/i.test(ua) && /; wv\)/i.test(ua)) return false;
  return true;
}

function ensureEls(): void {
  if (typeof window === 'undefined' || tickEl) return;
  try {
    tickEl = new Audio(TICK_SRC);
    dingEl = new Audio(DING_SRC);
    tickEl.preload = 'auto';
    dingEl.preload = 'auto';
    tickEl.setAttribute('aria-hidden', 'true');
    dingEl.setAttribute('aria-hidden', 'true');
  } catch {
    tickEl = null;
    dingEl = null;
    disabled = true;
  }
}

/** 挂载跟练时预热(宏任务,不挡首帧)。不安全环境直接跳过。 */
export function warmupWorkoutTempoSound(): void {
  if (!isWorkoutTempoSoundAllowed()) return;
  setTimeout(() => {
    try {
      ensureEls();
      void tickEl?.load();
      void dingEl?.load();
    } catch {
      /* 预热失败 = 没声,不影响跟练 */
    }
  }, 0);
}

/**
 * 播一拍。freq≥1200 → 完成 ding,否则 tick。
 * 永远异步、永不抛;调用方应先改 UI 再 ping。
 */
export function playWorkoutTempo(freq: number): void {
  if (!isWorkoutTempoSoundAllowed()) return;
  // 丢进宏任务:点击路径上的 setState 先提交,play 哪怕慢也不挡那一帧。
  setTimeout(() => {
    if (disabled) return;
    try {
      ensureEls();
      const el = freq >= 1200 ? dingEl : tickEl;
      if (!el) return;
      el.currentTime = 0;
      const p = el.play();
      primed = true;
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          /* 自动播放策略/解码失败 → 静默 */
        });
      }
    } catch {
      /* 声音尽力而为 */
    }
  }, 0);
}

/** 用户手势内解锁(跟拍/计时按钮点击时调一次)。 */
export function unlockWorkoutTempoSound(): void {
  if (!isWorkoutTempoSoundAllowed()) return;
  try {
    ensureEls();
    if (!tickEl || primed) return;
    // 静音瞬时 play→pause 解锁媒体会话(iOS Safari);失败忽略。
    const el = tickEl;
    const prev = el.volume;
    el.volume = 0.001;
    const p = el.play();
    const finish = () => {
      try {
        el.pause();
        el.currentTime = 0;
        el.volume = prev;
        primed = true;
      } catch { /* ignore */ }
    };
    if (p && typeof p.then === 'function') p.then(finish).catch(finish);
    else finish();
  } catch {
    /* ignore */
  }
}
