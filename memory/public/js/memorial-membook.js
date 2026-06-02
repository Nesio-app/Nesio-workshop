/**
 * Sample memorial books (bilingual) on the membook page.
 */
window.MemorialMembook = {
  samples: null,
  currentId: null,
  pageIndex: 0,

  async loadSamples() {
    if (this.samples) return this.samples;
    try {
      const res = await fetch("content/membook-samples.json");
      const data = await res.json();
      this.samples = data.samples || [];
    } catch {
      this.samples = [];
    }
    return this.samples;
  },

  isEn() {
    return window.MemorialI18n?.isEn?.();
  },

  t(zh, en) {
    return this.isEn() ? en : zh;
  },

  async renderPage() {
    const grid = document.getElementById("membook-samples-grid");
    const reader = document.getElementById("membook-reader");
    if (!grid) return;
    const list = await this.loadSamples();
    if (this.currentId) {
      grid.style.display = "none";
      if (reader) {
        reader.style.display = "block";
        this.renderReader();
      }
      return;
    }
    if (reader) reader.style.display = "none";
    grid.style.display = "grid";
    if (!list.length) {
      grid.innerHTML = `<p class="p0-empty">${this.t("暂无样本", "No samples yet")}</p>`;
      return;
    }
    grid.innerHTML = list
      .map((s) => {
        const title = this.isEn() ? s.titleEn : s.titleZh;
        const sub = this.isEn() ? s.subtitleEn : s.subtitleZh;
        const deco = s.cover?.deco || "册";
        const grad = s.cover?.gradient || "linear-gradient(135deg,#2a2a2a,#1a1a1a)";
        return `
        <article class="membook-sample-card" onclick="MemorialMembook.openSample('${MemorialStore.escapeHtml(s.id)}')">
          <div class="membook-sample-cover" style="background:${grad}">
            <span class="membook-sample-deco">${MemorialStore.escapeHtml(deco)}</span>
          </div>
          <div class="membook-sample-body">
            <h3>${MemorialStore.escapeHtml(title)}</h3>
            <p>${MemorialStore.escapeHtml(sub)}</p>
            <span class="membook-sample-cta">${this.t("阅读样本 →", "Read sample →")}</span>
          </div>
        </article>`;
      })
      .join("");
  },

  openSample(id) {
    this.currentId = id;
    this.pageIndex = 0;
    this.renderPage();
    const section = document.getElementById("membook-samples-section");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  },

  closeReader() {
    this.currentId = null;
    this.pageIndex = 0;
    this.renderPage();
  },

  sample() {
    return (this.samples || []).find((s) => s.id === this.currentId);
  },

  renderReader() {
    const root = document.getElementById("membook-reader");
    const s = this.sample();
    if (!root || !s) return;
    const pages = s.pages || [];
    const idx = Math.max(0, Math.min(this.pageIndex, pages.length - 1));
    const page = pages[idx];
    const title = this.isEn() ? s.titleEn : s.titleZh;
    const dedication = this.isEn() ? s.dedicationEn : s.dedicationZh;
    const pageTitle = this.isEn() ? page.titleEn : page.titleZh;
    const blocks = (page.blocks || [])
      .map((b) => {
        const text = this.isEn() ? b.en : b.zh;
        if (b.type === "title") return `<h2 class="membook-spread-title">${MemorialStore.escapeHtml(text)}</h2>`;
        if (b.type === "subtitle") return `<p class="membook-spread-sub">${MemorialStore.escapeHtml(text)}</p>`;
        if (b.type === "quote") return `<blockquote class="membook-spread-quote">${MemorialStore.escapeHtml(text)}</blockquote>`;
        return `<p class="membook-spread-p">${MemorialStore.escapeHtml(text)}</p>`;
      })
      .join("");
    const grad = s.cover?.gradient || "#2a2a2a";
  root.innerHTML = `
      <div class="membook-reader-toolbar">
        <button type="button" class="obit-back-btn" onclick="MemorialMembook.closeReader()">← ${this.t("返回样本列表", "All samples")}</button>
        <span class="membook-reader-meta">${MemorialStore.escapeHtml(title)} · ${idx + 1} / ${pages.length}</span>
      </div>
      <div class="membook-reader-layout">
        <aside class="membook-reader-cover" style="background:${grad}">
          <span class="membook-reader-deco">${MemorialStore.escapeHtml(s.cover?.deco || "")}</span>
          <p class="membook-reader-dedication">${MemorialStore.escapeHtml(dedication)}</p>
        </aside>
        <div class="membook-reader-spread">
          <p class="membook-spread-kicker">${MemorialStore.escapeHtml(pageTitle)}</p>
          ${blocks}
        </div>
      </div>
      <div class="membook-reader-nav">
        <button type="button" class="obit-action-btn" ${idx <= 0 ? "disabled" : ""} onclick="MemorialMembook.prevPage()">${this.t("上一页", "Previous")}</button>
        <button type="button" class="submit-btn" onclick="MemorialMembook.nextPage()">${idx >= pages.length - 1 ? this.t("读完", "Done") : this.t("下一页", "Next")}</button>
      </div>`;
  },

  prevPage() {
    if (this.pageIndex > 0) {
      this.pageIndex -= 1;
      this.renderReader();
    }
  },

  nextPage() {
    const s = this.sample();
    const max = (s?.pages?.length || 1) - 1;
    if (this.pageIndex < max) {
      this.pageIndex += 1;
      this.renderReader();
    } else {
      showToast(this.t("您已读完这本样本纪念册", "You finished this sample book"));
      this.closeReader();
    }
  },
};
