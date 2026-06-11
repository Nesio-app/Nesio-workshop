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
        {
          caption: "退休典礼",
          emoji: "📸",
          yearLabel: "1998年",
          imageUrl:
            "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=900&q=80",
        },
        {
          caption: "书法作品",
          emoji: "🖋️",
          yearLabel: "2015年",
          imageUrl:
            "https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=900&q=80",
        },
        {
          caption: "茶道雅集",
          emoji: "🫖",
          yearLabel: "晚年",
          imageUrl:
            "https://images.unsplash.com/photo-1564890369478-c89ca2ed55e5?auto=format&fit=crop&w=900&q=80",
        },
        {
          caption: "全家福",
          emoji: "👨‍👩‍👧‍👦",
          yearLabel: "2020年",
          imageUrl:
            "https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=900&q=80",
        },
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

  showcaseMemorialTemplates() {
    const li = this.defaultMemorial();
    return {
      "li-mingde": li,
      "zhang-xiuying": {
        slug: "zhang-xiuying",
        name: "张秀英",
        birthDate: "1945-03-12",
        deathDate: "2022-08-20",
        motto: "妈妈的手擀面，是世间最美的味道",
        bioHtml:
          "<p>张秀英女士，1945年生于湖南湘潭，2022年于长沙家中安详离世，享年77岁。</p><p>她一生勤俭持家，厨艺精湛，邻里皆知她手擀面的香气。丈夫早逝后，她独自抚养三个孩子，从未抱怨。</p><p>晚年喜爱养花，尤其月季。她说：「日子再难，也要把饭做好，把家撑住。」</p>",
        familyNote: "妈妈，我们永远记得您深夜为我们掖被角的手。",
        themeId: "peach-spring",
        privacy: "public",
        quietMode: true,
        timeline: [
          { yearLabel: "1945年", title: "出生于湘潭", description: "农家三女，自幼帮厨" },
          { yearLabel: "1970年", title: "迁居长沙", description: "在纺织厂工作三十年" },
          { yearLabel: "2022年", title: "家中辞世", description: "子女环绕，安详离去" },
        ],
        family: [
          { groupLabel: "子女", name: "张建国", relation: "长子", avatarChar: "建" },
          { groupLabel: "子女", name: "张丽", relation: "次女", avatarChar: "丽" },
        ],
        gallery: [{ caption: "厨房旧照", emoji: "🍜", yearLabel: "1990年" }],
        rituals: [],
        fragments: [],
        reminders: [],
        tributeCounts: { 蜡烛: 2108, 鲜花: 1802, 焚香: 920, 贡品: 640, 心语: 3100 },
      },
      "wang-shulan": {
        slug: "wang-shulan",
        name: "王淑兰",
        birthDate: "1929-11-05",
        deathDate: "2021-04-18",
        motto: "经历百年风华，安然归于平静",
        bioHtml:
          "<p>王淑兰女士，1929年生于江苏无锡，2021年在南京辞世，享年92岁。</p><p>她亲历时代变迁，始终以温和与坚韧面对一切。晚年喜爱听昆曲、写毛笔日记，常对孙辈说：「人这一辈子，平安就是福。」</p>",
        familyNote: "祖母，您的故事我们会讲给下一代听。",
        themeId: "bailu",
        privacy: "public",
        quietMode: true,
        timeline: [
          { yearLabel: "1929年", title: "出生于无锡", description: "" },
          { yearLabel: "1955年", title: "迁居南京", description: "任教小学语文" },
          { yearLabel: "2021年", title: "安然离世", description: "" },
        ],
        family: [{ groupLabel: "孙辈", name: "王浩然", relation: "孙子", avatarChar: "浩" }],
        gallery: [],
        rituals: [],
        fragments: [],
        reminders: [],
        tributeCounts: { 蜡烛: 1876, 鲜花: 1540, 焚香: 1100, 贡品: 800, 心语: 2200 },
      },
      "chen-meihua": {
        slug: "chen-meihua",
        name: "陈美华",
        birthDate: "1940-06-18",
        deathDate: "2025-03-22",
        motto: "花开有时，爱无绝期",
        bioHtml:
          "<p>陈美华女士，1940年生于苏州，2025年春于北京家中离世，享年85岁。</p><p>青年时在县医院做护士，婚后与李明德先生相伴五十六年。她种玫瑰、写养护笔记，把温柔给了每一位来讨花的邻居。</p>",
        familyNote: "母亲，后院的花今年又开了，我们替您浇着。",
        themeId: "plum-snow",
        privacy: "public",
        quietMode: true,
        timeline: [
          { yearLabel: "1940年", title: "出生于苏州", description: "" },
          { yearLabel: "1968年", title: "与李明德成婚", description: "" },
          { yearLabel: "2025年", title: "花季中离去", description: "" },
        ],
        family: [
          { groupLabel: "配偶", name: "李明德", relation: "丈夫", avatarChar: "明" },
          { groupLabel: "孙辈", name: "李小雨", relation: "孙女", avatarChar: "雨" },
        ],
        gallery: [{ caption: "南院玫瑰", emoji: "🌹", yearLabel: "2018年" }],
        rituals: [],
        fragments: [],
        reminders: [],
        tributeCounts: { 蜡烛: 1542, 鲜花: 2100, 焚香: 980, 贡品: 720, 心语: 2800 },
      },
      "lin-xiaoling": {
        slug: "lin-xiaoling",
        name: "林小玲",
        birthDate: "1956-03-08",
        deathDate: "2026-03-15",
        motto: "疼要有人听见，才算被照顾",
        bioHtml:
          "<p>林小玲女士，1956年生于湖南，2026年春于县医院家中安详离世，享年70岁。</p><p>她在夜班走廊走了四十年，是护士长，也是许多病人最安心的钟。下班后她仍为我们缝校服，笑说「那再加三件」。</p><p>同事们在纪念馆点亮了三千余支电子烛，像又一班从未结束的夜班。</p>",
        familyNote: "献给我们的母亲、护士长林小玲。——子女",
        themeId: "ink-moon",
        privacy: "public",
        quietMode: true,
        timeline: [
          { yearLabel: "1956年", title: "出生于湖南", description: "" },
          { yearLabel: "1978年", title: "县医院夜班", description: "四十年走廊" },
          { yearLabel: "2026年", title: "花季中离去", description: "" },
        ],
        family: [
          { groupLabel: "子女", name: "林伟", relation: "儿子", avatarChar: "伟" },
          { groupLabel: "子女", name: "林芳", relation: "女儿", avatarChar: "芳" },
        ],
        gallery: [],
        rituals: [],
        fragments: [],
        reminders: [],
        tributeCounts: { 蜡烛: 3247, 鲜花: 2100, 焚香: 980, 贡品: 720, 心语: 2800 },
      },
    };
  },

  ensureShowcaseMemorial(slug) {
    const templates = this.showcaseMemorialTemplates();
    const tpl = templates[slug];
    if (!tpl) return;
    if (!this.get(slug)) {
      this.update(slug, tpl);
    }
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
