/**
 * Live voice conversation — listen → send → speak → listen (like ChatGPT voice).
 */
function createLiveVoiceCall(options = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const overlay = options.overlayEl;
  const statusEl = options.statusEl;
  const avatarEl = options.avatarEl;
  const nameEl = options.nameEl;
  const waveEl = options.waveEl;
  const hangupBtn = options.hangupBtn;
  const onSend = options.onSend;
  const toast = options.toast || (() => {});

  let active = false;
  let state = 'idle';
  let rec = null;
  let listening = false;
  let silenceTimer = null;
  let utterBuffer = '';
  let lastFinalAt = 0;

  const SILENCE_MS = 1400;

  function setState(next) {
    state = next;
    if (statusEl) {
      const labels = {
        idle: '轻触下方开始说话',
        listening: '正在聆听…',
        thinking: '正在思考…',
        speaking: '正在说话…（可随时打断）',
      };
      statusEl.textContent = labels[next] || next;
    }
    if (waveEl) {
      waveEl.dataset.state = next;
    }
  }

  function clearSilenceTimer() {
    if (silenceTimer) {
      window.clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function scheduleSendCheck() {
    clearSilenceTimer();
    silenceTimer = window.setTimeout(() => {
      if (!active || state === 'thinking') return;
      const text = utterBuffer.trim();
      if (!text) return;
      if (Date.now() - lastFinalAt < SILENCE_MS - 80) return;
      void flushAndSend(text);
    }, SILENCE_MS);
  }

  async function flushAndSend(text) {
    if (!active || !text.trim()) return;
    utterBuffer = '';
    clearSilenceTimer();
    stopListening();

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
      beginListening();
      return;
    }

    const reply = String(result.reply || '').trim();
    if (!reply) {
      beginListening();
      return;
    }

    setState('speaking');
    window.WxVoice?.stopSpeaking?.();
    await window.WxVoice?.speakTextAsync?.(reply, { lang: 'zh-CN' });
    if (active) beginListening();
  }

  function stopListening() {
    listening = false;
    if (!rec) return;
    try {
      rec.stop();
    } catch { /* ignore */ }
  }

  function beginListening() {
    if (!active || !rec) return;
    if (state === 'thinking') return;
    utterBuffer = '';
    setState('listening');
    if (listening) return;
    try {
      rec.start();
      listening = true;
    } catch {
      listening = false;
      toast('无法启动麦克风，请重试');
    }
  }

  function setupRecognition() {
    if (!SpeechRecognition) return false;
    rec = new SpeechRecognition();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = true;

    rec.onresult = (event) => {
      if (!active) return;

      if (state === 'speaking') {
        window.WxVoice?.stopSpeaking?.();
        utterBuffer = '';
        setState('listening');
      }

      let finals = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finals += r[0].transcript;
      }
      if (!finals) return;

      utterBuffer = utterBuffer ? `${utterBuffer} ${finals}` : finals;
      lastFinalAt = Date.now();
      scheduleSendCheck();
    };

    rec.onerror = (e) => {
      const err = e.error;
      if (err === 'not-allowed') toast('请允许麦克风权限');
      else if (err !== 'aborted' && err !== 'no-speech') toast('语音识别中断');
      listening = false;
    };

    rec.onend = () => {
      listening = false;
      if (active && (state === 'listening' || state === 'speaking')) {
        window.setTimeout(() => {
          if (active && state !== 'thinking') beginListening();
        }, 280);
      }
    };

    return true;
  }

  function open(friend) {
    if (!SpeechRecognition) {
      toast('当前浏览器不支持语音对话，请用 Chrome / Safari');
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
    beginListening();
    return true;
  }

  function close() {
    active = false;
    clearSilenceTimer();
    stopListening();
    window.WxVoice?.stopSpeaking?.();
    utterBuffer = '';
    setState('idle');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('wx-voice-call-open');
  }

  if (hangupBtn) hangupBtn.addEventListener('click', close);

  return { open, close, isActive: () => active };
}

window.WxVoiceCall = { createLiveVoiceCall };
