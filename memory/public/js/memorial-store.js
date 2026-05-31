/** localStorage 持久化（MVP：单设备演示，后续接 API） */
window.MemorialStore = {
  KEY: "nianguichu_memorial_v1",
  DEFAULT_SLUG: "li-mingde",

  defaultMemorial() {
    return {
      slug: this.DEFAULT_SLUG,
      name: "李明德",
      birthDate: "1938-04-03",
      deathDate: "2023-11-18",
      motto: "春蚕到死丝尽，蜡炬成灰泪始干",
      bioHtml:
        "<p>李明德先生，1938年4月3日出生于湖南省长沙市，2023年11月18日于家中安详辞世，享年85岁。</p><p>李先生自1962年起执教于长沙市第一中学，执教生涯长达36年，桃李满天下。</p>",
      familyNote:
        "父亲走了，带走了那扇永远亮着灯的窗。每个深夜，我们仍会想起您书房里飘出的墨香。",
      themeId: "ink-default",
      privacy: "family",
      quietMode: true,
      timeline: [
        { yearLabel: "1938年", title: "出生于湖南长沙", description: "在书香门第中成长" },
        { yearLabel: "1962年", title: "入职长沙市第一中学", description: "开始执教生涯" },
        { yearLabel: "2023年", title: "安然辞世", description: "在家人陪伴下安详离去" },
      ],
      family: [
        { groupLabel: "配偶", name: "陈美华", relation: "妻子 · 相伴63载", avatarChar: "美" },
        { groupLabel: "子女", name: "李欣然", relation: "女儿 · 医师", avatarChar: "欣" },
      ],
      gallery: [
        { caption: "退休典礼", emoji: "📸", yearLabel: "1998年" },
        { caption: "书法作品", emoji: "🖋️", yearLabel: "2015年" },
      ],
      rituals: [],
      fragments: [],
      reminders: [],
      tributeCounts: { 蜡烛: 3247, 鲜花: 2186, 焚香: 1840, 贡品: 967, 心语: 4520 },
    };
  },

  loadAll() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return { memorials: { [this.DEFAULT_SLUG]: this.defaultMemorial() } };
      const data = JSON.parse(raw);
      if (!data.memorials) data.memorials = {};
      if (!data.memorials[this.DEFAULT_SLUG]) {
        data.memorials[this.DEFAULT_SLUG] = this.defaultMemorial();
      }
      return data;
    } catch {
      return { memorials: { [this.DEFAULT_SLUG]: this.defaultMemorial() } };
    }
  },

  saveAll(data) {
    localStorage.setItem(this.KEY, JSON.stringify(data));
  },

  get(slug = this.DEFAULT_SLUG) {
    const data = this.loadAll();
    return data.memorials[slug] || null;
  },

  update(slug, patch) {
    const data = this.loadAll();
    data.memorials[slug] = { ...(data.memorials[slug] || this.defaultMemorial()), ...patch, slug };
    this.saveAll(data);
    return data.memorials[slug];
  },

  addRitual(slug, { type, message, author }) {
    const m = this.get(slug);
    if (!m) return null;
    const entry = {
      id: "r_" + Date.now(),
      type,
      message: (message || "").trim(),
      author: (author || "").trim() || "家人",
      at: new Date().toISOString(),
    };
    m.rituals = [entry, ...(m.rituals || [])];
    const key = type === "蜡烛" ? "蜡烛" : type === "鲜花" ? "鲜花" : type === "焚香" ? "焚香" : type === "贡品" ? "贡品" : "心语";
    m.tributeCounts = m.tributeCounts || {};
    m.tributeCounts[key] = (m.tributeCounts[key] || 0) + 1;
    this.update(slug, m);
    return entry;
  },

  addFragment(slug, { content, relation, year, author }) {
    const m = this.get(slug);
    if (!m) return null;
    const entry = {
      id: "f_" + Date.now(),
      content: (content || "").trim(),
      relation: (relation || "").trim(),
      year: (year || "").trim(),
      author: (author || "").trim() || "家人",
      status: "pending",
      at: new Date().toISOString(),
    };
    m.fragments = [entry, ...(m.fragments || [])];
    this.update(slug, m);
    return entry;
  },

  approveFragment(slug, id) {
    const m = this.get(slug);
    if (!m) return;
    m.fragments = (m.fragments || []).map((f) =>
      f.id === id ? { ...f, status: "approved" } : f
    );
    this.update(slug, m);
  },

  addReminder(slug, email) {
    const m = this.get(slug);
    if (!m) return;
    const e = (email || "").trim();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
    if ((m.reminders || []).some((r) => r.email === e)) return true;
    m.reminders = [{ email: e, at: new Date().toISOString() }, ...(m.reminders || [])];
    this.update(slug, m);
    return true;
  },

  createMemorial({ name, birthDate, deathDate, motto, privacy, quietMode }) {
    const slug =
      "m_" +
      Date.now().toString(36) +
      "_" +
      (name || "memorial").replace(/\s+/g, "").slice(0, 8);
    const memorial = {
      slug,
      name: name || "未命名",
      birthDate: birthDate || "",
      deathDate: deathDate || "",
      motto: motto || "",
      privacy: privacy || "family",
      quietMode: quietMode !== false,
      rituals: [],
      fragments: [],
      reminders: [],
      tributeCounts: {},
    };
    const data = this.loadAll();
    data.memorials[slug] = memorial;
    this.saveAll(data);
    return memorial;
  },

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  },
};
