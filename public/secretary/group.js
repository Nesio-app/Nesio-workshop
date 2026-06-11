const {
  withRoot,
  esc,
  toast,
  loadFriends,
  memberById,
  getGroups,
  saveNoteEntry,
  loadFavoriteQuotes,
} = window.WxCommon;

const params = new URLSearchParams(location.search);
const groupId = params.get('group');
const idsParam = params.get('ids');

const main = document.getElementById('chatMain');
const form = document.getElementById('chatForm');
const input = document.getElementById('chatInput');
const btnClear = document.getElementById('btnClear');
const btnPlus = document.getElementById('btnPlus');
const btnMic = document.getElementById('btnMic');
const navTitle = document.getElementById('navTitle');
const navAvatars = document.getElementById('navAvatars');

const USER_AVATAR = '婧';

let members = [];
let groupMeta = null;
let history = [];
let busy = false;
let storageKey = '';

function loadHistory() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) history = JSON.parse(raw);
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(history.slice(-120)));
  } catch { /* ignore */ }
}

function makeRow(turn) {
  const row = document.createElement('div');
  row.className = 'wx-msg wx-msg--' + turn.role;

  if (turn.role === 'assistant' && turn.logo) {
    const av = document.createElement('img');
    av.className = 'wx-msg-avatar';
    av.src = withRoot(turn.logo);
    av.alt = turn.senderName || '';
    row.appendChild(av);
  } else if (turn.role === 'user') {
    const av = document.createElement('div');
    av.className = 'wx-msg-avatar wx-msg-avatar--user';
    av.textContent = USER_AVATAR;
    row.appendChild(av);
  }

  const wrap = document.createElement('div');
  wrap.className = 'wx-msg-content';

  if (turn.senderName && turn.role === 'assistant') {
    const label = document.createElement('p');
    label.className = 'wx-msg-sender';
    label.textContent = turn.senderName;
    wrap.appendChild(label);
  }

  const bubble = document.createElement('div');
  bubble.className = 'wx-msg-bubble' + (turn.extraClass ? ' ' + turn.extraClass : '');
  bubble.innerHTML = esc(turn.content);
  wrap.appendChild(bubble);
  row.appendChild(wrap);
  return row;
}

function scrollBottom() {
  main.scrollTop = main.scrollHeight;
}

function render() {
  main.innerHTML = '';
  if (history.length === 0) {
    const tip = document.createElement('p');
    tip.className = 'wx-chat-tip';
    tip.textContent = `群里有 ${members.map((m) => m.name).join('、')}，发一条消息试试。`;
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

async function replyAs(member, userText, priorHistory) {
  if (!member.ready) {
    return {
      role: 'assistant',
      content: `${member.name} 尚未接入，敬请期待。`,
      senderId: member.id,
      senderName: member.name,
      logo: member.logo,
    };
  }

  const persona = `你正在与用户的群聊中，请以 ${member.name}（${member.company || member.name}）的身份，用简短自然的中文回复，一两段即可。`;
  const wrapped = `${persona}\n\n用户说：${userText}`;

  const { ok, data } = await sendSecretaryMessage(wrapped, priorHistory, 'gemini');
  if (!ok) {
    return {
      role: 'assistant',
      content: `${member.name} 暂时无法回应`,
      senderId: member.id,
      senderName: member.name,
      logo: member.logo,
    };
  }

  return {
    role: 'assistant',
    content: String(data.text || '').trim() || '…',
    senderId: member.id,
    senderName: member.name,
    logo: member.logo,
  };
}

async function sendMessage(text) {
  if (busy || !text.trim()) return;

  busy = true;
  input.disabled = true;

  history.push({ role: 'user', content: text.trim() });
  saveHistory();
  render();

  const prior = history
    .filter((h) => h.role === 'user' || h.role === 'assistant')
    .slice(0, -1)
    .map((h) => ({ role: h.role, content: h.content }));

  for (const member of members) {
    const pending = makeRow({
      role: 'assistant',
      content: `${member.name} 正在输入…`,
      extraClass: 'wx-msg-bubble--pending',
      senderName: member.name,
      logo: member.logo,
    });
    main.appendChild(pending);
    scrollBottom();

    try {
      const turn = await replyAs(member, text.trim(), prior);
      pending.remove();
      history.push(turn);
      saveHistory();
      render();
      prior.push({ role: 'user', content: text.trim() });
      prior.push({ role: 'assistant', content: turn.content });
    } catch {
      pending.remove();
      history.push({
        role: 'assistant',
        content: `${member.name} 网络异常`,
        senderId: member.id,
        senderName: member.name,
        logo: member.logo,
      });
      saveHistory();
      render();
    }
  }

  busy = false;
  input.disabled = false;
  input.focus();
}

function resizeInput() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}

const pickPhoto = document.getElementById('pickPhoto');
const pickFile = document.getElementById('pickFile');

const attach = window.WxAttach.mountAttachSheet(
  document.getElementById('attachSheet'),
  document.getElementById('attachMask'),
  document.getElementById('attachGrid'),
  {
    photo: () => pickPhoto.click(),
    file: () => pickFile.click(),
    voice: () => toast('按住左侧麦克风说话'),
    note: () => {
      const text = input.value.trim() || prompt('写入 Note 的内容');
      if (!text) return;
      if (saveNoteEntry('chat', text, navTitle.textContent)) toast('已存入 Note');
    },
    favorite: () => {
      const favs = loadFavoriteQuotes();
      if (!favs.length) return toast('暂无收藏');
      input.value = favs[0];
      input.dispatchEvent(new Event('input'));
    },
    call: () => toast('语音通话功能开发中'),
    video: () => toast('视频功能开发中'),
    location: () => toast('位置功能开发中'),
  },
);

pickPhoto?.addEventListener('change', async () => {
  const file = pickPhoto.files?.[0];
  pickPhoto.value = '';
  if (!file) return;
  await sendMessage(`[图片] ${file.name}`);
});

pickFile?.addEventListener('change', async () => {
  const file = pickFile.files?.[0];
  pickFile.value = '';
  if (!file) return;
  await sendMessage(`[文件] ${file.name}`);
});

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
  if (history.length && !confirm('清空群聊记录？')) return;
  history = [];
  saveHistory();
  render();
});

btnPlus.addEventListener('click', () => attach.open());
window.WxVoice.createVoiceInput(input, btnMic, { holdToTalk: true });

loadFriends()
  .then((friends) => {
    let memberIds = [];
    if (groupId) {
      groupMeta = getGroups().find((g) => g.id === groupId);
      memberIds = groupMeta?.memberIds || [];
    } else if (idsParam) {
      memberIds = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
    }

    members = memberIds.map((id) => memberById(friends, id)).filter(Boolean);
    if (members.length < 2) {
      main.innerHTML = '<p class="wx-chat-tip">群聊至少需要 2 位 AI，<a href="/secretary">返回</a></p>';
      return;
    }

    storageKey = groupMeta?.id
      ? `treasurebox-group-${groupMeta.id}`
      : `treasurebox-group-${memberIds.sort().join('-')}`;

    navTitle.textContent = groupMeta?.name || members.map((m) => m.name).join('、');
    document.title = navTitle.textContent;

    navAvatars.innerHTML = members
      .slice(0, 4)
      .map(
        (m) =>
          `<img src="${withRoot(m.logo)}" alt="${esc(m.name)}" width="22" height="22" />`,
      )
      .join('');

    loadHistory();
    render();
    input.focus();
  })
  .catch(() => {
    main.innerHTML = '<p class="wx-chat-tip">加载失败</p>';
  });
