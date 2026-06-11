const listEl = document.getElementById('friendList');
const searchInput = document.getElementById('searchInput');
const toolSheet = document.getElementById('toolSheet');
const toolMask = document.getElementById('toolMask');
const toolGrid = document.getElementById('toolGrid');
const btnTools = document.getElementById('btnTools');

let friends = [];

function withRoot(path) {
  if (path.startsWith('http') || path.startsWith('/')) return path;
  return '/' + path;
}

function formatListTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function renderFriends(filter) {
  const q = (filter || '').trim().toLowerCase();
  const rows = friends.filter((f) => !q || f.name.toLowerCase().includes(q) || f.tagline.toLowerCase().includes(q));
  listEl.innerHTML = '';

  for (const f of rows) {
    const a = document.createElement('a');
    a.className = 'wx-row-item';
    a.href = `/secretary/chat.html?friend=${encodeURIComponent(f.id)}`;

    a.innerHTML = `
      <img class="wx-row-avatar" src="${withRoot(f.logo)}" alt="" width="48" height="48" />
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
        if (href.startsWith('http')) window.open(href, '_blank', 'noopener,noreferrer');
        else window.location.href = href;
      });
      toolGrid.appendChild(btn);
    }
  } catch { /* ignore */ }
}

function openSheet() {
  toolSheet.hidden = false;
  document.body.classList.add('wx-sheet-open');
}

function closeSheet() {
  toolSheet.hidden = true;
  document.body.classList.remove('wx-sheet-open');
}

btnTools.addEventListener('click', openSheet);
toolMask.addEventListener('click', closeSheet);
searchInput.addEventListener('input', () => renderFriends(searchInput.value));

fetch('/secretary/friends.json')
  .then((r) => r.json())
  .then((data) => {
    friends = Array.isArray(data) ? data : [];
    renderFriends();
  })
  .catch(() => {
    listEl.innerHTML = '<p class="wx-empty">无法加载好友列表</p>';
  });

loadTools();
