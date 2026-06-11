const { withRoot, esc, toast, loadFriends, memberById } = window.WxCommon;

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
    showError(`${friend?.name || '该模型'} 即将接入，请先使用 Gemini。`);
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

const attach = window.WxAttach.mountAttachSheet(
  document.getElementById('attachSheet'),
  document.getElementById('attachMask'),
  document.getElementById('attachGrid'),
);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value;
  input.value = '';
  resizeInput();
  sendMessage(text);
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

window.WxVoice.createVoiceInput(input, btnMic);

Promise.all([loadFriends(), checkSecretaryHealth()])
  .then(([friends, health]) => {
    friend = memberById(friends, friendId) || friends[0];
    if (!friend) {
      main.innerHTML = '<p class="wx-chat-tip">未找到该好友</p>';
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
