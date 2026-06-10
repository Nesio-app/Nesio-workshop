const STORAGE_KEY = 'treasurebox-secretary-history';
const main = document.getElementById('chatMain');
const form = document.getElementById('chatForm');
const input = document.getElementById('chatInput');
const btnSend = document.getElementById('btnSend');
const btnClear = document.getElementById('btnClear');

let history = [];
let busy = false;

function apiBase() {
  if (typeof location === 'undefined') return '';
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return '';
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

function render() {
  main.innerHTML = '';
  if (history.length === 0) {
    main.innerHTML =
      '<p class="sec-welcome">我是你的私人秘书。可以帮你理清待办、做简短复盘，或在纷乱时先把思绪安放下来。<br><br>试着说：「今天最重要的一件事是什么？」</p>';
    return;
  }
  for (const turn of history) {
    const el = document.createElement('div');
    el.className = 'sec-bubble sec-bubble--' + (turn.role === 'user' ? 'user' : 'assistant');
    el.innerHTML = esc(turn.content);
    main.appendChild(el);
  }
  main.scrollTop = main.scrollHeight;
}

function appendBubble(role, content, extraClass) {
  const el = document.createElement('div');
  el.className = 'sec-bubble sec-bubble--' + role + (extraClass ? ' ' + extraClass : '');
  el.innerHTML = esc(content);
  main.appendChild(el);
  main.scrollTop = main.scrollHeight;
  return el;
}

function resizeInput() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
}

async function sendMessage(text) {
  if (busy || !text.trim()) return;
  busy = true;
  btnSend.disabled = true;

  history.push({ role: 'user', content: text.trim() });
  saveHistory();
  render();

  const pending = appendBubble('assistant', '正在思考…', 'sec-bubble--pending');

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
      appendBubble('assistant', '暂时无法回应：' + detail, 'sec-bubble--error');
      history.pop();
      saveHistory();
      return;
    }

    const reply = String(data.text || '').trim() || '（没有收到有效回复，请再试一次）';
    history.push({ role: 'assistant', content: reply });
    saveHistory();
    pending.remove();
    appendBubble('assistant', reply);
  } catch (err) {
    pending.remove();
    appendBubble('assistant', '网络异常，请稍后再试。', 'sec-bubble--error');
    history.pop();
    saveHistory();
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
  history = [];
  saveHistory();
  render();
  input.focus();
});

loadHistory();
render();
input.focus();
