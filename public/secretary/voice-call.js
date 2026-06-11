/**
 * Live voice call — hold-to-talk (mobile) or auto-listen (desktop).
 */
function createLiveVoiceCall(options = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const overlay = options.overlayEl;
  const statusEl = options.statusEl;
  const transcriptEl = options.transcriptEl;
  const talkBtn = options.talkBtn;
  const avatarEl = options.avatarEl;
  const nameEl = options.nameEl;
  const waveEl = options.waveEl;
  const hangupBtn = options.hangupBtn;
  const onSend = options.onSend;
  const toast = options.toast || (() => {});

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const useHoldMode = isMobile || !SpeechRecognition;

  let active = false;
  let state = 'idle';
  let rec = null;
  let listening = false;
  let holdActive = false;
  let silenceTimer = null;
  let utterBuffer = '';
  let interimText = '';
  let lastFinalAt = 0;
  let starting = false;

  const SILENCE_MS = 1500;

  function setState(next) {
    state = next;
    if (statusEl) {
      const labels = {
        idle: useHoldMode ? '按住下方按钮说话' : '正在聆听，直接说话即可',
        listening: useHoldMode ? '正在听…松手发送' : '正在聆听…',
        thinking: '正在思考…',
        speaking: '正在说话…（可随时打断）',
      };
      statusEl.textContent = labels[next] || next;
    }
    if (waveEl) waveEl.dataset.state = next;
    if (talkBtn) {
      talkBtn.classList.toggle('wx-voice-call-talk--on', next === 'listening');
      talkBtn.textContent = next === 'listening' ? '松开发送' : '按住说话';
    }
  }

  function updateTranscript(text) {
    if (transcriptEl) transcriptEl.textContent = text || '';
  }

  function clearSilenceTimer() {
    if (silenceTimer) {
      window.clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function scheduleSendCheck() {
    if (useHoldMode) return;
    clearSilenceTimer();
    silenceTimer = window.setTimeout(() => {
      if (!active || state === 'thinking' || holdActive) return;
      const text = utterBuffer.trim();
      if (!text) return;
      if (Date.now() - lastFinalAt < SILENCE_MS - 80) return;
      void flushAndSend(text);
    }, SILENCE_MS);
  }

  async function flushAndSend(text) {
    if (!active || !text.trim()) return;
    utterBuffer = '';
    interimText = '';
    updateTranscript('');
    clearSilenceTimer();
    safeStopRec();

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
      if (!useHoldMode) beginListening();
      else setState('idle');
      return;
    }

    const reply = String(result.reply || '').trim();
    if (!reply) {
      if (!useHoldMode) beginListening();
      else setState('idle');
      return;
    }

    setState('speaking');
    window.WxVoice?.stopSpeaking?.();
    await window.WxVoice?.speakTextAsync?.(reply, { lang: 'zh-CN' });
    if (!active) return;
    if (!useHoldMode) beginListening();
    else setState('idle');
  }

  function safeStopRec() {
    if (!rec || !listening) return;
    listening = false;
    try {
      rec.stop();
    } catch { /* ignore */ }
  }

  function safeStartRec() {
    if (!rec || listening || starting) return;
    starting = true;
    window.setTimeout(() => {
      starting = false;
    }, 400);
    try {
      rec.start();
      listening = true;
    } catch (err) {
      listening = false;
      const msg = String(err?.message || err || '');
      if (/already|started/i.test(msg)) {
        listening = true;
        return;
      }
      window.setTimeout(() => {
        if (!active || listening) return;
        try {
          rec.start();
          listening = true;
        } catch {
          toast('无法启动麦克风，请重试');
        }
      }, 350);
    }
  }

  function beginListening() {
    if (!active || !rec || useHoldMode) return;
    if (state === 'thinking') return;
    utterBuffer = '';
    interimText = '';
    updateTranscript('');
    setState('listening');
    safeStartRec();
  }

  function handleResults(event) {
    if (!active) return;

    if (state === 'speaking') {
      window.WxVoice?.stopSpeaking?.();
      utterBuffer = '';
      setState('listening');
    }

    let finals = '';
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      const t = r[0]?.transcript || '';
      if (r.isFinal) finals += t;
      else interim += t;
    }

    if (finals) {
      utterBuffer = utterBuffer ? `${utterBuffer} ${finals}` : finals;
      lastFinalAt = Date.now();
      if (!useHoldMode) scheduleSendCheck();
    }

    interimText = interim;
    const shown = `${utterBuffer}${interimText ? (utterBuffer ? ' ' : '') + interimText : ''}`.trim();
    updateTranscript(shown || '…');
  }

  function setupRecognition() {
    if (!SpeechRecognition) return false;
    rec = new SpeechRecognition();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = !useHoldMode;

    rec.onresult = handleResults;

    rec.onerror = (e) => {
      const err = e.error;
      if (err === 'not-allowed') toast('请允许麦克风权限');
      else if (err === 'network') toast('语音识别需要网络连接');
      else if (err !== 'aborted' && err !== 'no-speech') toast('语音识别中断，请重试');
      listening = false;
    };

    rec.onend = () => {
      listening = false;
      if (!active || useHoldMode || holdActive) return;
      if (state === 'listening' || state === 'speaking') {
        window.setTimeout(() => {
          if (active && !holdActive && state !== 'thinking') safeStartRec();
        }, 300);
      }
    };

    return true;
  }

  async function ensureMicAccess() {
    if (!navigator.mediaDevices?.getUserMedia) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      toast('需要麦克风权限才能语音通话');
      return false;
    }
  }

  function bindTalkButton() {
    if (!talkBtn) return;

    const onDown = (e) => {
      e.preventDefault();
      if (!active || state === 'thinking' || state === 'speaking') return;
      holdActive = true;
      utterBuffer = '';
      interimText = '';
      updateTranscript('');
      setState('listening');
      safeStartRec();
    };

    const onUp = () => {
      if (!holdActive) return;
      holdActive = false;
      safeStopRec();
      const text = `${utterBuffer} ${interimText}`.trim();
      if (text) void flushAndSend(text);
      else setState('idle');
    };

    talkBtn.addEventListener('pointerdown', onDown);
    talkBtn.addEventListener('pointerup', onUp);
    talkBtn.addEventListener('pointerleave', onUp);
    talkBtn.addEventListener('pointercancel', onUp);
  }

  async function open(friend) {
    if (!SpeechRecognition) {
      toast('当前浏览器不支持语音对话，请用 Chrome 或 Safari');
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

    const micOk = await ensureMicAccess();
    if (!micOk) return false;

    active = true;
    if (overlay) overlay.hidden = false;
    if (friend) {
      if (avatarEl && friend.logo) {
        const root = options.withRoot || ((p) => p);
        avatarEl.src = root(friend.logo);
        avatarEl.alt = friend.name || '';
      }
      if (nameEl) nameEl.textContent = friend.name || '智友';
    }
    document.body.classList.add('wx-voice-call-open');

    if (useHoldMode) setState('idle');
    else beginListening();
    return true;
  }

  function close() {
    active = false;
    holdActive = false;
    clearSilenceTimer();
    safeStopRec();
    window.WxVoice?.stopSpeaking?.();
    utterBuffer = '';
    interimText = '';
    updateTranscript('');
    setState('idle');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('wx-voice-call-open');
  }

  if (hangupBtn) hangupBtn.addEventListener('click', close);
  bindTalkButton();

  return { open, close, isActive: () => active };
}

window.WxVoiceCall = { createLiveVoiceCall };
