const ATTACH_ITEMS = [
  { id: 'photo', label: '照片', icon: '🖼' },
  { id: 'file', label: '文件', icon: '📎' },
  { id: 'voice', label: '语音', icon: '🎙' },
  { id: 'video', label: '视频', icon: '🎬' },
  { id: 'call', label: '通话', icon: '📞' },
  { id: 'note', label: 'Note', icon: '📝' },
  { id: 'favorite', label: '收藏', icon: '⭐' },
  { id: 'location', label: '位置', icon: '📍' },
];

function defaultAttachAction(item) {
  const title = item?.label || '附件';
  const content = `用户点击了智友附件功能：${title}`;
  const saveNoteEntry = window.WxCommon?.saveNoteEntry;
  const saved = typeof saveNoteEntry === 'function'
    ? saveNoteEntry('attachment_action', content, '智友附件')
    : false;
  if (saved) {
    window.WxCommon?.toast(`已记录${title}动作`);
  } else {
    window.WxCommon?.toast(`${title}已收到`);
  }
}

function mountAttachSheet(sheetEl, maskEl, gridEl, handlers = {}) {
  gridEl.innerHTML = '';
  for (const item of ATTACH_ITEMS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wx-sheet-tool';
    btn.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
    btn.addEventListener('click', () => {
      const fn = handlers[item.id];
      if (typeof fn === 'function') fn(item);
      else defaultAttachAction(item);
      close();
    });
    gridEl.appendChild(btn);
  }

  function open() {
    sheetEl.hidden = false;
    document.body.classList.add('wx-sheet-open');
  }

  function close() {
    sheetEl.hidden = true;
    document.body.classList.remove('wx-sheet-open');
  }

  maskEl.addEventListener('click', close);
  return { open, close };
}

window.WxAttach = { mountAttachSheet, ATTACH_ITEMS, defaultAttachAction };
