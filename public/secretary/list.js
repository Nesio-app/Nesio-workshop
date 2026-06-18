(function bootList() {
  if (!window.WxCommon) {
    requestAnimationFrame(bootList);
    return;
  }

  const {
    withRoot,
    loadFriends,
    getGroups,
    addGroup,
    toast,
  } = window.WxCommon;

const listEl = document.getElementById('friendList');
const searchInput = document.getElementById('searchInput');
const toolSheet = document.getElementById('toolSheet');
const toolMask = document.getElementById('toolMask');
const toolGrid = document.getElementById('toolGrid');
const btnTools = document.getElementById('btnTools');
const groupSheet = document.getElementById('groupSheet');
const groupMask = document.getElementById('groupMask');
const groupPick = document.getElementById('groupPick');
const btnStartGroup = document.getElementById('btnStartGroup');
const btnCreateGroup = document.getElementById('btnCreateGroup');
const chatDock = document.getElementById('chatDock');
const dockFab = document.getElementById('dockFab');
const dockHandle = document.getElementById('dockHandle');
const dockActions = document.getElementById('dockActions');
let friends = [];
let pickedIds = new Set();

function formatListTime(ts) {
  if (ts) {
    return new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function renderList(filter) {
  const q = (filter || '').trim().toLowerCase();
  listEl.innerHTML = '';

  const groups = getGroups().filter(
    (g) => !q || g.name.toLowerCase().includes(q),
  );

  for (const g of groups) {
    const memberNames = g.memberIds
      .map((id) => friends.find((f) => f.id === id)?.name)
      .filter(Boolean)
      .join('、');
    const a = document.createElement('a');
    a.className = 'wx-row-item wx-row-item--group';
    a.href = `/secretary/group?group=${encodeURIComponent(g.id)}`;
    a.innerHTML = `
      <div class="wx-row-avatar wx-row-avatar--group" aria-hidden>群</div>
      <div class="wx-row-body">
        <div class="wx-row-top">
          <span class="wx-row-name">${g.name}</span>
          <span class="wx-row-time">${formatListTime(g.updatedAt)}</span>
        </div>
        <div class="wx-row-bottom">
          <span class="wx-row-preview">${memberNames}</span>
        </div>
      </div>
    `;
    listEl.appendChild(a);
  }

  const rows = friends.filter(
    (f) =>
      !q ||
      f.name.toLowerCase().includes(q) ||
      (f.tagline || '').toLowerCase().includes(q) ||
      (f.company || '').toLowerCase().includes(q),
  );

  for (const f of rows) {
    const a = document.createElement('a');
    a.className = 'wx-row-item';
    a.href = `/secretary/chat?friend=${encodeURIComponent(f.id)}`;

    a.innerHTML = `
      <img class="wx-row-avatar" src="${withRoot(f.logo)}" alt="${f.name}" width="48" height="48" loading="lazy" />
      <div class="wx-row-body">
        <div class="wx-row-top">
          <span class="wx-row-name">${f.name}</span>
          <span class="wx-row-time">${formatListTime()}</span>
        </div>
        <div class="wx-row-bottom">
          <span class="wx-row-preview">${f.preview}</span>
          ${f.ready ? '' : '<span class="wx-row-badge">待接</span>'}
        </div>
      </div>
    `;
    listEl.appendChild(a);
  }
}

function renderGroupPick() {
  groupPick.innerHTML = '';
  pickedIds = new Set();
  btnStartGroup.disabled = true;

  for (const f of friends) {
    const label = document.createElement('label');
    label.className = 'wx-group-option';
    label.innerHTML = `
      <input type="checkbox" value="${f.id}" />
      <img src="${withRoot(f.logo)}" alt="" width="36" height="36" />
      <span>${f.name}</span>
    `;
    const input = label.querySelector('input');
    input.addEventListener('change', () => {
      if (input.checked) pickedIds.add(f.id);
      else pickedIds.delete(f.id);
      btnStartGroup.disabled = pickedIds.size < 2;
    });
    groupPick.appendChild(label);
  }
}

function renderDockActions() {
  dockActions.innerHTML = '';
  const actions = [
    { label: '发起群聊', icon: '👥', fn: () => openGroupSheet() },
    { label: 'Gemini', icon: '✦', href: '/secretary/chat?friend=gemini' },
    { label: '返回宝盒', icon: '盒', href: '/' },
  ];
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wx-dock-action';
    btn.innerHTML = `<span>${a.icon}</span><span>${a.label}</span>`;
    btn.addEventListener('click', () => {
      if (a.href) location.href = a.href;
      else if (a.fn) a.fn();
      setDockOpen(false);
    });
    dockActions.appendChild(btn);
  }
  for (const f of friends.filter((x) => x.ready).slice(0, 4)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wx-dock-action';
    btn.innerHTML = `<img src="${withRoot(f.logo)}" alt="" width="28" height="28" /><span>${f.name}</span>`;
    btn.addEventListener('click', () => {
      location.href = `/secretary/chat?friend=${encodeURIComponent(f.id)}`;
    });
    dockActions.appendChild(btn);
  }
}

function setDockOpen(open) {
  chatDock.dataset.open = open ? 'true' : 'false';
}

function setupDock() {
  let startY = 0;
  const toggle = () => setDockOpen(chatDock.dataset.open !== 'true');
  dockFab.addEventListener('click', toggle);
  dockHandle.addEventListener('click', toggle);
  dockFab.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
  }, { passive: true });
  dockFab.addEventListener('touchend', (e) => {
    const dy = startY - e.changedTouches[0].clientY;
    if (dy > 40) setDockOpen(true);
    else if (dy < -40) setDockOpen(false);
  }, { passive: true });
}

async function loadTools() {
  try {
    const res = await fetch('/portal-config.json');
    if (!res.ok) return;
    const cfg = await res.json();
    toolGrid.innerHTML = '';
    for (const tool of cfg.tools || []) {
      if (!tool.ready || tool.id === 'secretary') continue;
      const icon = tool.iconUrl ? withRoot(tool.iconUrl) : '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wx-sheet-tool';
      btn.innerHTML = `
        ${icon ? `<img src="${icon}" alt="" width="36" height="36" />` : `<span>${tool.icon}</span>`}
        <span>${tool.name}</span>
      `;
      btn.addEventListener('click', () => {
        const href = withRoot(tool.url);
        location.href = href;
      });
      toolGrid.appendChild(btn);
    }
  } catch { /* ignore */ }
}

function openSheet(sheet) {
  sheet.hidden = false;
  document.body.classList.add('wx-sheet-open');
}

function closeSheet(sheet) {
  sheet.hidden = true;
  document.body.classList.remove('wx-sheet-open');
}

function openGroupSheet() {
  renderGroupPick();
  openSheet(groupSheet);
}

btnTools.addEventListener('click', () => openSheet(toolSheet));
toolMask.addEventListener('click', () => closeSheet(toolSheet));
btnCreateGroup.addEventListener('click', openGroupSheet);
groupMask.addEventListener('click', () => closeSheet(groupSheet));

btnStartGroup.addEventListener('click', () => {
  const ids = [...pickedIds];
  if (ids.length < 2) {
    toast('请至少选择 2 位 AI');
    return;
  }
  const group = addGroup(null, ids);
  closeSheet(groupSheet);
  if (group) {
    location.href = `/secretary/group?group=${encodeURIComponent(group.id)}`;
  }
});

searchInput.addEventListener('input', () => renderList(searchInput.value));

loadFriends()
  .then((data) => {
    friends = data;
    renderList();
    renderDockActions();
    setupDock();
  })
  .catch(() => {
    listEl.innerHTML = '<p class="wx-empty">无法加载好友列表</p>';
  });

loadTools();
})();
