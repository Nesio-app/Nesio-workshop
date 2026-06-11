const ATTACH_ITEMS = [
  { id: 'photo', label: '照片', icon: '🖼' },
  { id: 'camera', label: '拍摄', icon: '📷' },
  { id: 'file', label: '文件', icon: '📎' },
  { id: 'voice', label: '语音', icon: '🎙' },
  { id: 'video', label: '视频', icon: '🎬' },
  { id: 'call', label: '通话', icon: '📞' },
  { id: 'note', label: 'Note', icon: '📝' },
  { id: 'favorite', label: '收藏', icon: '⭐' },
  { id: 'location', label: '位置', icon: '📍' },
];

function mountAttachSheet(sheetEl, maskEl, gridEl, onPick) {
  gridEl.innerHTML = '';
  for (const item of ATTACH_ITEMS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wx-sheet-tool';
    btn.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
    btn.addEventListener('click', () => {
      if (onPick) onPick(item);
      else window.WxCommon?.toast(`${item.label} 功能即将上线`);
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

window.WxAttach = { mountAttachSheet, ATTACH_ITEMS };
