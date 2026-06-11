function createVoiceInput(inputEl, btnEl, options = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const holdMode = options.holdToTalk !== false;

  if (!SpeechRecognition) {
    btnEl.addEventListener('click', () => {
      window.WxCommon?.toast('当前浏览器不支持语音输入，请改用文字');
    });
    return { supported: false };
  }

  const rec = new SpeechRecognition();
  rec.lang = 'zh-CN';
  rec.interimResults = true;
  rec.continuous = true;
  let listening = false;
  let holdActive = false;
  let baseText = '';

  function stopListening() {
    if (!listening) return;
    listening = false;
    holdActive = false;
    btnEl.classList.remove('wx-mic--on');
    try {
      rec.stop();
    } catch { /* ignore */ }
  }

  function startListening(fromHold) {
    if (listening) return;
    baseText = inputEl.value.trim();
    listening = true;
    holdActive = Boolean(fromHold);
    btnEl.classList.add('wx-mic--on');
    try {
      rec.start();
      if (!fromHold) window.WxCommon?.toast('正在听…再次点击结束');
    } catch {
      listening = false;
      holdActive = false;
      btnEl.classList.remove('wx-mic--on');
      window.WxCommon?.toast('无法启动语音识别');
    }
  }

  rec.onresult = (event) => {
    let chunk = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) chunk += event.results[i][0].transcript;
    }
    if (!chunk) return;
    inputEl.value = baseText ? `${baseText} ${chunk}` : chunk;
    inputEl.dispatchEvent(new Event('input'));
  };

  rec.onerror = (e) => {
    const err = e.error;
    if (err === 'not-allowed') {
      window.WxCommon?.toast('请在浏览器设置中允许麦克风');
    } else if (err !== 'aborted' && err !== 'no-speech') {
      window.WxCommon?.toast('语音识别失败，请重试');
    }
    stopListening();
  };

  rec.onend = () => {
    if (holdActive) {
      try {
        rec.start();
        return;
      } catch { /* fall through */ }
    }
    listening = false;
    holdActive = false;
    btnEl.classList.remove('wx-mic--on');
  };

  if (holdMode) {
    const onDown = (e) => {
      e.preventDefault();
      startListening(true);
    };
    const onUp = () => stopListening();

    btnEl.addEventListener('pointerdown', onDown);
    btnEl.addEventListener('pointerup', onUp);
    btnEl.addEventListener('pointerleave', onUp);
    btnEl.addEventListener('pointercancel', onUp);
  }

  btnEl.addEventListener('click', (e) => {
    if (holdMode) {
      e.preventDefault();
      return;
    }
    if (listening) stopListening();
    else startListening(false);
  });

  return { supported: true, stop: stopListening, start: () => startListening(false) };
}

let voiceCallMode = false;

function speakText(text, options = {}) {
  const synth = window.speechSynthesis;
  if (!synth || !text?.trim()) return false;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text.trim());
  utter.lang = options.lang || 'zh-CN';
  utter.rate = options.rate ?? 1;
  utter.pitch = options.pitch ?? 1;
  synth.speak(utter);
  return true;
}

function setVoiceCallMode(on) {
  voiceCallMode = Boolean(on);
  if (!voiceCallMode) window.speechSynthesis?.cancel();
  return voiceCallMode;
}

function isVoiceCallMode() {
  return voiceCallMode;
}

function stopSpeaking() {
  window.speechSynthesis?.cancel();
}

window.WxVoice = {
  createVoiceInput,
  speakText,
  setVoiceCallMode,
  isVoiceCallMode,
  stopSpeaking,
};
