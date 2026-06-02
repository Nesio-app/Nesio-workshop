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
        "<p>李明德先生，1938年4月3日出生于湖南省长沙市，2023年11月18日于家中安详辞世，享年85岁。</p><p>李先生自1962年起执教于北京师范大学中文系，执教生涯长达三十八年，桃李满天下。学生们记得他洗得发白的青布长衫、满手粉笔灰，以及朗读杜甫《春望》前那意味深长的一顿。</p><p>他出生于战乱年代的苏州，父亲是修表匠，母亲为邻里誊抄典籍。书籍稀少，少年明德以跑腿换借阅卡，在煤油灯下读到管理员关门才肯回家。</p><p>1968年与陈美华女士成婚，育有一子一女，后院种玫瑰，常引陶诗与猫为伴。退休后扫描家书、批改旧生论文，每周日与妻子逛颐和园。</p><p class=\"memorial-quote\">「教书人播下的是文字，收获的是被认真度过的一生。」</p>",
      familyNote:
        "父亲走了，带走了那扇永远亮着灯的窗。每个深夜，我们仍会想起您书房里飘出的墨香。",
      themeId: "ink-default",
      privacy: "family",
      quietMode: true,
      timeline: [
        { yearLabel: "1938年", title: "出生于苏州", description: "长子，父亲修表，母亲誊抄典籍" },
        { yearLabel: "1960年", title: "考入北京师范大学", description: "攻读古典中文，以杜甫研究获奖" },
        { yearLabel: "1968年", title: "与陈美华成婚", description: "简朴婚礼，西山读书度蜜月" },
        { yearLabel: "1972年", title: "执教北师大", description: "讲授唐宋诗词，要求学生每周背诵十句" },
        { yearLabel: "1985年", title: "出版《庭前落叶》", description: "散文集，稿费购入班级图书角" },
        { yearLabel: "2005年", title: "退休", description: "廊下答疑，与女儿数字化家书" },
        { yearLabel: "2023年", title: "家中辞世", description: "握妻子之手，念王维空山诗" },
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
