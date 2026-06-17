/* ═══════════════════════════════════════════════════════════════════════
   熔归 RONG GUI — 统一图标系统 (icons.js)
   把全站彩色 emoji 替换为线性图标，颜色继承上下文（与主题自动协调）。
   覆盖静态 HTML 与 app.js 动态渲染（动作库 / 聊天 / 计时器等）。
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  const S = (p) => `<svg viewBox="0 0 24 24">${p}</svg>`;

  // emoji（去除变体选择符 \uFE0F 后的基字符）→ 线性 SVG
  const MAP = {
    // —— 导航 / 核心 ——
    "🏡": S('<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>'),
    "🔥": S('<path d="M12 3c2.5 3 4 5.5 4 8a4 4 0 0 1-8 0c0-1 .3-2 1-3 .2 1 .8 1.6 1.5 1.8C10 8 11 5.5 12 3z"/>'),
    "📚": S('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
    "🤖": S('<path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z"/><circle cx="18" cy="17.5" r="1.7"/>'),
    "🩸": S('<path d="M12 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z"/>'),
    // —— 动作 / 状态 ——
    "⚡": S('<path d="M13 3L5 13h5l-1 8 8-11h-5l1-7z"/>'),
    "⛔": S('<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/>'),
    "✓": S('<path d="M5 12.5l4.5 4.5L19 7"/>'),
    "✕": S('<path d="M6 6l12 12M18 6L6 18"/>'),
    "⚪": S('<circle cx="12" cy="12" r="7"/>'),
    "🏁": S('<path d="M6 21V4"/><path d="M6 5h11l-2 3 2 3H6"/>'),
    "🎵": S('<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>'),
    "🔔": S('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    "🔕": S('<path d="M6 16V11a6 6 0 0 1 9.2-4.7M18 13v3l2 2H7"/><path d="M10 20a2 2 0 0 0 4 0"/><path d="M4 4l16 16"/>'),
    "🛡": S('<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>'),
    "🧴": S('<rect x="8" y="8" width="8" height="12" rx="2"/><path d="M10 8V5h4v3"/><line x1="11" y1="3.2" x2="13" y2="3.2"/>'),
    "💧": S('<path d="M12 4c2.5 3.3 4.2 5.6 4.2 8a4.2 4.2 0 0 1-8.4 0c0-2.4 1.7-4.7 4.2-8z"/>'),
    "🦾": S('<path d="M3 12h4l2-5 4 10 2-5h6"/>'),
    "💡": S('<path d="M9 17.5h6M10 20.5h4"/><path d="M12 3a6 6 0 0 1 4 10.5c-.6.6-1 1.2-1 2H9c0-.8-.4-1.4-1-2A6 6 0 0 1 12 3z"/>'),
    "⏱": S('<circle cx="12" cy="13" r="8"/><path d="M12 13V8.5"/><path d="M9.5 2.5h5"/>'),
    "⏸": S('<rect x="7.5" y="6" width="3" height="12" rx="1"/><rect x="13.5" y="6" width="3" height="12" rx="1"/>'),
    "🎉": S('<path d="M12 4l1.5 4L18 9.5 13.5 11 12 15l-1.5-4L6 9.5 10.5 8z"/><circle cx="6" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="16" r="1" fill="currentColor" stroke="none"/>'),
    "🌡": S('<path d="M14 14.8V6a2 2 0 0 0-4 0v8.8a4 4 0 1 0 4 0z"/>'),
    "🌿": S('<path d="M5 19c0-8 6-13 14-13 0 8-6 13-14 13z"/><path d="M5 19c3-4 6-6 9-7"/>'),
    "🔻": S('<path d="M12 5v9"/><path d="M7.5 11l4.5 5 4.5-5"/>'),
    "🔓": S('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>'),
    "⚠": S('<path d="M12 4l9 16H3z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17" r=".7" fill="currentColor" stroke="none"/>'),
    "🚶": S('<circle cx="13" cy="5" r="2"/><path d="M13 8l-2 4 3 3v5"/><path d="M11 12l-3 2"/><path d="M14 15l3 1"/>'),
    "↺": S('<path d="M19 12a7 7 0 1 1-2-5"/><path d="M17.5 4v3.2h-3"/>'),
    "↑": S('<path d="M12 19V6"/><path d="M6 11l6-6 6 6"/>'),
    "↘": S('<path d="M6 7l12 10"/><path d="M18 11v6h-6"/>'),
    "🔢": S('<path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16"/>'),
    "📅": S('<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M4 10h16M9 4v4M15 4v4"/>'),
    "😴": S('<path d="M20 14a8 8 0 1 1-9-9 6.5 6.5 0 0 0 9 9z"/>'),
    "🌞": S('<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12h2.5M19 12h2.5M5.2 5.2l1.8 1.8M17 17l1.8 1.8M18.8 5.2L17 7M7 17l-1.8 1.8"/>'),
    // —— 音景 ——
    "🌧": S('<path d="M7 14a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1 3.5 3.5 0 0 1 0 7"/><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2"/>'),
    "🎧": S('<path d="M5 14v-2a7 7 0 0 1 14 0v2"/><rect x="4" y="14" width="4" height="6" rx="1.5"/><rect x="16" y="14" width="4" height="6" rx="1.5"/>'),
    "🌲": S('<path d="M12 3l5 7h-3l3 5h-4v4h-2v-4H6l3-5H6z"/>'),
    "🌌": S('<circle cx="12" cy="12" r="2"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.5 6.5l2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2"/>'),
    // —— 动作库：器械 ——
    "🤸": S('<circle cx="12" cy="5" r="2"/><path d="M12 7v6M7 9l5 2 5-2M9 20l3-7 3 7"/>'),
    "🏋": S('<path d="M5 9v6M8 7v10M16 7v10M19 9v6M8 12h8"/>'),
    "🛋": S('<rect x="4" y="10" width="16" height="4" rx="1.5"/><path d="M6 14v4M18 14v4"/>'),
    "🧱": S('<path d="M4 7h16M4 12h16M4 17h16M9 7v5M15 7v5M7 12v5M13 12v5M17 12v5"/>'),
    // —— 动作库：运动模式 ——
    "🦵": S('<path d="M10 4l-1 8 2 8M14 4l0 8-1 4"/>'),
    "🔄": S('<path d="M5 9a7 7 0 0 1 12-2M17 4v3.2h-3"/><path d="M19 15a7 7 0 0 1-12 2M7 20v-3.2h3"/>'),
    "👊": S('<path d="M4 12h11M11.5 8l4 4-4 4"/><path d="M18.5 6v12"/>'),
    "🌀": S('<path d="M12 9a3 3 0 1 1-2.4 4.7"/><path d="M12 5.2a7 7 0 1 1-5.4 11"/>'),
    // —— 动作库 / 训练：肌群 ——
    "🍑": S('<circle cx="12" cy="13" r="6"/><path d="M12 7V4"/>'),
    "🦋": S('<path d="M12 4l6 8-6 8-6-8z"/>'),
    "💪": S('<path d="M7 9v4a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4v-1a2 2 0 0 0-2-2h-3V8a2 2 0 0 0-4 0"/>'),
    "🔙": S('<path d="M14.5 6l-6 6 6 6"/><path d="M8.5 12h9"/>'),
    "🫁": S('<path d="M12 6v12M12 9c-2-3-7-2-7 3 0 3 3 5 7 5M12 9c2-3 7-2 7 3 0 3-3 5-7 5"/>'),
    "🙆": S('<circle cx="12" cy="7" r="2.5"/><path d="M6 18c1-4 3-6 6-6s5 2 6 6"/>'),
  };

  // 这些保持语义色（紧扣主题的安全/警示/危险三色）
  const TINT = { "🟢": "var(--safe)", "🟡": "var(--warn)", "🔴": "var(--danger)" };
  const DOT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/></svg>';
  Object.keys(TINT).forEach((k) => (MAP[k] = DOT));

  const KEYS = Object.keys(MAP).sort((a, b) => b.length - a.length);
  const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const RE = new RegExp("(?:" + KEYS.map(ESC).join("|") + ")\\uFE0F?", "gu");

  const SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, SVG: 1, svg: 1 };

  function parseIcon(svg) {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    return document.importNode(doc.documentElement, true);
  }

  function paintTextNode(tn) {
    const v = tn.nodeValue;
    if (!v || v.length > 600) return;
    RE.lastIndex = 0;
    if (!RE.test(v)) return;
    RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = RE.exec(v))) {
      const key = m[0].replace(/\uFE0F/g, "");
      const svg = MAP[key];
      if (!svg) continue;
      if (m.index > last) frag.appendChild(document.createTextNode(v.slice(last, m.index)));
      const i = document.createElement("i");
      i.className = "rgi";
      i.appendChild(parseIcon(svg));
      if (TINT[key]) i.style.color = TINT[key];
      frag.appendChild(i);
      last = m.index + m[0].length;
    }
    if (last > 0) {
      if (last < v.length) frag.appendChild(document.createTextNode(v.slice(last)));
      tn.parentNode && tn.parentNode.replaceChild(frag, tn);
    }
  }

  function paint(root) {
    if (!root) return;
    if (root.nodeType === 3) { paintTextNode(root); return; }
    if (root.nodeType !== 1) return;
    if (root.classList && (root.classList.contains("rgi") || root.classList.contains("rg-switch"))) return;
    if (SKIP[root.nodeName]) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentNode;
        if (!p || SKIP[p.nodeName]) return NodeFilter.FILTER_REJECT;
        if (p.classList && p.classList.contains("rgi")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const list = [];
    let n;
    while ((n = walker.nextNode())) list.push(n);
    list.forEach(paintTextNode);
  }

  let queued = false;
  const queue = new Set();
  function flush() {
    queued = false;
    const items = [...queue];
    queue.clear();
    items.forEach(paint);
  }
  function schedule(node) {
    queue.add(node);
    if (!queued) { queued = true; requestAnimationFrame(flush); }
  }

  function start() {
    paint(document.body);
    new MutationObserver((muts) => {
      for (const mu of muts) {
        if (mu.type === "childList") {
          mu.addedNodes.forEach((nd) => { if (nd.nodeType === 1 || nd.nodeType === 3) schedule(nd); });
        } else if (mu.type === "characterData") {
          schedule(mu.target);
        }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
