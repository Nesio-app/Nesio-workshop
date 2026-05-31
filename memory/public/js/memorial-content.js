/**
 * Dynamic profile tabs, themes, home grid, QR, articles
 */
window.MemorialContent = {
  THEMES: [
    { id: "ink-default", name: "默认墨韵", cat: "ink", desc: "米色纸感与深墨字，庄重耐看，适合大多数纪念馆", preview: { bg: "#f4f3f0", fg: "#1a1a1a", accent: "#5b7268", paper: "#fafaf8", deco: "墨" } },
    { id: "ink-moon", name: "月白如霜", cat: "ink", desc: "冷调蓝灰，宁静深远，适合文人学者", preview: { bg: "#eef2f6", fg: "#1a2a3a", accent: "#5a7a9a", paper: "#f8fafc", deco: "月" } },
    { id: "plum-snow", name: "梅花傲雪", cat: "floral", desc: "淡粉与梅红点缀，温柔而不艳俗", preview: { bg: "#f8f0f0", fg: "#2a1a1a", accent: "#a05050", paper: "#fff8f8", deco: "梅" } },
    { id: "bamboo-wind", name: "竹影清风", cat: "ink", desc: "竹青与浅绿，清新自然", preview: { bg: "#eef5ee", fg: "#1a2a1a", accent: "#4a7a4a", paper: "#f6faf6", deco: "竹" } },
    { id: "peach-spring", name: "桃花春水", cat: "floral", desc: "春日桃粉，适合女性长辈与柔和气质", preview: { bg: "#faf0f4", fg: "#3a1a2a", accent: "#b06080", paper: "#fff5f8", deco: "桃" } },
    { id: "qingming", name: "清明谷雨", cat: "seasonal", desc: "雨后天青，清明时节专用氛围", preview: { bg: "#eef6f0", fg: "#1a2a20", accent: "#3a6a4a", paper: "#f4faf6", deco: "雨" } },
    { id: "bailu", name: "白露秋风", cat: "seasonal", desc: "秋意渐浓，金风玉露", preview: { bg: "#f2f2f6", fg: "#2a2a3a", accent: "#6a7a9a", paper: "#f8f8fc", deco: "露" } },
    { id: "zen-cloud", name: "云水禅心", cat: "modern", desc: "灰褐禅意，简约克制", preview: { bg: "#f4f2ee", fg: "#2a2a2a", accent: "#8a7a50", paper: "#faf9f6", deco: "禅" } },
    { id: "osmanthus", name: "金桂飘香", cat: "floral", desc: "金秋桂色，温暖明亮", preview: { bg: "#faf6ee", fg: "#2a1a0a", accent: "#b8860b", paper: "#fffcf5", deco: "桂" } },
    { id: "snow", name: "立冬初雪", cat: "seasonal", desc: "雪夜蓝灰，静谧肃穆", preview: { bg: "#eef0f8", fg: "#1a1a2a", accent: "#5a6a8a", paper: "#f8f9fc", deco: "雪" } },
    { id: "ink-mountain", name: "水墨山河", cat: "ink", desc: "远山层叠，水墨意境", preview: { bg: "#ececec", fg: "#1a1a1a", accent: "#666", paper: "#f5f5f5", deco: "山" } },
    { id: "lotus", name: "浅草青荷", cat: "floral", desc: "莲池青绿，清净安详", preview: { bg: "#eef8f4", fg: "#0a1a1a", accent: "#3a9a7a", paper: "#f6fffa", deco: "荷" } },
    { id: "minimal", name: "素简留白", cat: "modern", desc: "大量留白，现代杂志排版感", preview: { bg: "#ffffff", fg: "#222", accent: "#666", paper: "#fafafa", deco: "白" } },
  ],

  themeCatLabel(cat) {
    const map = { ink: "水墨传统", floral: "花卉自然", modern: "简约现代", seasonal: "节气时令" };
    return map[cat] || cat;
  },

  _articles: null,

  escape: MemorialStore.escapeHtml.bind(MemorialStore),

  formatYears(m) {
    const fmt = (d) => {
      if (!d) return "";
      const p = d.split("-");
      return p[0] + "年" + parseInt(p[1], 10) + "月" + parseInt(p[2], 10) + "日";
    };
    let age = "";
    if (m.birthDate && m.deathDate) {
      const a =
        parseInt(m.deathDate.slice(0, 4), 10) -
        parseInt(m.birthDate.slice(0, 4), 10);
      if (a > 0) age = " · 享年" + a + "岁";
    }
    if (m.birthDate && m.deathDate) {
      return fmt(m.birthDate) + " — " + fmt(m.deathDate) + age;
    }
    return (m.birthDate || "—") + " — " + (m.deathDate || "—");
  },

  avatarChar(name) {
    return (name || "?").trim().charAt(0);
  },

  avatarGradient(name) {
    const hues = [
      ["#4a7a5a", "#2d5a3a"],
      ["#7a3a5a", "#5a2a3a"],
      ["#3a5a7a", "#2a3a5a"],
      ["#7a6a3a", "#5a4a2a"],
    ];
    const i = (name || "").charCodeAt(0) % hues.length;
    return "linear-gradient(135deg," + hues[i][0] + "," + hues[i][1] + ")";
  },

  applyTheme(themeId) {
    document.body.setAttribute("data-theme", themeId || "ink-default");
  },

  renderProfileHero(m) {
    const page = document.getElementById("page-profile-li");
    if (!page || !m) return;
    const char = this.avatarChar(m.name);
    const av = page.querySelector(".profile-avatar");
    if (av) {
      av.textContent = char;
      av.style.background = this.avatarGradient(m.name);
    }
    const nameEl = page.querySelector(".profile-name");
    if (nameEl) nameEl.textContent = m.name;
    const yearsEl = page.querySelector(".profile-years");
    if (yearsEl) yearsEl.textContent = this.formatYears(m);
    const mottoEl = page.querySelector(".profile-motto");
    if (mottoEl) {
      mottoEl.innerHTML = m.motto
        ? "「" + this.escape(m.motto) + "」"
        : "";
    }
    this.applyTheme(m.themeId);
  },

  renderBioTab(m) {
    const el = document.getElementById("tab-bio-li");
    if (!el) return;
    const bio =
      m.bioHtml ||
      "<p class=\"p0-empty\">家属尚未撰写生平故事。可通过「撰写讣告」生成并发布到此处。</p>";
    const note = m.familyNote
      ? `<div class="family-note"><p class="family-note-text">${this.escape(m.familyNote).replace(/\n/g, "<br>")}</p></div>`
      : "";
    el.innerHTML = `<div class="bio-section"><div class="bio-intro">${bio}</div>${note}</div>`;
  },

  renderGalleryTab(m) {
    const el = document.getElementById("tab-gallery-li");
    if (!el) return;
    const items = m.gallery || [];
    const canEdit =
      window.MemorialCore?.canEdit && window.MemorialCore?.useApi;
    const uploadBlock = canEdit
      ? `<div class="gallery-upload">
          <p class="gallery-upload-hint">上传珍贵照片（JPG/PNG/WebP，最大 4MB）${
            window.MEMORIAL_CONFIG?.storageEnabled
              ? " · 已启用云存储"
              : " · 未配置云存储时重启后图片可能丢失"
          }</p>
          <div class="gallery-upload-row">
            <input type="file" id="gallery-file" accept="image/jpeg,image/png,image/webp,image/gif" />
            <input type="text" id="gallery-caption" placeholder="照片说明" />
            <input type="text" id="gallery-year" placeholder="年份（可选）" />
            <button type="button" class="submit-btn" onclick="MemorialContent.uploadGalleryPhoto()">上传</button>
          </div>
        </div>`
      : "";
    if (!items.length && !canEdit) {
      el.innerHTML = `<p class="p0-empty">暂无影像，家人可后续上传珍贵照片。</p>`;
      return;
    }
    const grid =
      items.length > 0
        ? `<div class="gallery-grid">` +
          items
            .map((item, idx) => {
              const imgSrc = item.imageUrl
                ? window.MemorialApi
                  ? MemorialApi.assetUrl(item.imageUrl)
                  : item.imageUrl
                : "";
              const visual = imgSrc
                ? `<img src="${this.escape(imgSrc)}" alt="${this.escape(item.caption)}" class="gallery-photo" onclick="MemorialContent.openGalleryLightbox(${idx})" loading="lazy" />`
                : `<div class="gallery-placeholder" style="background:linear-gradient(135deg,#2d4a2a,#1a3a2a);min-height:140px;display:flex;align-items:center;justify-content:center;font-size:48px">${item.emoji || "📸"}</div>`;
              const del =
                canEdit && item.id
                  ? `<button type="button" class="gallery-del" onclick="event.stopPropagation();MemorialContent.deleteGalleryPhoto('${this.escape(item.id)}')">删除</button>`
                  : "";
              return `
      <div class="gallery-item">
        ${visual}
        <div class="gallery-caption">${this.escape(item.caption)}${item.yearLabel ? " · " + this.escape(item.yearLabel) : ""}</div>
        ${del}
      </div>`;
            })
            .join("") +
          `</div>`
        : `<p class="p0-empty">尚无照片，请使用上方表单上传。</p>`;
    el.innerHTML = uploadBlock + grid;
    this._galleryItems = items;
  },

  openGalleryLightbox(idx) {
    const item = (this._galleryItems || [])[idx];
    if (!item?.imageUrl) return;
    const overlay = document.getElementById("gallery-lightbox");
    if (!overlay) return;
    const src = window.MemorialApi
      ? MemorialApi.assetUrl(item.imageUrl)
      : item.imageUrl;
    document.getElementById("gallery-lightbox-img").src = src;
    document.getElementById("gallery-lightbox-cap").textContent =
      (item.caption || "") + (item.yearLabel ? " · " + item.yearLabel : "");
    overlay.classList.add("open");
  },

  closeGalleryLightbox() {
    document.getElementById("gallery-lightbox")?.classList.remove("open");
  },

  async uploadGalleryPhoto() {
    const slug = window.MemorialCore?.slug;
    if (!slug || !MemorialCore.useApi) {
      showToast("请先登录后再上传");
      return;
    }
    const file = document.getElementById("gallery-file")?.files?.[0];
    if (!file) {
      showToast("请选择图片");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append(
      "caption",
      document.getElementById("gallery-caption")?.value || "珍贵影像"
    );
    const year = document.getElementById("gallery-year")?.value?.trim();
    if (year) fd.append("yearLabel", year);
    try {
      const data = await MemorialApi.uploadMedia(slug, fd);
      if (data.media?.imageUrl && window.MemorialApi) {
        data.media.imageUrl = MemorialApi.assetUrl(data.media.imageUrl);
      }
      const m = MemorialStore.get(slug) || {};
      m.gallery = m.gallery || [];
      m.gallery.push(data.media);
      MemorialStore.update(slug, { gallery: m.gallery });
      this.renderGalleryTab(MemorialStore.get(slug));
      document.getElementById("gallery-file").value = "";
      showToast("照片已上传");
    } catch (e) {
      showToast(e.message);
    }
  },

  async deleteGalleryPhoto(id) {
    const slug = window.MemorialCore?.slug;
    if (!slug || !confirm("确定删除这张照片？")) return;
    try {
      await MemorialApi.deleteMedia(slug, id);
      const m = MemorialStore.get(slug);
      if (m?.gallery) {
        m.gallery = m.gallery.filter((g) => g.id !== id);
        MemorialStore.update(slug, { gallery: m.gallery });
      }
      this.renderGalleryTab(MemorialStore.get(slug));
      showToast("已删除");
    } catch (e) {
      showToast(e.message);
    }
  },

  renderTimelineTab(m) {
    const el = document.getElementById("tab-timeline-li");
    if (!el) return;
    const events = m.timeline || [];
    if (!events.length) {
      el.innerHTML = `<p class="p0-empty">人生历程待家人补充。</p>`;
      return;
    }
    el.innerHTML =
      `<div class="timeline">` +
      events
        .map(
          (e) => `
      <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-year">${this.escape(e.yearLabel)}</div>
        <div class="timeline-event">${this.escape(e.title)}</div>
        ${e.description ? `<div class="timeline-desc">${this.escape(e.description)}</div>` : ""}
      </div>`
        )
        .join("") +
      `</div>`;
  },

  renderFamilyTab(m) {
    const el = document.getElementById("tab-family-li");
    if (!el) return;
    const people = m.family || [];
    if (!people.length) {
      el.innerHTML = `<p class="p0-empty">家族关系待补充。</p>`;
      return;
    }
    const groups = {};
    people.forEach((p) => {
      if (!groups[p.groupLabel]) groups[p.groupLabel] = [];
      groups[p.groupLabel].push(p);
    });
    el.innerHTML =
      `<div class="family-tree">` +
      Object.entries(groups)
        .map(
          ([label, list]) => `
      <div class="family-group-title">${this.escape(label)}</div>
      ${list
        .map(
          (p) => `
      <div class="family-person">
        <div class="family-ava" style="background:${this.avatarGradient(p.name)}">${this.escape(p.avatarChar || this.avatarChar(p.name))}</div>
        <div class="family-info"><div class="name">${this.escape(p.name)}</div><div class="rel">${this.escape(p.relation)}</div></div>
      </div>`
        )
        .join("")}`
        )
        .join("") +
      `</div>`;
  },

  renderGuestbookTab(m) {
    const list = document.getElementById("messages-li");
    if (!list) return;
    const msgs = (m.fragments || []).filter(
      (f) =>
        f.status === "approved" &&
        (f.relation || "").includes("留言")
    );
    if (!msgs.length) {
      list.innerHTML = `<p class="p0-empty" style="padding:16px">暂无留言，成为第一位送上祝福的人。</p>`;
      return;
    }
    list.innerHTML = msgs
      .map((f) => {
        const when = f.at
          ? new Date(f.at).toLocaleDateString("zh-CN")
          : "近日";
        return `<div class="message-item">
          <div class="message-top"><span class="message-author">${this.escape(f.author || "匿名")}</span><span class="message-time">${when}</span></div>
          <div class="message-text">${this.escape(f.content)}</div>
          <div class="message-candle">🕯️</div>
        </div>`;
      })
      .join("");
  },

  renderAllProfileTabs(m) {
    if (!m) return;
    this.renderProfileHero(m);
    this.renderBioTab(m);
    this.renderGalleryTab(m);
    this.renderTimelineTab(m);
    this.renderFamilyTab(m);
    this.renderGuestbookTab(m);
  },

  async loadHomeMemorials(useApi) {
    const grid = document.querySelector(".memorials-grid");
    if (!grid) return;
    if (!useApi) return;

    try {
      const data = await MemorialApi.listPublicMemorials();
      const list = data.memorials || [];
      if (!list.length) return;

      const cards = list.slice(0, 3).map((m) => {
        const char = this.avatarChar(m.name);
        const grad = this.avatarGradient(m.name);
        const birth = m.birthDate ? m.birthDate.slice(0, 4) : "—";
        const death = m.deathDate ? m.deathDate.slice(0, 4) : "—";
        return `
        <div class="memorial-card" onclick="MemorialCore.openMemorial('${this.escape(m.slug)}')">
          <div class="memorial-header" style="background:${grad}">
            <div class="memorial-avatar" style="background:${grad}">${char}</div>
          </div>
          <div class="memorial-body">
            <div class="memorial-name">${this.escape(m.name)}</div>
            <div class="memorial-years">${birth} — ${death}</div>
            <div class="memorial-quote">${this.escape(m.motto || "")}</div>
          </div>
          <div class="memorial-footer">
            <div class="memorial-acts">🕯️ 前往纪念</div>
            <button class="memorial-btn">进入纪念馆</button>
          </div>
        </div>`;
      });

      cards.push(`
        <div class="memorial-card" onclick="goPage('create')">
          <div class="memorial-header" style="background:linear-gradient(135deg,#2a1a0a,#4a2a10)">
            <div class="memorial-avatar" style="background:linear-gradient(135deg,#7a4a20,#4a2a10)">+</div>
          </div>
          <div class="memorial-body">
            <div class="memorial-name">创建纪念馆</div>
            <div class="memorial-years">为亲人留下永恒记忆</div>
            <div class="memorial-quote">每一位逝者都值得被温柔记住</div>
          </div>
          <div class="memorial-footer">
            <div class="memorial-acts">✨ 免费创建</div>
            <button class="memorial-btn">开始创建</button>
          </div>
        </div>`);

      grid.innerHTML = cards.join("");
    } catch (e) {
      console.warn("home memorials:", e.message);
    }
  },

  renderQrDemo(slug, m) {
    const wrap = document.querySelector("#page-qr .qr-svg-wrap");
    const nameEl = document.querySelector("#page-qr .qr-demo-name");
    const yearsEl = document.querySelector("#page-qr .qr-demo-years");
    if (nameEl && m) nameEl.textContent = m.name;
    if (yearsEl && m) {
      const b = m.birthDate ? m.birthDate.slice(0, 4) : "";
      const d = m.deathDate ? m.deathDate.slice(0, 4) : "";
      yearsEl.textContent = b && d ? b + " — " + d : "";
    }
    if (!wrap) return;
    if (MemorialCore.useApi && slug) {
      wrap.innerHTML = `<img src="${MemorialApi.base}/api/memorials/${encodeURIComponent(slug)}/qr" alt="纪念馆二维码" width="140" height="140" style="background:#fff;padding:8px;border-radius:8px" onerror="this.style.display='none'"/>`;
    }
  },

  renderThemesGrid(selectedId) {
    const grid = document.getElementById("themes-grid");
    if (!grid) return;
    const m = window.MemorialStore?.get(window.MemorialCore?.slug) || {};
    const sampleName = m.name || "纪念馆预览";
    const char = this.avatarChar(sampleName);
    grid.innerHTML = this.THEMES.map((t) => {
      const sel = selectedId === t.id;
      const p = t.preview;
      return `
      <div class="theme-card theme-card-rich ${sel ? "selected" : ""}" data-theme-id="${t.id}" data-cat="${t.cat}">
        <div class="theme-preview-rich" style="background:${p.bg};color:${p.fg}">
          <span class="theme-cat-pill">${this.themeCatLabel(t.cat)}</span>
          <div class="theme-mini-hero" style="background:${p.paper}">
            <div class="theme-mini-avatar" style="background:${p.accent}">${char}</div>
            <div class="theme-mini-name" style="color:${p.fg}">${this.escape(sampleName)}</div>
            <div class="theme-mini-line" style="background:${p.accent};opacity:.35"></div>
            <div class="theme-mini-line short" style="background:${p.accent};opacity:.2"></div>
          </div>
          <div class="theme-preview-deco">${p.deco}</div>
        </div>
        <div class="theme-info">
          <div class="theme-name">${t.name}</div>
          <p class="theme-desc">${this.escape(t.desc || "")}</p>
        </div>
        <button type="button" class="theme-select-btn" onclick="MemorialContent.pickTheme('${t.id}')">${sel ? "✓ 已应用" : "应用此主题"}</button>
      </div>`;
    }).join("");
  },

  async pickTheme(themeId) {
    const theme = this.THEMES.find((t) => t.id === themeId);
    this.applyTheme(themeId);
    this.renderThemesGrid(themeId);
    showToast("已选择「" + (theme?.name || themeId) + "」主题");

    if (window.MemorialCore?.useApi && MemorialCore.canEdit) {
      try {
        await MemorialApi.patchMemorial(MemorialCore.slug, { themeId });
        MemorialStore.update(MemorialCore.slug, { themeId });
      } catch (e) {
        showToast(e.message);
      }
    } else {
      MemorialStore.update(MemorialCore?.slug || MemorialStore.DEFAULT_SLUG, {
        themeId,
      });
    }
  },

  filterThemes(cat, activeEl) {
    document.querySelectorAll(".themes-filter .filter-tag").forEach((t) => {
      t.classList.remove("active");
    });
    if (activeEl) activeEl.classList.add("active");
    document.querySelectorAll(".theme-card").forEach((card) => {
      const c = card.getAttribute("data-cat");
      card.style.display = cat === "all" || c === cat ? "block" : "none";
    });
  },

  async loadArticles(force) {
    if (this._articles && !force) return this._articles;
    if (window.MemorialCore?.useApi && window.MemorialApi) {
      try {
        const data = await MemorialApi.listArticles();
        this._articles = { articles: data.articles || [] };
        return this._articles;
      } catch {
        /* fall through */
      }
    }
    try {
      const res = await fetch("content/articles.json");
      this._articles = await res.json();
    } catch {
      this._articles = { articles: [] };
    }
    return this._articles;
  },

  async renderArticlesGrid(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `<p class="p0-empty" style="padding:16px">加载中…</p>`;
    const data = await this.loadArticles();
    const articles = data.articles || [];
    const list =
      containerId === "home-guides-grid" ? articles.slice(0, 3) : articles;
    if (!list.length) {
      el.innerHTML = `<p class="p0-empty">暂无文章</p>`;
      return;
    }
    el.innerHTML = list
      .map(
        (a) => `
      <div class="article-card" data-cat="${a.cat}" onclick="MemorialContent.openArticle('${this.escape(a.id)}')">
        <div class="article-card-img" style="background:${a.bg || "linear-gradient(135deg,#e8f4f8,#d0e8f0)"}">${a.emoji || "📖"}</div>
        <div class="article-card-body">
          <div class="article-cat">${this.escape(a.catLabel)}</div>
          <div class="article-title">${this.escape(a.title)}</div>
          <div class="article-summary">${this.escape(a.summary)}</div>
        </div>
      </div>`
      )
      .join("");
  },

  renderGuidesAdmin() {
    const box = document.getElementById("guides-admin");
    if (!box) return;
    const user = window.MemorialAuth?.user;
    if (!MemorialCore?.useApi || !user?.canManageContent) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
  },

  async submitGuideArticle() {
    const payload = {
      title: document.getElementById("ga-title")?.value?.trim(),
      cat: document.getElementById("ga-cat")?.value || "custom",
      catLabel: document.getElementById("ga-catlabel")?.value?.trim() || "自定义",
      summary: document.getElementById("ga-summary")?.value?.trim(),
      body: document.getElementById("ga-body")?.value?.trim(),
      emoji: document.getElementById("ga-emoji")?.value?.trim() || "📖",
    };
    if (!payload.title || !payload.summary || !payload.body) {
      showToast("请填写标题、摘要与正文");
      return;
    }
    try {
      await MemorialApi.createArticle(payload);
      this._articles = null;
      await this.renderArticlesGrid("guides-articles-grid");
      await this.renderArticlesGrid("articles-li");
      showToast("文章已发布");
      document.getElementById("ga-title").value = "";
      document.getElementById("ga-summary").value = "";
      document.getElementById("ga-body").value = "";
    } catch (e) {
      showToast(e.message);
    }
  },

  async openArticle(id) {
    let article = null;
    if (window.MemorialCore?.useApi && window.MemorialApi) {
      try {
        const data = await MemorialApi.getArticle(id);
        article = data.article;
      } catch {
        /* fallback to cache/json */
      }
    }
    if (!article) {
      const data = await this.loadArticles();
      article = (data.articles || []).find((a) => a.id === id);
    }
    if (!article) {
      showToast("文章加载失败");
      return;
    }
    document.getElementById("article-modal-title").textContent = article.title;
    const body = (article.body || article.summary || "")
      .split("\n\n")
      .map((p) => `<p style="margin-top:12px">${this.escape(p)}</p>`)
      .join("");
    document.getElementById("article-modal-body").innerHTML = body;
    document.getElementById("article-modal").classList.add("open");
  },

  filterArticles(cat, activeEl, containerId) {
    const root =
      containerId === "guides"
        ? document.getElementById("page-guides")
        : document.getElementById("tab-grief-li") ||
          document.getElementById("page-guides");
    if (!root) return;
    root.querySelectorAll(".articles-filter .filter-tag").forEach((t) => {
      t.classList.remove("active");
    });
    if (activeEl) activeEl.classList.add("active");
    root.querySelectorAll(".article-card").forEach((card) => {
      card.style.display =
        cat === "all" || card.dataset.cat === cat ? "block" : "none";
    });
  },

  loadPlanningState() {
    try {
      const raw = localStorage.getItem("nianguichu_planning_v1");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },

  savePlanningState(state) {
    localStorage.setItem("nianguichu_planning_v1", JSON.stringify(state));
  },

  syncPlanningUI(state) {
    if (!window.planningData) return;
    window.taskState = state || {};
    planningData.forEach((cat, ci) => {
      cat.tasks.forEach((_, ti) => {
        const key = ci + "-" + ti;
        const el = document.getElementById("tc-" + ci + "-" + ti);
        if (el) el.classList.toggle("done", !!taskState[key]);
      });
    });
    if (typeof updateProgress === "function") updateProgress();
  },

  togglePlanningTask(ci, ti) {
    const key = ci + "-" + ti;
    if (!window.taskState) window.taskState = {};
    taskState[key] = !taskState[key];
    MemorialContent.savePlanningState(taskState);
    const el = document.getElementById("tc-" + ci + "-" + ti);
    if (el) el.classList.toggle("done", taskState[key]);
    if (typeof updateProgress === "function") updateProgress();
  },
};
