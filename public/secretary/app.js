const STORAGE_KEY = 'treasurebox-secretary-history';
const main = document.getElementById('chatMain');
const form = document.getElementById('chatForm');
const input = document.getElementById('chatInput');
const btnSend = document.getElementById('btnSend');
const btnClear = document.getElementById('btnClear');

const ASSISTANT_AVATAR = '秘';
const USER_AVATAR = '我';

let history = [];
let busy = false;

function apiBase() {
  if (typeof window !== 'undefined' && window.SECRETARY_API) {
    return String(window.SECRETARY_API).replace(/\/$/, '');
  }
  if (typeof location === 'undefined') return '';
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return '';
  if (location.protocol === 'capacitor:' || location.protocol === 'file:') {
    return 'https://treasurebox-nu.vercel.app';
  }
  return '';
}

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-40)));
  } catch { /* ignore */ }
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function formatTime(date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function makeRow(role, content, extraClass) {
  const row = document.createElement('div');
  row.className = 'wx-row wx-row--' + role;

  const avatar = document.createElement('div');
  avatar.className = 'wx-avatar';
  avatar.textContent = role === 'user' ? USER_AVATAR : ASSISTANT_AVATAR;

  const bubble = document.createElement('div');
  bubble.className = 'wx-bubble wx-bubble--' + role + (extraClass ? ' ' + extraClass : '');
  bubble.innerHTML = esc(content);

  row.appendChild(avatar);
  row.appendChild(bubble);
  return row;
}

function scrollToBottom() {
  main.scrollTop = main.scrollHeight;
}

function render() {
  main.innerHTML = '';
  if (history.length === 0) {
    const welcome = document.createElement('p');
    welcome.className = 'wx-welcome';
    welcome.innerHTML =
      '我是你的私人秘书。<br>可以帮你理清待办、做简短复盘，或在纷乱时先把思绪安放下来。<br><br>试着说：「今天最重要的一件事是什么？」';
    main.appendChild(welcome);
    return;
  }

  const stamp = document.createElement('div');
  stamp.className = 'wx-time';
  stamp.textContent = formatTime(new Date());
  main.appendChild(stamp);

  for (const turn of history) {
    main.appendChild(makeRow(turn.role, turn.content));
  }
  scrollToBottom();
}

function appendRow(role, content, extraClass) {
  const row = makeRow(role, content, extraClass);
  main.appendChild(row);
  scrollToBottom();
  return row.querySelector('.wx-bubble');
}

function resizeInput() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}

async function sendMessage(text) {
  if (busy || !text.trim()) return;
  busy = true;
  btnSend.disabled = true;

  history.push({ role: 'user', content: text.trim() });
  saveHistory();
  render();

  const pending = appendRow('assistant', '对方正在输入…', 'wx-bubble--pending');

  try {
    const res = await fetch(apiBase() + '/api/secretary/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text.trim(),
        history: history.slice(0, -1),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const detail = data.detail || data.error || res.statusText;
      pending.remove();
      const err = document.createElement('div');
      err.className = 'wx-bubble wx-bubble--error';
      err.textContent = '暂时无法回应：' + detail;
      main.appendChild(err);
      history.pop();
      saveHistory();
      scrollToBottom();
      return;
    }

    const reply = String(data.text || '').trim() || '（没有收到有效回复，请再试一次）';
    history.push({ role: 'assistant', content: reply });
    saveHistory();
    pending.closest('.wx-row')?.remove();
    appendRow('assistant', reply);
  } catch {
    pending.closest('.wx-row')?.remove();
    const err = document.createElement('div');
    err.className = 'wx-bubble wx-bubble--error';
    err.textContent = '网络异常，请检查网络后重试。';
    main.appendChild(err);
    history.pop();
    saveHistory();
    scrollToBottom();
  } finally {
    busy = false;
    btnSend.disabled = false;
    input.focus();
  }
}

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
  if (history.length && !confirm('清空所有对话记录？')) return;
  history = [];
  saveHistory();
  render();
  input.focus();
});

loadHistory();
render();
input.focus();
