// 音效 + 背景音乐（Web Audio + 免版权音源）
const BGM_TRACKS = [
  { id: 'off', name: '关闭', url: '' },
  { id: 'pulse', name: '🔥 燃脂节奏', url: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_8cb749e9b2.mp3?filename=deep-abstract-ambient_snowcap-401656.mp3' },
  { id: 'flow', name: '🌊 流动训练', url: 'https://cdn.pixabay.com/download/audio/2022/03/24/audio_3d505d7c16.mp3?filename=lofi-study-112191.mp3' },
  { id: 'focus', name: '⚡ 专注爆发', url: 'https://cdn.pixabay.com/download/audio/2021/08/04/audio_12b0c1403c.mp3?filename=tech-house-vibes-110241.mp3' },
  { id: 'calm', name: '🌿 恢复拉伸', url: 'https://cdn.pixabay.com/download/audio/2022/10/25/audio_7b0c1403c12.mp3?filename=meditation-relaxing-music-346733.mp3' },
];

const AudioEngine = (() => {
  let ctx = null;
  let bgmAudio = null;
  let bgmId = 'off';
  let enabled = true;
  let sfxVol = 0.7;
  let bgmVol = 0.35;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function resume() {
    const c = getCtx();
    if (c.state === 'suspended') c.resume();
  }

  function beep(freq, dur, type = 'sine', vol = sfxVol) {
    if (!enabled) return;
    resume();
    const c = getCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol * 0.15, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  }

  function playTick() { beep(880, 0.08, 'square'); }
  function playCount(n) {
    if (n <= 0) { beep(523, 0.15); beep(659, 0.15); beep(784, 0.35, 'triangle'); return; }
    beep(n === 1 ? 784 : 660, 0.18, 'triangle');
  }
  function playGo() { beep(880, 0.12); setTimeout(() => beep(1175, 0.35, 'triangle'), 120); }
  function playRep() { beep(440, 0.06, 'sine', sfxVol * 0.6); }
  function playRestEnd() { beep(392, 0.2); setTimeout(() => beep(523, 0.35), 180); }
  function playSetDone() { beep(523, 0.15); setTimeout(() => beep(659, 0.15), 120); setTimeout(() => beep(784, 0.4), 240); }
  function playPhase(phase) {
    if (phase === 'down') beep(330, 0.05, 'sine', sfxVol * 0.4);
    else if (phase === 'up') beep(495, 0.05, 'sine', sfxVol * 0.4);
  }

  function setBgm(id) {
    bgmId = id;
    if (bgmAudio) { bgmAudio.pause(); bgmAudio = null; }
    const track = BGM_TRACKS.find((t) => t.id === id);
    if (!track?.url || !enabled) return;
    bgmAudio = new Audio(track.url);
    bgmAudio.loop = true;
    bgmAudio.volume = bgmVol;
    bgmAudio.play().catch(() => {});
  }

  function toggleBgm() {
    if (bgmAudio) {
      if (bgmAudio.paused) bgmAudio.play();
      else bgmAudio.pause();
    }
  }

  function setEnabled(on) { enabled = on; if (!on && bgmAudio) bgmAudio.pause(); }
  function setBgmVol(v) { bgmVol = v; if (bgmAudio) bgmAudio.volume = v; }
  function setSfxVol(v) { sfxVol = v; }

  return {
    BGM_TRACKS, playTick, playCount, playGo, playRep, playRestEnd, playSetDone, playPhase,
    setBgm, toggleBgm, setEnabled, setBgmVol, setSfxVol, resume, get bgmId() { return bgmId; },
  };
})();
