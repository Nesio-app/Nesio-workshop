function withRoot(path) {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('/')) return path;
  return '/' + path;
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function toast(msg) {
  let el = document.getElementById('wxToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wxToast';
    el.className = 'wx-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('wx-toast--show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('wx-toast--show'), 2200);
}

async function loadFriends() {
  const res = await fetch('/secretary/friends.json');
  if (!res.ok) throw new Error('friends');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function getGroups() {
  try {
    const raw = localStorage.getItem('treasurebox-groups');
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveGroups(list) {
  localStorage.setItem('treasurebox-groups', JSON.stringify(list.slice(0, 30)));
}

function groupKey(ids) {
  return [...ids].sort().join(',');
}

function addGroup(name, memberIds) {
  const ids = [...new Set(memberIds)].filter(Boolean);
  if (ids.length < 2) return null;
  const groups = getGroups();
  const key = groupKey(ids);
  const existing = groups.find((g) => g.key === key);
  if (existing) return existing;
  const group = {
    id: 'g_' + Date.now().toString(36),
    key,
    name: name || ids.length + ' 人群聊',
    memberIds: ids,
    updatedAt: Date.now(),
  };
  groups.unshift(group);
  saveGroups(groups);
  return group;
}

function memberById(friends, id) {
  return friends.find((f) => f.id === id);
}

function saveNoteEntry(kind, content, title, attachments) {
  try {
    const raw = localStorage.getItem('treasurebox-notes');
    const list = raw ? JSON.parse(raw) : [];
    const notes = Array.isArray(list) ? list : [];
    notes.unshift({
      id: 'note-' + Date.now(),
      kind: kind || 'note',
      title: title || '智友',
      content: content || '',
      attachments: attachments || undefined,
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem('treasurebox-notes', JSON.stringify(notes.slice(0, 200)));
    return true;
  } catch {
    return false;
  }
}

function loadFavoriteQuotes() {
  try {
    const raw = localStorage.getItem('treasurebox-favorite-quotes');
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(Boolean) : [];
  } catch {
    return [];
  }
}

window.WxCommon = {
  withRoot,
  esc,
  toast,
  loadFriends,
  getGroups,
  saveGroups,
  addGroup,
  groupKey,
  memberById,
  saveNoteEntry,
  loadFavoriteQuotes,
};
