/**
 * Native-style Live voice — tap to join, always-on turn-taking, tap orb to interrupt.
 */
function createLiveVoiceCall(options = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const overlay = options.overlayEl;
  const statusEl = options.statusEl;
  const transcriptEl = options.transcriptEl;
  const orbEl = options.orbEl;
  const avatarEl = options.avatarEl;
  const nameEl = options.nameEl;
  const hangupBtn = options.hangupBtn;
  const onSend = options.onSend;
  const toast = options.toast || (() => {});

  let active = false;
  let state = 'connecting';
  let rec = null;
  let listening = false;
  let recStarting = false;
  let micStream = null;
  let stopMeter = null;
  let silenceTimer = null;
  let utterBuffer = '';
  let interimText = '';
  let lastSpeechAt = 0;

  const SILENCE_MS = 1100;
  const MIN_CHARS = 2;

  function setState(next) {
    state = next;
    if (statusEl) {
      const labels = {
        connecting: '正在连接…',
        listening: '请说话',
        thinking: '思考中…',
        speaking: '点击光球可打断',
      };
      statusEl.textContent = labels[next] || next;
    }
    if (orbEl) orbEl.dataset.state = next;
  }

  function setOrbLevel(level) {
    if (!orbEl || state !== 'listening') return;
    const scale = 1 + Math.min(level * 0.45, 0.35);
    orbEl.style.setProperty('--wx-orb-scale', String(scale));
  }

  function updateTranscript(text, role) {
    if (!transcriptEl) return;
    if (!text) {
      transcriptEl.textContent = '';
      transcriptEl.dataset.role = '';
      return;
    }
    transcriptEl.dataset.role = role || 'user';
    transcriptEl.textContent = text;
  }

  function clearSilenceTimer() {
    if (silenceTimer) {
      window.clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function currentText() {
    return `${utterBuffer}${interimText ? (utterBuffer ? ' ' : '') + interimText : ''}`.trim();
  }

  function scheduleEndOfTurn() {
    clearSilenceTimer();
    silenceTimer = window.setTimeout(() => {
      if (!active || state !== 'listening') return;
      const text = currentText();
      if (!text || text.length < MIN_CHARS) return;
      if (Date.now() - lastSpeechAt < SILENCE_MS - 60) return;
      void flushAndSend(text);
    }, SILENCE_MS);
  }

  function pauseListening() {
    clearSilenceTimer();
    safeStopRec();
    utterBuffer = '';
    interimText = '';
  }

  async function flushAndSend(text) {
    if (!active || !text.trim()) return;
    pauseListening();
    updateTranscript(text.trim(), 'user');

    setState('thinking');
    let result = { ok: false };
    try {
      result = await onSend(text.trim());
    } catch {
      result = { ok: false, error: '网络异常' };
    }

    if (!active) return;

    if (!result.ok) {
      toast(result.error || '发送失败');
      resumeListening();
      return;
    }

    const reply = String(result.reply || '').trim();
    if (!reply) {
      resumeListening();
      return;
    }

    updateTranscript(reply, 'assistant');
    setState('speaking');
    window.WxVoice?.stopSpeaking?.();
    await window.WxVoice?.speakLiveText?.(reply, { lang: 'zh-CN' });
    if (!active) return;
    resumeListening();
  }

  function interruptSpeaking() {
    if (state !== 'speaking') return;
    window.WxVoice?.stopSpeaking?.();
    resumeListening();
  }

  function safeStopRec() {
    if (!rec || !listening) return;
    listening = false;
    try {
      rec.stop();
    } catch { /* ignore */ }
  }

  function safeStartRec(allowSpeaking) {
    if (!rec || !active || listening || recStarting) return;
    if (state !== 'listening' && !(allowSpeaking && state === 'speaking')) return;

    recStarting = true;
    window.setTimeout(() => {
      recStarting = false;
    }, 320);

    try {
      rec.start();
      listening = true;
    } catch {
      listening = false;
      window.setTimeout(() => {
        if (!active || state !== 'listening' || listening) return;
        try {
          rec.start();
          listening = true;
        } catch {
          toast('麦克风繁忙，请稍候再试');
        }
      }, 400);
    }
  }

  function resumeListening() {
    if (!active) return;
    utterBuffer = '';
    interimText = '';
    setState('listening');
    safeStartRec();
  }

  function handleResults(event) {
    if (!active) return;

    let finals = '';
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      const t = r[0]?.transcript || '';
      if (!t) continue;
      if (r.isFinal) finals += t;
      else interim += t;
    }

    if (state === 'speaking' && (finals || interim.trim().length >= MIN_CHARS)) {
      interruptSpeaking();
    }

    if (state !== 'listening') return;

    if (finals) {
      utterBuffer = utterBuffer ? `${utterBuffer} ${finals}` : finals;
      lastSpeechAt = Date.now();
      scheduleEndOfTurn();
    }

    interimText = interim;
    const shown = currentText();
    updateTranscript(shown || '…', 'user');
    if (interim.trim()) {
      lastSpeechAt = Date.now();
      scheduleEndOfTurn();
    }
  }

  function setupRecognition() {
    if (!SpeechRecognition) return false;
    rec = new SpeechRecognition();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onresult = handleResults;

    rec.onerror = (e) => {
      const err = e.error;
      if (err === 'not-allowed') toast('请允许麦克风权限');
      else if (err === 'network') toast('语音识别需要网络');
      else if (err !== 'aborted' && err !== 'no-speech') toast('语音识别中断');
      listening = false;
    };

    rec.onend = () => {
      listening = false;
      if (active && (state === 'listening' || state === 'speaking')) {
        window.setTimeout(() => safeStartRec(state === 'speaking'), 120);
      }
    };

    return true;
  }

  async function openMic() {
    if (!navigator.mediaDevices?.getUserMedia) return true;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stopMeter = window.WxVoice?.createMicMeter?.(micStream, setOrbLevel) || (() => {});
      return true;
    } catch {
      toast('需要麦克风权限才能 Live 对话');
      return false;
    }
  }

  async function open(friend) {
    if (!SpeechRecognition) {
      toast('请使用 Safari 或 Chrome 进行 Live 对话');
      return false;
    }
    if (!rec && !setupRecognition()) {
      toast('无法初始化语音识别');
      return false;
    }
    if (typeof onSend !== 'function') {
      toast('对话未就绪');
      return false;
    }

    active = true;
    setState('connecting');
    if (overlay) overlay.hidden = false;
    document.body.classList.add('wx-voice-call-open');

    if (friend) {
      if (avatarEl && friend.logo) {
        const root = options.withRoot || ((p) => p);
        avatarEl.src = root(friend.logo);
        avatarEl.alt = friend.name || '';
      }
      if (nameEl) nameEl.textContent = friend.name || '智友';
    }

    window.WxVoice?.primeSpeech?.();

    const micOk = await openMic();
    if (!micOk) {
      close();
      return false;
    }

    resumeListening();
    return true;
  }

  function close() {
    active = false;
    pauseListening();
    window.WxVoice?.stopSpeaking?.();
    if (stopMeter) stopMeter();
    stopMeter = null;
    micStream = null;
    updateTranscript('');
    setState('connecting');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('wx-voice-call-open');
  }

  if (hangupBtn) hangupBtn.addEventListener('click', close);
  if (orbEl) {
    orbEl.addEventListener('click', () => {
      if (state === 'speaking') interruptSpeaking();
    });
  }

  return { open, close, isActive: () => active };
}

window.WxVoiceCall = { createLiveVoiceCall };
