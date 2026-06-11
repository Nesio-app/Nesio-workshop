(function bootChat() {
  if (!window.WxCommon) {
    requestAnimationFrame(bootChat);
    return;
  }

  const {
    withRoot,
    esc,
    toast,
    loadFriends,
    memberById,
    saveNoteEntry,
    loadFavoriteQuotes,
  } = window.WxCommon;

const params = new URLSearchParams(location.search);
const friendId = params.get('friend') || 'gemini';

const main = document.getElementById('chatMain');
const form = document.getElementById('chatForm');
const input = document.getElementById('chatInput');
const btnClear = document.getElementById('btnClear');
const btnPlus = document.getElementById('btnPlus');
const btnMic = document.getElementById('btnMic');
const navTitle = document.getElementById('navTitle');
const navAvatar = document.getElementById('navAvatar');

const STORAGE_KEY = `treasurebox-chat-${friendId}`;
const USER_AVATAR = '婧';

let friend = null;
let history = [];
let busy = false;

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) history = JSON.parse(raw);
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-80)));
  } catch { /* ignore */ }
}

function makeRow(turn) {
  const role = turn.role;
  const row = document.createElement('div');
  row.className = 'wx-msg wx-msg--' + role;

  if (role === 'assistant' && friend?.logo) {
    const av = document.createElement('img');
    av.className = 'wx-msg-avatar';
    av.src = withRoot(friend.logo);
    av.alt = friend.name;
    row.appendChild(av);
  } else if (role === 'user') {
    const av = document.createElement('div');
    av.className = 'wx-msg-avatar wx-msg-avatar--user';
    av.textContent = USER_AVATAR;
    row.appendChild(av);
  }

  const bubble = document.createElement('div');
  bubble.className = 'wx-msg-bubble' + (turn.extraClass ? ' ' + turn.extraClass : '');
  bubble.innerHTML = esc(turn.content);
  row.appendChild(bubble);
  return row;
}

function scrollBottom() {
  main.scrollTop = main.scrollHeight;
}

function render() {
  main.innerHTML = '';
  if (history.length === 0 && friend) {
    const tip = document.createElement('p');
    tip.className = 'wx-chat-tip';
    tip.textContent = friend.preview;
    main.appendChild(tip);
    scrollBottom();
    return;
  }
  for (const turn of history) {
    main.appendChild(makeRow(turn));
  }
  scrollBottom();
}

function showError(text) {
  const el = document.createElement('div');
  el.className = 'wx-msg-bubble wx-msg-bubble--error';
  el.textContent = text;
  main.appendChild(el);
  scrollBottom();
}

async function sendMessage(text) {
  if (busy || !text.trim()) return;

  if (!friend?.ready) {
    showError(`${friend?.name || '该模型'} 尚未接入，正在为你打开 Gemini…`);
    window.setTimeout(() => {
      location.href = '/secretary/chat?friend=gemini';
    }, 900);
    return;
  }

  busy = true;
  input.disabled = true;

  history.push({ role: 'user', content: text.trim() });
  saveHistory();
  render();

  const pending = makeRow({ role: 'assistant', content: '对方正在输入…', extraClass: 'wx-msg-bubble--pending' });
  main.appendChild(pending);
  scrollBottom();

  try {
    const { ok, data } = await sendSecretaryMessage(text.trim(), history.slice(0, -1), friendId);

    pending.remove();

    if (!ok) {
      const detail = data.detail || data.error || data.hint || '请求失败';
      showError('暂时无法回应：' + detail);
      history.pop();
      saveHistory();
      render();
      return;
    }

    const reply = String(data.text || '').trim() || '（没有收到有效回复）';
    history.push({ role: 'assistant', content: reply });
    saveHistory();
    render();
  } catch (err) {
    pending.remove();
    showError('网络异常：' + (err?.message || '请检查网络'));
    history.pop();
    saveHistory();
    render();
  } finally {
    busy = false;
    input.disabled = false;
    input.focus();
  }
}

function resizeInput() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}

