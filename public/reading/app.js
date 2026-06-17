(function () {
  const STORAGE_KEY = 'neuro_reading_v2';
  const SPEEDS = ['0.75×', '1.0×', '1.25×', '1.5×', '2.0×'];
  const SLOT_EMOJIS = ['📖', '🎯', '⚡', '🧠', '✦', '🌊', '🏃', '💡', '🎵', '🌿', '☕', '🔥'];
  const THEMES = [
    { id: 'warm', bg: '#F5F0E8', card: '#FDFAF4', ink: '#1C1A17' },
    { id: 'dark', bg: '#1C1A17', card: '#252320', ink: '#F5F0E8' },
    { id: 'blue', bg: '#1A2535', card: '#1E2C3A', ink: '#E0E8F0' },
    { id: 'green', bg: '#1D2A1A', card: '#222E1F', ink: '#D8ECD0' },
    { id: 'purple', bg: '#2A1A2E', card: '#31203A', ink: '#E8D0F0' },
  ];
  const WEEKS = ['本周', '上周', '本月', '全部'];
  const PERSP_TAGS = ['默认洞察', 'CBT', '二阶思考', '逆向', '灵魂拷问', '复利飞轮'];
  const INSIGHT_TABS = ['全部', 'CBT', '逆向', '二阶'];
  const PERSP_WHEEL = [
    '默认洞察', 'CBT', '灵魂拷问', '二阶思考', '逆向思考', '查理芒格', '复利飞轮', '价值澄清', '🔒 盲区探索', '🔒 意义雷达',
  ];

  /** @type {ReturnType<typeof defaultState>} */
  let state = loadState();
  let reader = { bookId: null, lineIndex: 0, bubbleOpen: false };
  let obIdx = 0;
  let speedIdx = 1;
  let ttsPlaying = false;
  let hfTimer = null;
  let absorbTimer = null;
  let weekIdx = 0;
  let insightFilter = '全部';
  let perspFilter = '默认洞察';
  /** @type {object[]} */
  let importedBooks = [];
  let pendingImportFile = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function defaultState() {
    return {
      onboarded: false,
      pts: 1840,
      streak: 12,
      combo: 7,
      todayPts: 140,
      absorbed: 47,
      collisions: 6,
      minutesWeek: [35, 50, 28, 62, 45, 70, 55],
      heatmap: [0, 0, 1, 0, 2, 1, 0, 1, 2, 3, 1, 0, 2, 4, 2, 1, 3, 4, 2, 3, 4, 3, 2, 4, 3, 4, 3, 4],
      books: {},
      vaporized: [],
      prefs: { bionic: 'medium', focus: 'line', skip: '1', theme: 'warm' },
      lastReadDate: new Date().toISOString().slice(0, 10),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...defaultState(), ...JSON.parse(raw) };
    } catch (_) {}
    return defaultState();
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  async function refreshImportedBooks() {
    if (!window.BookImport) {
      importedBooks = [];
      return;
    }
    try {
      importedBooks = await BookImport.loadBooks();
    } catch (_) {
      importedBooks = [];
    }
  }

  function allBooks() {
    return [...(window.READING_BOOKS || []), ...importedBooks];
  }

  function isImportedBook(id) {
    return String(id).startsWith('import-');
  }

  function bookProgress(id) {
    return state.books[id] || { percent: 0, absorbed: 0, lines: {}, section: 0, line: 0 };
  }

  function setBookProgress(id, patch) {
    state.books[id] = { ...bookProgress(id), ...patch };
    saveState();
  }

  function isVaporized(id) {
    return state.vaporized.includes(id);
  }

  function activeBooks() {
    return allBooks().filter((b) => !isVaporized(b.id));
  }

  function inProgressBooks() {
    return activeBooks().filter((b) => {
      const p = bookProgress(b.id);
      return p.percent > 0 && p.percent < 100;
    });
  }

  function formatPts(n) {
    return n.toLocaleString('en-US');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** Bionic-style bold/light split */
  function bionicHtml(text) {
    const parts = [];
    const tokens = text.match(/[\u4e00-\u9fff]|[a-zA-Z]+(?:'[a-z]+)?|\d+(?:\.\d+)?%?|[^\s]/g) || [text];
    tokens.forEach((tok) => {
      if (/^[\u4e00-\u9fff]$/.test(tok)) {
        parts.push(`<span class="bb">${escapeHtml(tok)}</span>`);
        return;
      }
      if (/^[a-zA-Z]/.test(tok)) {
        const cut = Math.max(1, Math.ceil(tok.length * 0.45));
        parts.push(`<span class="bb">${escapeHtml(tok.slice(0, cut))}</span><span class="bn">${escapeHtml(tok.slice(cut))}</span>`);
        return;
      }
      parts.push(`<span class="bb">${escapeHtml(tok)}</span>`);
    });
    return parts.join('');
  }

  function flatLines(book) {
    const lines = [];
    book.chapters.forEach((ch, ci) => {
      ch.sections.forEach((sec, si) => {
        sec.lines.forEach((line, li) => {
          lines.push({ ...line, chapterIndex: ci, sectionIndex: si, lineIndex: li, chapterTitle: ch.title, sectionTitle: sec.title });
        });
      });
    });
    return lines;
  }

  function applyTheme(themeId) {
    const t = THEMES.find((x) => x.id === themeId) || THEMES[0];
    document.documentElement.style.setProperty('--bg', t.bg);
    document.documentElement.style.setProperty('--card', t.card);
    document.documentElement.style.setProperty('--ink', t.ink);
    document.documentElement.style.setProperty('--reader-bg', t.bg);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t.bg;
    state.prefs.theme = themeId;
    saveState();
    renderThemeDots();
  }

  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
    const fullscreen = ['screen-read', 'screen-stats', 'screen-eraser', 'screen-onboard'].includes(id);
    $('#app').classList.toggle('reader-open', fullscreen && id === 'screen-read');
    if (id !== 'screen-onboard' && id !== 'screen-read' && id !== 'screen-stats' && id !== 'screen-eraser') {
      const tab = id.replace('screen-', '');
      $$('.nb').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    }
  }

  function showTab(tab) {
    if (tab === 'read') {
      const cur = inProgressBooks()[0] || activeBooks()[0];
      if (cur) openBook(cur.id);
      else showScreen('screen-home');
      return;
    }
    showScreen(`screen-${tab}`);
    if (tab === 'insight') renderInsight();
    if (tab === 'shop') renderShop();
    if (tab === 'home') renderHome();
  }

  function renderHome() {
    const active = inProgressBooks();
    $('#homeSub').textContent = `${active.length}本进行中 · 今日 +${state.todayPts} PTS`;
    $('#streakVal').textContent = `×${state.streak} 天`;
    $('#ptsPillHome').textContent = `${formatPts(state.pts)} PTS`;

    const cur = [...active].sort((a, b) => (bookProgress(b.id).updatedAt || 0) - (bookProgress(a.id).updatedAt || 0))[0];
    const curEl = $('#curBook');
    const curLbl = $('#curLbl');
    if (cur) {
      const p = bookProgress(cur.id);
      curLbl.hidden = false;
      curEl.hidden = false;
      $('#curTag').textContent = `${cur.author} · ${cur.chapters[0]?.title || ''}`;
      $('#curTitle').innerHTML = escapeHtml(cur.title);
      $('#curSub').textContent = `今日吸收 ${p.absorbed || 0} 段 · 脱水率 ${Math.min(99, 80 + (p.absorbed || 0) % 20)}%`;
      $('#curProg').style.width = `${p.percent}%`;
      $('#curPct').textContent = `${p.percent}%`;
      curEl.onclick = () => openBook(cur.id);
    } else {
      curLbl.hidden = true;
      curEl.hidden = true;
    }

    const addCard = `<button type="button" class="bk-card bk-card--add" id="shelfAddBtn">
      <div class="bk-add-icon">＋</div>
      <div class="bk-n">导入书籍</div>
      <div class="bk-s">任意格式 · ADHD 拆行</div>
    </button>`;

    $('#shelfGrid').innerHTML =
      addCard +
      allBooks()
      .map((b) => {
        const vapor = isVaporized(b.id);
        const p = bookProgress(b.id);
        const pct = vapor ? 0 : p.percent;
        if (vapor) {
          return `<button type="button" class="bk-card bk-card--vaporized" data-id="${b.id}">
            <div class="bk-spine" style="background:linear-gradient(135deg,rgba(123,94,167,.4),rgba(92,62,138,.4))">🌫️</div>
            <div class="bk-n" style="color:var(--ink3)">进度已蒸发</div>
            <div class="bk-s">资产已保留 · 重新开始</div>
            <div class="bk-p"><div class="bk-pf" style="width:0%"></div></div>
          </button>`;
        }
        const sub = isImportedBook(b.id)
          ? `${escapeHtml(b.author)} · ${escapeHtml((b.format || '导入').toUpperCase())}`
          : escapeHtml(b.author);
        return `<button type="button" class="bk-card" data-id="${b.id}">
          <div class="bk-spine" style="background:${b.spine.gradient}">${escapeHtml(b.spine.label)}</div>
          <div class="bk-n">${escapeHtml(b.title)}</div>
          <div class="bk-s">${sub}</div>
          <div class="bk-p"><div class="bk-pf" style="width:${pct}%"></div></div>
        </button>`;
      })
      .join('');

    $('#shelfAddBtn')?.addEventListener('click', openImport);
    $('#shelfGrid').querySelectorAll('.bk-card:not(.bk-card--add)').forEach((el) => {
      el.addEventListener('click', () => {
        if (isVaporized(el.dataset.id)) {
          state.vaporized = state.vaporized.filter((id) => id !== el.dataset.id);
          setBookProgress(el.dataset.id, { percent: 0, absorbed: 0, lines: {}, section: 0, line: 0 });
          renderHome();
          return;
        }
        openBook(el.dataset.id);
      });
    });
  }

  function renderMinimap(book, flat, activeIdx) {
    const nodes = [];
    book.chapters.forEach((ch, ci) => {
      const chLines = flat.filter((l) => l.chapterIndex === ci);
      const chStart = flat.indexOf(chLines[0]);
      let cls = 'fog';
      if (chStart === activeIdx) cls = 'cur';
      else if (chLines.some((_, i) => chStart + i < activeIdx)) cls = 'par';
      else if (chLines.some((_, i) => chStart + i > activeIdx)) cls = 'chd';
      const label = ch.title.replace(/Chapter\s*/i, 'Ch').slice(0, 8);
      nodes.push(`<div class="mn ${cls}">${escapeHtml(label)}</div>`);
      if (ci < book.chapters.length - 1) nodes.push('<div class="mc"></div>');
    });
    $('#minimap').innerHTML = nodes.join('');
  }

  function renderReaderLines(book, flat) {
    const prog = bookProgress(book.id);
    const html = flat
      .map((line, i) => {
        const absorbed = prog.lines?.[i];
        if (line.kind === 'formula') {
          return `<div class="tl${absorbed ? ' abs' : ''}" data-i="${i}">
            <div class="math-card">
              <div class="math-card-lbl">📐 公式资产卡片 · 无损保护</div>
              ${escapeHtml(line.formula || '')}
            </div>
            <div class="adot"></div>
          </div>`;
        }
        const tag = line.tag ? `<span class="atag">${escapeHtml(line.tag)}</span>` : '';
        const body = line.kind === 'action' ? `${tag}${bionicHtml(line.text)}` : bionicHtml(line.text);
        const bubble = line.bubble
          ? `<div class="hbub" data-bubble="${i}"><div class="hbub-tag">💡 前情提要泡泡</div>${escapeHtml(line.bubble)}</div>`
          : '';
        return `<div class="tl${absorbed ? ' abs' : ''}" data-i="${i}">
          <div class="lt">${body}</div>
          <div class="adot"></div>${bubble}
        </div>`;
      })
      .join('');
    $('#focusWrap').innerHTML = html;
    reader.lineIndex = prog.line || 0;
    updateFocusLine();
    renderMinimap(book, flat, reader.lineIndex);
    $('#readTitle').textContent = book.title;
    const line = flat[reader.lineIndex];
    $('#readChapter').textContent = line ? `${line.chapterTitle} · ${line.sectionTitle}` : '';
    $('#comboBadge').textContent = `🔥 ×${state.combo}`;

    const pct = flat.length ? Math.round((reader.lineIndex / flat.length) * 100) : 0;
    setBookProgress(book.id, { percent: pct, line: reader.lineIndex, updatedAt: Date.now() });
  }

  function updateFocusLine() {
    const lines = $$('#focusWrap .tl');
    const col = $('#readCol');
    const top = col.getBoundingClientRect().top;
    let best = 0;
    let minD = Infinity;
    lines.forEach((l, i) => {
      const d = Math.abs(l.getBoundingClientRect().top - top - 100);
      if (d < minD) {
        minD = d;
        best = i;
      }
    });
    if (state.prefs.focus === 'line' && reader.lineIndex >= 0) best = reader.lineIndex;

    lines.forEach((l, i) => {
      l.classList.remove('act', 'dim');
      if (i < best) {
        l.classList.add('dim', 'abs');
      } else if (i === best) {
        l.classList.add('act');
        reader.lineIndex = i;
      }
    });

    const active = lines[best];
    if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });

    const book = allBooks().find((b) => b.id === reader.bookId);
    if (book) {
      const flat = flatLines(book);
      renderMinimap(book, flat, best);
      const pct = flat.length ? Math.round((best / flat.length) * 100) : 0;
      setBookProgress(book.id, { percent: pct, line: best });
    }
  }

  function openBook(bookId) {
    const book = allBooks().find((b) => b.id === bookId);
    if (!book || isVaporized(bookId)) return;
    reader.bookId = bookId;
    reader.bubbleOpen = false;
    const flat = flatLines(book);
    renderReaderLines(book, flat);
    showScreen('screen-read');
    startAbsorbSim();
    trackStreak();
  }

  function closeReader() {
    stopAbsorbSim();
    showScreen('screen-home');
    renderHome();
  }

  function absorbLine(index) {
    if (!reader.bookId) return;
    const prog = bookProgress(reader.bookId);
    if (prog.lines?.[index]) return;
    const lines = { ...(prog.lines || {}), [index]: true };
    const absorbed = (prog.absorbed || 0) + 1;
    setBookProgress(reader.bookId, { lines, absorbed });
    state.absorbed += 1;
    state.pts += 5;
    state.todayPts += 5;
    state.combo += 1;
    saveState();
    const el = $(`#focusWrap .tl[data-i="${index}"]`);
    if (el) el.classList.add('abs');
    $('#comboBadge').textContent = `🔥 ×${state.combo}`;
    showToast();
  }

  function showToast() {
    const t = $('#absToast');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
  }

  function startAbsorbSim() {
    stopAbsorbSim();
    absorbTimer = setInterval(() => {
      const lines = $$('#focusWrap .tl:not(.abs):not(.act)');
      if (lines.length && Math.random() > 0.55) {
        const el = lines[Math.floor(Math.random() * lines.length)];
        const i = Number(el.dataset.i);
        absorbLine(i);
      }
    }, 4000);
  }

  function stopAbsorbSim() {
    if (absorbTimer) clearInterval(absorbTimer);
    absorbTimer = null;
  }

  function trackStreak() {
    const today = new Date().toISOString().slice(0, 10);
    if (state.lastReadDate === today) return;
    const last = new Date(state.lastReadDate);
    const diff = Math.round((new Date(today) - last) / 86400000);
    if (diff === 1) state.streak += 1;
    else if (diff > 1) state.streak = 1;
    state.lastReadDate = today;
    saveState();
  }

  function renderInsight() {
    $('#insightSub').textContent = `AI 跨书熬制 · 本周 ${state.collisions} 次`;
    $('#perspRow').innerHTML = PERSP_TAGS.map(
      (t) => `<button type="button" class="ptag${perspFilter === t ? ' active' : ''}" data-p="${t}">${t}</button>`
    ).join('');
    $('#perspRow').querySelectorAll('.ptag').forEach((btn) => {
      btn.addEventListener('click', () => {
        perspFilter = btn.dataset.p;
        renderInsight();
      });
    });

    $('#insightTabs').innerHTML = INSIGHT_TABS.map(
      (t) => `<button type="button" class="i-tab${insightFilter === t ? ' active' : ''}" data-f="${t}">${t}</button>`
    ).join('');
    $('#insightTabs').querySelectorAll('.i-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        insightFilter = btn.dataset.f;
        renderInsight();
      });
    });

    const cards = (window.INSIGHT_CARDS || []).filter((c) => {
      if (insightFilter !== '全部' && c.tag !== insightFilter) return false;
      return true;
    });

    $('#insightList').innerHTML = cards
      .map(
        (c) => `<article class="cc${c.new ? ' cc--new' : ''}">
        <div class="cc-hd">
          <div class="cc-ico" style="background:${c.iconBg}">${c.icon}</div>
          <div>
            <div class="cc-type">${escapeHtml(c.type)}${c.new ? '<span class="new-badge">NEW</span>' : ''}</div>
            <div class="cc-title">${escapeHtml(c.title)}</div>
          </div>
        </div>
        <div class="cc-body">${escapeHtml(c.body)}</div>
        <div class="cc-srcs">${c.sources.map((s) => `<span class="csrc">${escapeHtml(s)}</span>`).join('')}</div>
        <div class="cc-foot">
          <div class="cc-pts">+${c.pts} PTS ${c.new ? '回充中…' : '已回充'}</div>
          <div class="cc-time${c.new ? ' cc-time--accent' : ''}">${escapeHtml(c.time)}</div>
        </div>
      </article>`
      )
      .join('');
  }

  function renderShop() {
    $('#ptsShop').textContent = formatPts(state.pts);
    const items = window.SHOP_ITEMS || [];
    const rewards = items.filter((i) => !i.action);
    const special = items.filter((i) => i.action);

    $('#shopRewards').innerHTML = rewards
      .map((item) => {
        const ok = item.affordable || state.pts >= item.cost;
        return `<button type="button" class="ri" data-cost="${item.cost}" data-id="${item.id}">
          <div class="ri-emoji">${item.emoji}</div>
          <div class="ri-info"><div class="ri-name">${escapeHtml(item.name)}</div><div class="ri-desc">${escapeHtml(item.desc)}</div></div>
          <div class="ri-cost${ok ? ' ok' : ''}">${item.cost}</div>
        </button>`;
      })
      .join('');

    $('#shopSpecial').innerHTML = special
      .map((item) => {
        const cls = item.free ? ' free' : item.accent ? '' : '';
        const style = item.accent ? ' style="background:var(--accent2)"' : '';
        return `<button type="button" class="ri" data-action="${item.action}">
          <div class="ri-emoji">${item.emoji}</div>
          <div class="ri-info"><div class="ri-name">${escapeHtml(item.name)}</div><div class="ri-desc">${escapeHtml(item.desc)}</div></div>
          <div class="ri-cost${cls}"${style}>Free</div>
        </button>`;
      })
      .join('');

    $('#shopRewards').querySelectorAll('.ri').forEach((el) => {
      el.addEventListener('click', () => {
        const cost = Number(el.dataset.cost);
        if (state.pts >= cost) {
          state.pts -= cost;
          saveState();
          renderShop();
        }
      });
    });

    $('#shopSpecial').querySelectorAll('.ri').forEach((el) => {
      el.addEventListener('click', () => {
        if (el.dataset.action === 'rabbit') openHF();
        if (el.dataset.action === 'eraser') {
          renderEraser();
          showScreen('screen-eraser');
        }
      });
    });
  }

  function spinSlot() {
    ['reel1', 'reel2', 'reel3'].forEach((id, i) => {
      let n = 0;
      const iv = setInterval(() => {
        $(`#${id}`).textContent = SLOT_EMOJIS[Math.floor(Math.random() * SLOT_EMOJIS.length)];
        n += 1;
        if (n > 8 + i * 5) {
          clearInterval(iv);
          if (i === 2) {
            state.pts += 100;
            state.todayPts += 100;
            saveState();
            renderShop();
          }
        }
      }, 70 + i * 25);
    });
  }

  function renderStats() {
    const weekTotal = state.minutesWeek.reduce((a, b) => a + b, 0);
    $('#statGrid').innerHTML = `
      <div class="stat-card"><div class="sc-icon">📖</div><div class="sc-val">${state.absorbed}</div><div class="sc-unit">段脱水吸收</div></div>
      <div class="stat-card"><div class="sc-icon">🔥</div><div class="sc-val">${state.streak}</div><div class="sc-unit">天连续阅读</div></div>
      <div class="stat-card"><div class="sc-icon">✦</div><div class="sc-val">${state.collisions}</div><div class="sc-unit">次知识对撞</div></div>
      <div class="stat-card"><div class="sc-icon">🎰</div><div class="sc-val">${formatPts(state.pts)}</div><div class="sc-unit">总积分</div></div>
      <div class="stat-card wide">
        <div class="sc-icon">📅</div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:6px">
          <div class="sc-val" style="font-size:16px">本周阅读 ${weekTotal} 分钟</div>
          <div style="font-family:var(--font-mono);font-size:12px;color:var(--accent)">+18% ↑</div>
        </div>
        <div class="bar-chart">
          ${['一', '二', '三', '四', '五', '六', '日']
            .map((lbl, i) => {
              const h = state.minutesWeek[i] || 4;
              const op = i === 6 ? ' style="opacity:.4"' : '';
              return `<div class="bar-col"><div class="bar-fill" style="height:${h}px"${op}></div><div class="bar-lbl">${lbl}</div></div>`;
            })
            .join('')}
        </div>
      </div>`;

    $('#heatmap').innerHTML = state.heatmap
      .map((l) => `<div class="hm-cell${l ? ` l${Math.min(l, 4)}` : ''}"></div>`)
      .join('');

    $('#perspWheel').innerHTML = PERSP_WHEEL.map((t) => {
      const locked = t.startsWith('🔒');
      return `<span class="pw-tag${locked ? ' pw-tag--locked' : ''}">${escapeHtml(t)}</span>`;
    }).join('');
  }

  function renderEraser() {
    const done = state.vaporized
      .map((id) => allBooks().find((b) => b.id === id))
      .filter(Boolean);
    const active = activeBooks();

    let html = '<div style="font-size:10px;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">📚 可蒸发的书目</div>';
    html += active
      .map((b) => {
        const p = bookProgress(b.id);
        return `<div class="er-book" data-id="${b.id}">
          <div class="er-spine" style="background:${b.spine.gradient}">${escapeHtml(b.spine.label)}</div>
          <div class="er-info">
            <div class="er-title">${escapeHtml(b.title)}</div>
            <div class="er-meta">已吸收 ${p.absorbed || 0} 段 · 进度 ${p.percent}%</div>
            <div class="er-prog-row">
              <div class="er-prog"><div class="er-pf" style="width:${p.percent}%;background:${b.spine.gradient}"></div></div>
              <div class="er-pct">${p.percent}%</div>
            </div>
          </div>
          <button type="button" class="vaporize-btn" data-vapor="${b.id}">蒸发</button>
        </div>`;
      })
      .join('');

    if (done.length) {
      html += '<div style="font-size:10px;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin:16px 0 10px">🌫️ 已蒸发 · 资产保留中</div>';
      html += done
        .map(
          (b) => `<div class="er-book er-book--done">
          <div class="er-spine" style="background:linear-gradient(135deg,rgba(123,94,167,.3),rgba(92,62,138,.3))">🌫️</div>
          <div class="er-info">
            <div class="er-title" style="color:var(--ink3)">${escapeHtml(b.title)}</div>
            <div class="er-meta">资产已入库 · 进度已归零</div>
            <div class="er-prog-row"><div class="er-prog"><div class="er-pf" style="width:0%"></div></div><div class="er-pct" style="color:var(--accent2)">0%</div></div>
          </div>
          <button type="button" class="vaporize-btn" disabled>已蒸发</button>
        </div>`
        )
        .join('');
    }

    $('#eraserList').innerHTML = html;
    $('#eraserList').querySelectorAll('[data-vapor]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        vaporizeBook(btn.dataset.vapor);
      });
    });
  }

  function vaporizeBook(id) {
    const anim = $('#vaporAnim');
    anim.classList.add('show');
    setTimeout(() => {
      anim.classList.remove('show');
      if (!state.vaporized.includes(id)) state.vaporized.push(id);
      saveState();
      renderEraser();
      renderHome();
    }, 1600);
  }

  function renderOnboard() {
    const steps = window.ONBOARD_STEPS || [];
    const s = steps[obIdx] || steps[0];
    $('#obIcon').textContent = s.icon;
    $('#obTitle').textContent = s.title;
    $('#obBody').textContent = s.body;
    $('#obDots').innerHTML = steps.map((_, i) => `<div class="osd${i === obIdx ? ' on' : ''}"></div>`).join('');
    $('#obNext').textContent = obIdx === steps.length - 1 ? '开始阅读 →' : '继续 →';
  }

  function finishOnboard() {
    state.onboarded = true;
    saveState();
    showScreen('screen-home');
    renderHome();
  }

  function renderThemeDots() {
    $('#themeDots').innerHTML = THEMES.map((t) => {
      const active = state.prefs.theme === t.id ? ' active' : '';
      return `<button type="button" class="acd${active}" style="background:${t.bg}" data-theme="${t.id}" aria-label="${t.id}"></button>`;
    }).join('');
    $('#themeDots').querySelectorAll('.acd').forEach((btn) => {
      btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
    });
  }

  function openSettings() {
    $$('.sopts').forEach((group) => {
      const pref = group.dataset.pref;
      const val = state.prefs[pref];
      group.querySelectorAll('.ob').forEach((b) => b.classList.toggle('active', b.dataset.val === String(val)));
    });
    $('#settingsOverlay').classList.add('show');
  }

  function closeSettings() {
    $('#settingsOverlay').classList.remove('show');
  }

  function openHF() {
    $('#hfOverlay').classList.add('show');
    let s = 300;
    $('#hfTimer').textContent = '5:00';
    hfTimer = setInterval(() => {
      s -= 1;
      const m = Math.floor(s / 60);
      const sec = s % 60;
      $('#hfTimer').textContent = `${m}:${sec < 10 ? '0' : ''}${sec}`;
      if (s <= 0) closeHF();
    }, 1000);
  }

  function closeHF() {
    if (hfTimer) clearInterval(hfTimer);
    hfTimer = null;
    $('#hfOverlay').classList.remove('show');
    $('#hfTimer').textContent = '5:00';
  }

  function toggleTTS() {
    ttsPlaying = !ttsPlaying;
    $('#ttsPlay').textContent = ttsPlaying ? '⏸' : '▶';
    $$('.tw').forEach((t) => {
      t.style.animationPlayState = ttsPlaying ? 'running' : 'paused';
    });
  }

  function cycleSpeed() {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    $('#ttsSpd').textContent = SPEEDS[speedIdx];
  }

  function setImportStatus(msg, type) {
    const el = $('#importStatus');
    el.hidden = !msg;
    el.textContent = msg || '';
    el.className = 'import-status' + (type ? ` import-status--${type}` : '');
  }

  function renderImportManage() {
    const list = importedBooks;
    const wrap = $('#importManage');
    if (!list.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    $('#importList').innerHTML = list
      .map((b) => {
        const lines = BookImport ? BookImport.lineCount(b) : 0;
        return `<div class="import-item" data-id="${b.id}">
          <div class="import-item-info">
            <div class="import-item-title">${escapeHtml(b.title)}</div>
            <div class="import-item-meta">${escapeHtml(b.format || '导入')} · ${lines} 脱水行</div>
          </div>
          <button type="button" class="import-del" data-del="${b.id}">删除</button>
        </div>`;
      })
      .join('');
    $('#importList').querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('确定删除这本导入的书？')) return;
        await BookImport.deleteBook(btn.dataset.del);
        state.vaporized = state.vaporized.filter((id) => id !== btn.dataset.del);
        delete state.books[btn.dataset.del];
        saveState();
        await refreshImportedBooks();
        renderImportManage();
        renderHome();
      });
    });
  }

  function openImport() {
    pendingImportFile = null;
    $('#importFile').value = '';
    $('#importTitle').value = '';
    $('#importAuthor').value = '';
    $('#importPaste').value = '';
    $('#importFileName').textContent = '最大 48MB';
    $('#importDrop').classList.remove('has-file');
    setImportStatus('', '');
    $('#importSubmit').disabled = false;
    renderImportManage();
    $('#importOverlay').classList.add('show');
  }

  function closeImport() {
    $('#importOverlay').classList.remove('show');
    setImportStatus('', '');
  }

  async function submitImport() {
    if (!window.BookImport) {
      setImportStatus('导入模块未加载', 'err');
      return;
    }

    const title = $('#importTitle').value.trim();
    const author = $('#importAuthor').value.trim();
    const paste = $('#importPaste').value.trim();
    const btn = $('#importSubmit');

    btn.disabled = true;
    setImportStatus('正在解析并脱水拆行…', 'busy');

    try {
      let book;
      if (pendingImportFile) {
        book = await BookImport.parseFile(pendingImportFile, { title: title || undefined, author: author || undefined });
      } else if (paste) {
        book = BookImport.parsePastedText(paste, {
          title: title || '粘贴导入',
          author: author || '导入',
        });
      } else {
        throw new Error('请选择文件，或粘贴正文');
      }

      const lines = BookImport.lineCount(book);
      if (lines < 1) throw new Error('没有生成可阅读的行');

      await BookImport.saveBook(book);
      await refreshImportedBooks();

      setImportStatus(`已导入「${book.title}」· ${lines} 行脱水焦点`, 'ok');
      renderImportManage();
      renderHome();

      setTimeout(() => {
        closeImport();
        openBook(book.id);
      }, 500);
    } catch (err) {
      setImportStatus(err.message || '导入失败', 'err');
      btn.disabled = false;
    }
  }

  function bindEvents() {
    $$('.nb').forEach((btn) => {
      btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });

    $('#readBack').addEventListener('click', closeReader);
    $('#btnImport').addEventListener('click', openImport);
    $('#importClose').addEventListener('click', closeImport);
    $('#importOverlay').addEventListener('click', (e) => {
      if (e.target === $('#importOverlay')) closeImport();
    });
    $('#importSubmit').addEventListener('click', submitImport);

    $('#importFile').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      pendingImportFile = file || null;
      if (file) {
        $('#importDrop').classList.add('has-file');
        $('#importFileName').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)}MB`;
        if (!$('#importTitle').value.trim()) $('#importTitle').value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      } else {
        $('#importDrop').classList.remove('has-file');
        $('#importFileName').textContent = '最大 48MB';
      }
    });

    $('#importDrop').addEventListener('click', () => $('#importFile').click());
    $('#importDrop').addEventListener('dragover', (e) => {
      e.preventDefault();
      $('#importDrop').classList.add('has-file');
    });
    $('#importDrop').addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      pendingImportFile = file;
      $('#importDrop').classList.add('has-file');
      $('#importFileName').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)}MB`;
      if (!$('#importTitle').value.trim()) $('#importTitle').value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    });

    $('#btnStats').addEventListener('click', () => {
      renderStats();
      showScreen('screen-stats');
    });
    $('#statsBack').addEventListener('click', () => showScreen('screen-home'));
    $('#eraserBack').addEventListener('click', () => showScreen('screen-shop'));

    $('#readCol').addEventListener('scroll', () => {
      if (state.prefs.focus === 'line') updateFocusLine();
    });

    $('#focusWrap').addEventListener('click', (e) => {
      const line = e.target.closest('.tl');
      if (!line) return;
      const i = Number(line.dataset.i);
      if (e.target.closest('.hbub')) return;
      const bubble = line.querySelector('.hbub');
      if (bubble) {
        const open = bubble.classList.contains('show');
        $$('.hbub').forEach((b) => b.classList.remove('show'));
        bubble.classList.toggle('show', !open);
        return;
      }
      reader.lineIndex = i;
      updateFocusLine();
      absorbLine(i);
    });

    $('#comboBadge').addEventListener('click', () => {
      state.combo += 1;
      saveState();
      $('#comboBadge').textContent = `🔥 ×${state.combo}`;
      showToast();
    });

    $('#btnSettings').addEventListener('click', openSettings);
    $('#settingsClose').addEventListener('click', closeSettings);
    $('#settingsOverlay').addEventListener('click', (e) => {
      if (e.target === $('#settingsOverlay')) closeSettings();
    });

    $$('.sopts').forEach((group) => {
      group.querySelectorAll('.ob').forEach((btn) => {
        btn.addEventListener('click', () => {
          group.querySelectorAll('.ob').forEach((x) => x.classList.remove('active'));
          btn.classList.add('active');
          state.prefs[group.dataset.pref] = btn.dataset.val;
          saveState();
        });
      });
    });

    $('#ttsPlay').addEventListener('click', toggleTTS);
    $('#ttsSpd').addEventListener('click', cycleSpeed);
    $('#slotMachine').addEventListener('click', spinSlot);
    $('#hfClose').addEventListener('click', closeHF);

    $('#obNext').addEventListener('click', () => {
      const steps = window.ONBOARD_STEPS || [];
      if (obIdx >= steps.length - 1) finishOnboard();
      else {
        obIdx += 1;
        renderOnboard();
      }
    });
    $('#obSkip').addEventListener('click', finishOnboard);

    $('#weekPill').addEventListener('click', () => {
      weekIdx = (weekIdx + 1) % WEEKS.length;
      $('#weekPill').textContent = `${WEEKS[weekIdx]} ▾`;
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopAbsorbSim();
      else if ($('#screen-read').classList.contains('active')) startAbsorbSim();
    });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  async function init() {
    applyTheme(state.prefs.theme);
    bindEvents();
    await refreshImportedBooks();
    renderThemeDots();
    renderHome();
    renderInsight();
    renderShop();

    if (!state.onboarded) {
      obIdx = 0;
      renderOnboard();
      showScreen('screen-onboard');
    } else {
      showScreen('screen-home');
    }

    registerServiceWorker();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
  else init();
})();
