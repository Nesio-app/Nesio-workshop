function createVoiceInput(inputEl, btnEl) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    btnEl.addEventListener('click', () => {
      window.WxCommon?.toast('当前浏览器不支持语音输入');
    });
    return { supported: false };
  }

  const rec = new SpeechRecognition();
  rec.lang = 'zh-CN';
  rec.interimResults = true;
  rec.continuous = false;
  let listening = false;

  rec.onresult = (event) => {
    let text = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    if (text) {
      const base = inputEl.value.trim();
      inputEl.value = base ? base + text : text;
      inputEl.dispatchEvent(new Event('input'));
    }
  };

  rec.onerror = (e) => {
    listening = false;
    btnEl.classList.remove('wx-mic--on');
    const err = e.error;
    if (err === 'not-allowed') {
      window.WxCommon?.toast('请允许麦克风权限后重试');
    } else if (err !== 'aborted') {
      window.WxCommon?.toast('语音识别失败，请重试');
    }
  };

  rec.onend = () => {
    listening = false;
    btnEl.classList.remove('wx-mic--on');
  };

  btnEl.addEventListener('click', () => {
    if (listening) {
      rec.stop();
      return;
    }
    try {
      listening = true;
      btnEl.classList.add('wx-mic--on');
      rec.start();
      window.WxCommon?.toast('正在听…');
    } catch {
      listening = false;
      btnEl.classList.remove('wx-mic--on');
      window.WxCommon?.toast('无法启动语音识别');
    }
  });

  return { supported: true };
}

window.WxVoice = { createVoiceInput };