const pickPhoto = document.getElementById('pickPhoto');
const pickFile = document.getElementById('pickFile');
const pickVideo = document.getElementById('pickVideo');

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function sendAttachmentMessage(label, extra) {
  const text = `[${label}]${extra ? ' ' + extra : ''}`;
  await sendMessage(text);
}

const attachHandlers = {
  photo: () => pickPhoto.click(),
  file: () => pickFile.click(),
  video: () => pickVideo.click(),
  voice: () => toast('按住左侧麦克风说话'),
  call: () => toast('语音通话功能开发中'),
  note: () => {
    const text = input.value.trim() || prompt('写入 Note 的内容');
    if (!text) return;
    if (saveNoteEntry('chat', text, friend?.name || '智友')) toast('已存入 Note');
    else toast('保存失败');
  },
  favorite: () => {
    const favs = loadFavoriteQuotes();
    if (!favs.length) {
      toast('暂无收藏，可在宝盒首页点 ☆ 收藏语录');
      return;
    }
    const pick = favs[0];
    input.value = pick;
    input.dispatchEvent(new Event('input'));
    toast('已插入收藏语录');
  },
  location: () => {
    if (!navigator.geolocation) {
      toast('无法获取位置');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        input.value = `位置：${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        input.dispatchEvent(new Event('input'));
      },
      () => toast('定位被拒绝'),
    );
  },
};

pickPhoto.addEventListener('change', async () => {
  const file = pickPhoto.files?.[0];
  pickPhoto.value = '';
  if (!file) return;
  if (file.size > 2_800_000) {
    toast('图片过大');
    return;
  }
  const data = await readFile(file);
  saveNoteEntry('image', file.name, friend?.name, [{ type: 'image', url: data, name: file.name }]);
  await sendAttachmentMessage('图片', file.name);
});

pickFile.addEventListener('change', async () => {
  const file = pickFile.files?.[0];
  pickFile.value = '';
  if (!file) return;
  if (file.size > 2_800_000) {
    toast('文件过大');
    return;
  }
  const data = await readFile(file);
  saveNoteEntry('file', file.name, friend?.name, [{ type: 'file', url: data, name: file.name }]);
  await sendAttachmentMessage('文件', file.name);
});

pickVideo.addEventListener('change', async () => {
  const file = pickVideo.files?.[0];
  pickVideo.value = '';
  if (!file) return;
  if (file.size > 5_000_000) {
    toast('视频过大');
    return;
  }
  await sendAttachmentMessage('视频', file.name);
});

const attach = window.WxAttach.mountAttachSheet(
  document.getElementById('attachSheet'),
  document.getElementById('attachMask'),
  document.getElementById('attachGrid'),
  attachHandlers,
);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  resizeInput();
  void sendMessage(text);
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener('input', resizeInput);

btnClear.addEventListener('click', () => {
  if (busy) return;
  if (history.length && !confirm('清空与 ' + (friend?.name || '') + ' 的对话？')) return;
  history = [];
  saveHistory();
  render();
});

btnPlus.addEventListener('click', () => attach.open());

try {
  window.WxVoice?.createVoiceInput(input, btnMic, { holdToTalk: true });
} catch { /* voice optional */ }

Promise.all([loadFriends(), checkSecretaryHealth()])
  .then(([friends, health]) => {
    friend = memberById(friends, friendId) || friends.find((f) => f.ready) || friends[0];
    if (!friend) {
      main.innerHTML = '<p class="wx-chat-tip">未找到该好友</p>';
      return;
    }
    if (!friend.ready && friend.id !== 'gemini') {
      location.replace('/secretary/chat?friend=gemini');
      return;
    }
    navTitle.textContent = friend.name;
    navAvatar.src = withRoot(friend.logo);
    navAvatar.hidden = false;
    document.title = friend.name;

    loadHistory();
    render();
    input.focus();

    if (friend.ready && !health.ok) {
      showError('AI 服务未就绪，请稍后重试或检查 Vercel 环境变量 GEMINI_API_KEY。');
    }
  })
  .catch(() => {
    main.innerHTML = '<p class="wx-chat-tip">加载失败</p>';
  });
})();
