/**
 * Site-wide zh / en toggle. Persists to localStorage.
 */
window.MemorialI18n = {
  STORAGE_KEY: "nianguichu_lang",
  lang: "zh",

  copy: {
    zh: {
      welcome: {
        badge: "Memorial & remembrance",
        title: "念归处",
        sub: "华人数字纪念馆",
        tagline:
          "以安静、清晰的方式保存生平与追思——如同一篇值得反复阅读的纪念文章，留给家人与后代。",
        taglineHint: "",
        searchPlaceholder: "搜索纪念馆姓名…",
        searchBtn: "搜索",
        createCta: "创建纪念馆",
      },
      enterMemorial: (name) =>
        `今日来看${name}。这里很安静，门会为家人轻轻留着。`,
      ritual: {
        modalTitle: "寄一份心意",
        prompt:
          "点一盏灯之前，若您愿意，可写下此刻想对他/她说的一句话。",
        placeholder: "这句话只有您和家族能看到。",
        namePlaceholder: "您的称呼（可选）",
        confirm: "完成祭奠",
        flower: "献上一束花",
        incense: "焚香",
        offering: "供奉贡品",
        heart: "寄心语",
        after: "已记下。您可以多坐一会儿。",
      },
      memory: {
        tabTitle: "记忆共创",
        invite: "若您记得某个瞬间，欢迎留下一片记忆。",
        voiceHint: "文字即可；日后可补充语音。",
        relationPlaceholder: "与 Ta 的关系（如：学生、侄女）",
        yearPlaceholder: "大约年份（如：1982）",
        contentPlaceholder: "写下那个瞬间：一句话、一个场景…",
        submit: "交给家族一同保存",
        pending: "待家人确认",
        approved: "已并入纪念馆",
      },
      anniversary: {
        tabTitle: "追思节律",
        intro:
          "重要的日子会被温柔记住。提醒只发给订阅的家人，不含推销。",
        subscribe: "订阅纪念日提醒",
        emailPlaceholder: "家人邮箱",
        subscribed: "已订阅，届时将收到克制的提醒邮件",
        labels: {
          touqi: "头七",
          qiqi: "七七",
          anniversary: "周年忌日",
          qingming: "清明",
        },
      },
      coMemorial: {
        tabTitle: "共祭时光",
        intro: "家人每一次的祭奠与心意，汇成一条安静的时间河流。",
        empty: "尚无心意记录。第一盏灯，往往由最想念的人点亮。",
      },
      privacy: {
        private: "仅自己",
        family: "家族可见",
        public: "公开展示",
        quiet: "静默模式",
        quietOn: "已开启静默：商城与打扰性元素已隐藏",
        quietOff: "已关闭静默模式",
      },
      create: {
        title: "为挚爱建一处纪念馆",
        step1: "基本信息",
        step2: "隐私与氛围",
        step3: "完成",
        name: "逝者姓名",
        birth: "出生日期",
        death: "辞世日期",
        motto: "一句挽联或心念（可选）",
        privacyLabel: "谁可以看到这座纪念馆？",
        quietDefault: "默认开启静默模式（推荐）",
        done: "纪念馆已创建",
        doneHint: "您可以继续完善生平，或邀请家人共同保存记忆。",
        open: "进入纪念馆",
      },
    },
    en: {
      welcome: {
        badge: "Memorial & remembrance",
        title: "Nianguichu",
        sub: "Digital memorial for families",
        tagline:
          "Preserve a life and the love around it—in a calm, lasting space your family can return to anytime.",
        taglineHint: "",
        searchPlaceholder: "Search memorials by name…",
        searchBtn: "Search",
        createCta: "Create memorial",
      },
      enterMemorial: (name) =>
        `You are visiting ${name}'s memorial today. The door stays open gently for family.`,
      ritual: {
        modalTitle: "Send a tribute",
        prompt:
          "Before lighting a candle, you may leave a few words—only your family can see them.",
        placeholder: "Visible to you and family only.",
        namePlaceholder: "Your name (optional)",
        confirm: "Complete tribute",
        flower: "Offer flowers",
        incense: "Light incense",
        offering: "Offerings",
        heart: "Leave a note",
        after: "Recorded. You may stay a while.",
      },
      memory: {
        tabTitle: "Shared memories",
        invite: "If you remember a moment, share a fragment of memory.",
        voiceHint: "Text for now; voice may be added later.",
        relationPlaceholder: "Your relationship (e.g. student, niece)",
        yearPlaceholder: "Approx. year (e.g. 1982)",
        contentPlaceholder: "A line, a scene, a detail you remember…",
        submit: "Save for family review",
        pending: "Awaiting family approval",
        approved: "Added to the memorial",
      },
      anniversary: {
        tabTitle: "Remembrance calendar",
        intro:
          "Important dates are remembered quietly. Reminders go only to subscribed family—no marketing.",
        subscribe: "Subscribe to date reminders",
        emailPlaceholder: "Family email",
        subscribed: "Subscribed—you will receive a gentle reminder",
        labels: {
          touqi: "First week",
          qiqi: "49th day",
          anniversary: "Anniversary",
          qingming: "Qingming",
        },
      },
      coMemorial: {
        tabTitle: "Together in remembrance",
        intro:
          "Each family's tributes flow into a quiet river of time.",
        empty:
          "No tributes yet. The first light is often lit by those who miss them most.",
      },
      privacy: {
        private: "Only me",
        family: "Family only",
        public: "Public",
        quiet: "Quiet mode",
        quietOn: "Quiet mode on: shop and distractions hidden",
        quietOff: "Quiet mode off",
      },
      create: {
        title: "Create a memorial",
        step1: "Basics",
        step2: "Privacy & tone",
        step3: "Done",
        name: "Full name",
        birth: "Date of birth",
        death: "Date of passing",
        motto: "Epitaph or line (optional)",
        privacyLabel: "Who can see this memorial?",
        quietDefault: "Enable quiet mode by default (recommended)",
        done: "Memorial created",
        doneHint:
          "You can add their story or invite family to contribute memories.",
        open: "Open memorial",
      },
    },
  },

  strings: {
    zh: {
      "nav.home": "首页",
      "nav.shop": "纪念商城",
      "nav.plaque": "铭牌定制",
      "nav.tools": "在线工具",
      "nav.guides": "丧葬百科",
      "nav.pricing": "会员",
      "nav.cart": "购物车",
      "nav.create": "创建纪念馆",
      "home.brand": "念归处",
      "home.stat.memorials": "纪念馆",
      "home.stat.messages": "留言祈福",
      "home.stat.partners": "合作殡仪馆",
      "lang.switch": "EN",
      "lang.switchTitle": "Switch to English",
      "cart.title": "购物车",
      "cart.total": "合计：",
      "cart.checkout": "去结算 →",
      "home.featuresTitle": "平台功能",
      "home.featuresSub": "全方位守护珍贵记忆",
      "home.memorialsTitle": "近期纪念馆",
      "home.memorialsSub": "在此寄托思念",
      "home.guidesTitle": "丧葬百科",
      "home.guidesSub": "读懂礼仪，温柔走过悲伤",
      "home.browseGuides": "浏览全部文章 →",
      "home.visitMemorial": "前往纪念",
      "home.moreMemorials": "更多纪念馆",
      "home.browseAll": "浏览全部",
      "profile.tab.bio": "生平故事",
      "profile.tab.gallery": "影像相册",
      "profile.tab.timeline": "人生历程",
      "profile.tab.guestbook": "留言祈福",
      "profile.tab.memory": "记忆共创",
      "profile.tab.comemorial": "共祭时光",
      "profile.tab.anniversary": "追思节律",
      "profile.tab.family": "家族树",
      "profile.tab.events": "纪念仪式",
      "profile.tab.grief": "悲伤疗愈",
      "profile.tab.shop": "纪念商店",
      "profile.tribute.candle": "点燃蜡烛",
      "profile.tribute.flower": "献花",
      "profile.tribute.incense": "焚香",
      "profile.tribute.offering": "供奉贡品",
      "profile.tribute.heart": "寄心语",
      "profile.guestbook.placeholder":
        "在此留下您对李明德先生的思念与祝福…",
      "profile.guestbook.name": "您的姓名（可匿名）",
      "profile.guestbook.send": "发送留言",
      "shop.title": "纪念商城",
      "shop.sub": "鲜花、香品、纪念礼品与 QR 铭牌 — 全国配送",
      "shop.cat.all": "全部",
      "shop.cat.flower": "鲜花花圈",
      "shop.cat.candle": "蜡烛香品",
      "shop.cat.gift": "纪念礼品",
      "shop.cat.plant": "种植纪念树",
      "shop.trust.ship": "全国包邮",
      "shop.trust.pack": "精美包装",
      "shop.trust.fast": "当日发货",
      "shop.trust.quality": "品质保证",
      "shop.empty": "暂无商品",
      "shop.loading": "加载商品…",
      "pricing.title": "会员方案",
      "pricing.sub": "选择适合您的方案，让记忆永续传承",
      "pricing.compare": "详细对比",
      "tools.title": "在线工具",
      "tools.sub": "讣告撰写、葬礼规划、纪念册与更多实用功能",
      "plaque.title": "铭牌定制",
      "plaque.sub": "填写刻字信息，预览效果，一键加入购物车",
      "auth.login": "登录",
      "auth.logout": "退出",
      "auth.demo": "演示",
      "auth.account": "我的账户",
      "page.title": "念归处 · 华人数字纪念馆",
      "pricing.free": "免费版",
      "pricing.premium": "高级版",
      "pricing.lifetime": "终身版",
      "pricing.popular": "最受欢迎",
      "pricing.freeBtn": "免费开始",
      "pricing.premiumBtn": "升级高级版 · ¥399",
      "pricing.lifetimeBtn": "购买终身版 · ¥999",
      "checkout.title": "确认订单",
      "checkout.name": "联系人姓名 *",
      "checkout.email": "联系邮箱 *",
      "checkout.phone": "手机号 *",
      "checkout.province": "省份 *",
      "checkout.city": "城市 *",
      "checkout.address": "详细地址 *",
      "checkout.postal": "邮编（可选）",
      "checkout.note": "备注（可选）",
      "checkout.digitalHint": "数字会员服务无需填写收货地址，支付后为您开通。",
      "checkout.payLegend": "支付方式",
      "checkout.submit": "提交订单并支付",
      "membook.samplesTitle": "样本纪念册",
      "membook.samplesSub": "完整中英文内容，可在线翻页预览",
      "membook.pageTitle": "纪念册制作",
      "membook.pageSub": "将散落的记忆凝聚成一本可以传家的精装纪念册",
    },
    en: {
      "nav.home": "Home",
      "nav.shop": "Memorial shop",
      "nav.plaque": "Plaque maker",
      "nav.tools": "Tools",
      "nav.guides": "Guides",
      "nav.pricing": "Membership",
      "nav.cart": "Cart",
      "nav.create": "Create memorial",
      "home.brand": "Nianguichu",
      "home.stat.memorials": "Memorials",
      "home.stat.messages": "Messages",
      "home.stat.partners": "Partner homes",
      "lang.switch": "中文",
      "lang.switchTitle": "切换到中文",
      "cart.title": "Cart",
      "cart.total": "Total: ",
      "cart.checkout": "Checkout →",
      "home.featuresTitle": "What we offer",
      "home.featuresSub": "Care for the memories that matter",
      "home.memorialsTitle": "Recent memorials",
      "home.memorialsSub": "A place for remembrance",
      "home.guidesTitle": "Guides & resources",
      "home.guidesSub": "Ritual, grief, and practical help",
      "home.browseGuides": "Browse all articles →",
      "home.visitMemorial": "Visit",
      "home.moreMemorials": "More memorials",
      "home.browseAll": "Browse all",
      "profile.tab.bio": "Life story",
      "profile.tab.gallery": "Photos",
      "profile.tab.timeline": "Timeline",
      "profile.tab.guestbook": "Messages",
      "profile.tab.memory": "Shared memories",
      "profile.tab.comemorial": "Tributes",
      "profile.tab.anniversary": "Calendar",
      "profile.tab.family": "Family tree",
      "profile.tab.events": "Ceremonies",
      "profile.tab.grief": "Grief support",
      "profile.tab.shop": "Shop",
      "profile.tribute.candle": "Candle",
      "profile.tribute.flower": "Flowers",
      "profile.tribute.incense": "Incense",
      "profile.tribute.offering": "Offerings",
      "profile.tribute.heart": "Note",
      "profile.guestbook.placeholder":
        "Share your thoughts and blessings for Mr. Li…",
      "profile.guestbook.name": "Your name (optional)",
      "profile.guestbook.send": "Post message",
      "shop.title": "Memorial shop",
      "shop.sub": "Flowers, incense, gifts & QR plaques — nationwide delivery",
      "shop.cat.all": "All",
      "shop.cat.flower": "Flowers",
      "shop.cat.candle": "Candles",
      "shop.cat.gift": "Gifts",
      "shop.cat.plant": "Memorial trees",
      "shop.trust.ship": "Free shipping",
      "shop.trust.pack": "Gift packaging",
      "shop.trust.fast": "Same-day dispatch",
      "shop.trust.quality": "Quality assured",
      "shop.empty": "No products",
      "shop.loading": "Loading…",
      "pricing.title": "Membership",
      "pricing.sub": "Choose a plan to preserve memories for generations",
      "pricing.compare": "Compare plans",
      "tools.title": "Online tools",
      "tools.sub": "Obituaries, planning checklists, memorial books & more",
      "plaque.title": "Plaque maker",
      "plaque.sub": "Preview engraving and add to cart",
      "auth.login": "Sign in",
      "auth.logout": "Sign out",
      "auth.demo": "Demo",
      "auth.account": "My account",
      "page.title": "Nianguichu · Digital memorial",
      "pricing.free": "Free",
      "pricing.premium": "Premium",
      "pricing.lifetime": "Lifetime",
      "pricing.popular": "Most popular",
      "pricing.freeBtn": "Start free",
      "pricing.premiumBtn": "Upgrade · ¥399/yr",
      "pricing.lifetimeBtn": "Buy lifetime · ¥999",
      "checkout.title": "Checkout",
      "checkout.name": "Contact name *",
      "checkout.email": "Email *",
      "checkout.phone": "Phone *",
      "checkout.province": "Province *",
      "checkout.city": "City *",
      "checkout.address": "Street address *",
      "checkout.postal": "Postal code (optional)",
      "checkout.note": "Note (optional)",
      "checkout.digitalHint": "Digital membership needs no shipping address.",
      "checkout.payLegend": "Payment",
      "checkout.submit": "Place order & pay",
      "membook.samplesTitle": "Sample memorial books",
      "membook.samplesSub": "Full Chinese & English previews — flip through online",
      "membook.pageTitle": "Memorial books",
      "membook.pageSub": "Gather scattered memories into a heirloom-quality book",
    },
  },

  /** Map Chinese toast / inline text → translation key */
  toastKeys: {
    微信登录成功: "toast.wechatOk",
    微信登录未配置: "toast.wechatNotConfigured",
    微信授权已过期，请重试: "toast.wechatStateInvalid",
    微信登录失败，请改用邮箱或手机号: "toast.wechatFail",
    请填写留言内容: "toast.guestbookRequired",
    "留言已发布，感谢您的思念": "toast.guestbookPosted",
    请输入姓名搜索: "toast.searchRequired",
    已进入李明德纪念馆: "toast.demoMemorialOpen",
    请等待服务器连接: "toast.waitForServer",
    请填写邮箱: "toast.emailRequired",
    请写下一点记忆: "toast.memoryRequired",
    已交给家族保存，待确认后展示: "toast.memoryPending",
    请先生成讣告内容: "toast.obituaryRequired",
    "讣告已发布到纪念馆 · 生平故事": "toast.obituaryPublished",
    免费版已包含基础功能: "toast.freePlan",
    演示版仅开放李明德纪念馆，请点击第一张卡片: "toast.demoOnlyLi",
    更多纪念馆即将开放: "toast.moreSoon",
    "RSVP已提交，感谢您的参与": "toast.rsvpDone",
  },

  toast: {
    zh: {
      "toast.wechatOk": "微信登录成功",
      "toast.wechatNotConfigured": "微信登录未配置",
      "toast.wechatStateInvalid": "微信授权已过期，请重试",
      "toast.wechatFail": "微信登录失败，请改用邮箱或手机号",
      "toast.guestbookRequired": "请填写留言内容",
      "toast.guestbookPosted": "留言已发布，感谢您的思念",
      "toast.searchRequired": "请输入姓名搜索",
      "toast.demoMemorialOpen": "已进入李明德纪念馆",
      "toast.waitForServer": "请等待服务器连接",
      "toast.emailRequired": "请填写邮箱",
      "toast.memoryRequired": "请写下一点记忆",
      "toast.memoryPending": "已交给家族保存，待确认后展示",
      "toast.obituaryRequired": "请先生成讣告内容",
      "toast.obituaryPublished": "讣告已发布到纪念馆 · 生平故事",
      "toast.freePlan": "免费版已包含基础功能",
      "toast.demoOnlyLi": "演示版仅开放李明德纪念馆，请点击第一张卡片",
      "toast.moreSoon": "更多纪念馆即将开放",
      "toast.rsvpDone": "RSVP已提交，感谢您的参与",
      "toast.switchedEn": "Site language: English",
      "toast.switchedZh": "已切换为中文",
    },
    en: {
      "toast.wechatOk": "WeChat sign-in successful",
      "toast.wechatNotConfigured": "WeChat login is not configured",
      "toast.wechatStateInvalid": "WeChat authorization expired—please try again",
      "toast.wechatFail": "WeChat sign-in failed—use email or phone instead",
      "toast.guestbookRequired": "Please enter a message",
      "toast.guestbookPosted": "Message posted—thank you",
      "toast.searchRequired": "Enter a name to search",
      "toast.demoMemorialOpen": "Opening Li Mingde memorial (demo)",
      "toast.waitForServer": "Waiting for server connection",
      "toast.emailRequired": "Please enter an email",
      "toast.memoryRequired": "Please write a memory",
      "toast.memoryPending": "Saved for family review",
      "toast.obituaryRequired": "Generate obituary text first",
      "toast.obituaryPublished": "Obituary published to Life story",
      "toast.freePlan": "Free plan already includes basics",
      "toast.demoOnlyLi": "Demo: only Li Mingde memorial—tap the first card",
      "toast.moreSoon": "More memorials coming soon",
      "toast.rsvpDone": "RSVP submitted—thank you",
      "toast.switchedEn": "Site language: English",
      "toast.switchedZh": "已切换为中文",
    },
  },

  products: {
    en: {
      "white-chrysanthemum": {
        name: "White chrysanthemum bouquet",
        description: "White mums with greens—for remembrance.",
        badge: "Popular",
      },
      "white-wreath": {
        name: "White memorial wreath",
        description: "Includes custom ribbon—for the service.",
      },
      "incense-gift-box": {
        name: "Incense & candle gift set",
        description: "Sandalwood incense and lotus candles.",
        badge: "New",
      },
      "memorial-album": {
        name: "Hardcover memorial album",
        description: "30-page album with layout service.",
      },
      "memorial-tree": {
        name: "Memorial tree planting",
        description: "Certificate and location included.",
        badge: "Eco",
      },
      "qr-plaque": {
        name: "QR memorial plaque",
        description: "Stainless laser etching—scan to visit online.",
      },
      "brass-plaque": {
        name: "Brass heritage plaque",
        description: "Cast brass with rosewood stand.",
      },
      "stainless-plaque": {
        name: "Classic stainless plaque",
        description: "304 steel, 8×5 cm with mounting kit.",
      },
      "plan-premium-year": {
        name: "Premium (annual)",
        description: "All themes, unlimited photos & AI obituary.",
      },
      "plan-lifetime": {
        name: "Lifetime membership",
        description: "One payment, permanent premium access.",
      },
    },
  },

  themes: {
    en: {
      "ink-default": {
        name: "Classic ink",
        desc: "Warm paper and deep ink—timeless for most memorials",
      },
      "ink-moon": {
        name: "Moonlit frost",
        desc: "Cool blue-grey—serene, scholarly tone",
      },
      "plum-snow": {
        name: "Plum in snow",
        desc: "Soft pink and plum—gentle, not flashy",
      },
      "bamboo-wind": {
        name: "Bamboo breeze",
        desc: "Fresh green—natural and calm",
      },
      "peach-spring": {
        name: "Peach spring",
        desc: "Warm blush—tender remembrance",
      },
      "zen-cloud": {
        name: "Zen cloud",
        desc: "Neutral grey-beige—minimal quiet",
      },
      minimal: {
        name: "Minimal",
        desc: "Clean monochrome—focus on words and photos",
      },
    },
  },

  featureCards: [
    { key: "home.feat.memorial", descKey: "home.feat.memorialDesc" },
    { key: "home.feat.themes", descKey: "home.feat.themesDesc" },
    { key: "home.feat.obituary", descKey: "home.feat.obituaryDesc" },
    { key: "home.feat.planning", descKey: "home.feat.planningDesc" },
    { key: "home.feat.qr", descKey: "home.feat.qrDesc" },
    { key: "home.feat.guides", descKey: "home.feat.guidesDesc" },
    { key: "home.feat.membook", descKey: "home.feat.membookDesc" },
  ],

  bootstrap() {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored === "en" || stored === "zh") this.lang = stored;
    this.syncCopy();
  },

  isEn() {
    return this.lang === "en";
  },

  t(key) {
    return this.strings[this.lang]?.[key] ?? this.strings.zh[key] ?? key;
  },

  toastMsg(text) {
    if (!text || this.lang === "zh") return text;
    const key = this.toastKeys[text];
    if (key) return this.toast[this.lang][key] || text;
    return text;
  },

  getCopy() {
    const raw = this.copy[this.lang] || this.copy.zh;
    return JSON.parse(JSON.stringify(raw));
  },

  syncCopy() {
    const c = this.getCopy();
    if (typeof c.enterMemorial === "string") {
      /* already serialized — shouldn't happen */
    }
    window.MEMORIAL_COPY = c;
    if (typeof this.copy[this.lang].enterMemorial === "function") {
      window.MEMORIAL_COPY.enterMemorial = this.copy[this.lang].enterMemorial;
    }
    if (typeof this.copy.zh.enterMemorial === "function" && this.lang === "zh") {
      window.MEMORIAL_COPY.enterMemorial = this.copy.zh.enterMemorial;
    }
    if (typeof this.copy.en.enterMemorial === "function" && this.lang === "en") {
      window.MEMORIAL_COPY.enterMemorial = this.copy.en.enterMemorial;
    }
  },

  localizeProduct(p) {
    if (!p || this.lang !== "en") return p;
    const tr = this.products.en[p.slug];
    if (!tr) return p;
    return {
      ...p,
      name: tr.name || p.name,
      description: tr.description || p.description,
      badge: tr.badge || p.badge,
    };
  },

  localizeTheme(t) {
    if (!t || this.lang !== "en") return t;
    const tr = this.themes.en[t.id];
    if (!tr) return t;
    return { ...t, name: tr.name || t.name, desc: tr.desc || t.desc };
  },

  getDemoMemorial(slug) {
    if (this.lang !== "en") return null;
    return window.MemorialDemoContent?.[slug]?.en || null;
  },

  setLang(lang) {
    if (lang !== "en" && lang !== "zh") return;
    const changed = this.lang !== lang;
    this.lang = lang;
    localStorage.setItem(this.STORAGE_KEY, lang);
    this.syncCopy();
    this.apply();
    if (changed) {
      const msg =
        lang === "en"
          ? this.toast.en["toast.switchedEn"]
          : this.toast.zh["toast.switchedZh"];
      if (typeof showToast === "function") showToast(msg);
    }
  },

  toggle() {
    this.setLang(this.lang === "zh" ? "en" : "zh");
  },

  apply() {
    document.documentElement.lang = this.lang === "en" ? "en" : "zh-CN";
    document.title = this.t("page.title");
    document.body.classList.toggle("lang-en", this.lang === "en");

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const val = this.t(key);
      if (val) el.textContent = val;
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      const val = this.t(key);
      if (val) el.placeholder = val;
    });

    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      const val = this.t(key);
      if (val) el.title = val;
    });

    this.applyWelcomeHero();
    this.applyFeatureCards();
    this.applyMemorialCardButtons();
    this.applyShopCats();
    this.applyLangButton();
    this.applyPricingPage();
    this.refreshDynamic();
  },

  applyPricingPage() {
    const page = document.getElementById("page-pricing");
    if (!page) return;
    const plans = page.querySelectorAll(".pricing-card");
    if (plans[0]) {
      const n = plans[0].querySelector(".plan-name");
      const b = plans[0].querySelector(".plan-select-btn");
      if (n) n.textContent = this.t("pricing.free");
      if (b) b.textContent = this.t("pricing.freeBtn");
    }
    if (plans[1]) {
      const n = plans[1].querySelector(".plan-name");
      const b = plans[1].querySelector(".plan-select-btn");
      const badge = plans[1].querySelector(".popular-badge");
      if (n) n.textContent = this.t("pricing.premium");
      if (b) b.textContent = this.t("pricing.premiumBtn");
      if (badge) badge.textContent = this.t("pricing.popular");
    }
    if (plans[2]) {
      const n = plans[2].querySelector(".plan-name");
      const b = plans[2].querySelector(".plan-select-btn");
      if (n) n.textContent = this.t("pricing.lifetime");
      if (b) b.textContent = this.t("pricing.lifetimeBtn");
    }
  },

  applyWelcomeHero() {
    const c = window.MEMORIAL_COPY?.welcome;
    if (!c) return;
    const badge = document.querySelector(".hero-badge");
    const title = document.querySelector(".hero-title");
    const sub = document.querySelector(".hero-sub");
    const tagline = document.querySelector(".hero-tagline");
    const search = document.getElementById("searchInput");
    const searchBtn = document.querySelector(".hero-search-btn");
    const createBtn = document.querySelector(".nav-btn[data-action='create-memorial']");
    if (badge && c.badge) badge.textContent = c.badge;
    if (title && c.title) title.textContent = c.title;
    if (sub && c.sub) sub.textContent = c.sub;
    if (tagline && c.tagline) tagline.innerHTML = c.tagline;
    if (search && c.searchPlaceholder) search.placeholder = c.searchPlaceholder;
    if (searchBtn && c.searchBtn) searchBtn.textContent = c.searchBtn;
    if (createBtn && c.createCta) createBtn.textContent = c.createCta;
  },

  applyFeatureCards() {
    const extra = {
      zh: {
        "home.feat.memorial": "在线纪念馆",
        "home.feat.memorialDesc": "永久保存生平照片影像留言",
        "home.feat.themes": "精美主题",
        "home.feat.themesDesc": "50+中式主题模板个性定制",
        "home.feat.obituary": "AI讣告撰写",
        "home.feat.obituaryDesc": "AI助手一键生成感人讣告",
        "home.feat.planning": "葬礼规划",
        "home.feat.planningDesc": "24项清单助您有序料理后事",
        "home.feat.qr": "QR铭牌",
        "home.feat.qrDesc": "扫码即达永久在线纪念馆",
        "home.feat.guides": "丧葬百科",
        "home.feat.guidesDesc": "礼仪指南、悲伤疗愈与身后事务",
        "home.feat.membook": "纪念册",
        "home.feat.membookDesc": "精装印刷传家记忆",
      },
      en: {
        "home.feat.memorial": "Online memorial",
        "home.feat.memorialDesc": "Photos, stories & messages—preserved",
        "home.feat.themes": "Themes",
        "home.feat.themesDesc": "50+ elegant layouts to choose from",
        "home.feat.obituary": "AI obituary",
        "home.feat.obituaryDesc": "Draft a thoughtful obituary in minutes",
        "home.feat.planning": "Funeral checklist",
        "home.feat.planningDesc": "24 tasks to plan with clarity",
        "home.feat.qr": "QR plaques",
        "home.feat.qrDesc": "Scan to visit the online memorial",
        "home.feat.guides": "Guides",
        "home.feat.guidesDesc": "Ritual, grief & practical guidance",
        "home.feat.membook": "Memorial book",
        "home.feat.membookDesc": "Print editions for the family",
      },
    };
    const dict = extra[this.lang] || extra.zh;
    const cards = document.querySelectorAll("#page-home .feature-card");
    this.featureCards.forEach((fc, i) => {
      const card = cards[i];
      if (!card) return;
      const nameEl = card.querySelector(".feature-name");
      const descEl = card.querySelector(".feature-desc");
      if (nameEl) nameEl.textContent = dict[fc.key] || nameEl.textContent;
      if (descEl) descEl.textContent = dict[fc.descKey] || descEl.textContent;
    });
  },

  applyMemorialCardButtons() {
    document
      .querySelectorAll("#page-home .memorial-btn")
      .forEach((btn) => {
        btn.textContent = this.t("home.visitMemorial");
      });
    const more = document.querySelector(
      "#page-home .memorial-card:last-child .memorial-name"
    );
    if (more) more.textContent = this.t("home.moreMemorials");
  },

  applyShopCats() {
    const keys = [
      "shop.cat.all",
      "shop.cat.flower",
      "shop.cat.candle",
      "shop.cat.gift",
      "shop.cat.plant",
    ];
    document.querySelectorAll("#shop-page-cats .shop-cat").forEach((el, i) => {
      if (keys[i]) el.textContent = this.t(keys[i]);
    });
    const trustKeys = [
      "shop.trust.ship",
      "shop.trust.pack",
      "shop.trust.fast",
      "shop.trust.quality",
    ];
    document.querySelectorAll(".shop-trust-item").forEach((el, i) => {
      const span = el.querySelector("span:last-child");
      if (span && trustKeys[i]) span.textContent = this.t(trustKeys[i]);
    });
  },

  applyLangButton() {
    const btn = document.getElementById("lang-toggle");
    if (!btn) return;
    btn.textContent = this.t("lang.switch");
    btn.title = this.t("lang.switchTitle");
  },

  refreshDynamic() {
    if (window.MemorialCore?.applyWelcomeCopy) {
      MemorialCore.applyWelcomeCopy();
    }
    const hint = document.getElementById("profile-enter-hint");
    if (hint && window.MEMORIAL_COPY?.enterMemorial) {
      hint.textContent = MEMORIAL_COPY.enterMemorial(
        this.lang === "en" ? "Li Mingde" : "李明德"
      );
    }
    if (window.MemorialAuth) {
      MemorialAuth.renderNav();
      if (document.getElementById("page-auth")?.classList.contains("active")) {
        MemorialAuth.renderAuthPage();
      }
      if (document.getElementById("page-account")?.classList.contains("active")) {
        MemorialAuth.renderAccountPage();
      }
    }
    if (window.MemorialCommerce) {
      MemorialCommerce.renderShopGrids();
      if (document.getElementById("page-product-detail")?.classList.contains("active")) {
        MemorialCommerce.renderProductDetail?.();
      }
    }
    if (window.MemorialContent) {
      MemorialContent.renderThemesGrid(
        MemorialStore?.get(MemorialCore?.slug)?.themeId || "ink-default"
      );
      const ritualTitle = document.getElementById("ritual-modal-title");
      const ritualPrompt = document.getElementById("ritual-modal-prompt");
      const ritualMsg = document.getElementById("ritual-message");
      const ritualAuthor = document.getElementById("ritual-author");
      const c = MEMORIAL_COPY.ritual;
      if (ritualTitle && c) ritualTitle.textContent = c.modalTitle;
      if (ritualPrompt && c) ritualPrompt.textContent = c.prompt;
      if (ritualMsg && c) ritualMsg.placeholder = c.placeholder;
      if (ritualAuthor && c) ritualAuthor.placeholder = c.namePlaceholder;
    }
    if (window.MemorialContent) {
      MemorialContent._articles = null;
      ["home-guides-grid", "guides-articles-grid", "articles-li"].forEach((id) => {
        if (document.getElementById(id)) {
          MemorialContent.renderArticlesGrid(id);
        }
      });
      const slug = window.MemorialCore?.slug;
      const m = slug && window.MemorialStore?.get(slug);
      if (m) MemorialContent.renderAllProfileTabs(m);
    }
    if (window.MemorialMembook) {
      const wasReading = MemorialMembook.currentId;
      MemorialMembook.renderPage();
      if (wasReading) MemorialMembook.renderReader();
    }
    if (window.MemorialCore?.refreshMemorialUI) {
      MemorialCore.refreshMemorialUI();
    }
  },
};

MemorialI18n.bootstrap();

document.addEventListener("DOMContentLoaded", () => {
  MemorialI18n.apply();
});

window.showToast = function showToastI18n(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  const text = window.MemorialI18n
    ? MemorialI18n.toastMsg(msg)
    : msg;
  t.textContent = text;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
};
