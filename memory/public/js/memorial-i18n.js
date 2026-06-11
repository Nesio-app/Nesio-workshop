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
      "home.heroTitle": "念归处",
      "home.heroSub": "华人数字纪念馆",
      "home.heroTagline":
        "以安静、清晰的方式保存生平与追思——如同一篇值得反复阅读的纪念文章，留给家人与后代。",
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
      "pricing.freeDesc": "基础纪念，永久免费",
      "pricing.premiumDesc": "完整功能，家族共享",
      "pricing.lifetimeDesc": "一次付费，永久拥有",
      "pricing.feat.memorialPage": "纪念馆页面",
      "pricing.feat.photos": "照片上传",
      "pricing.feat.basicThemes": "基础主题",
      "pricing.feat.allThemes": "全部主题",
      "pricing.feat.messages": "留言功能",
      "pricing.feat.aiObit": "AI讣告",
      "pricing.feat.video": "视频上传",
      "pricing.feat.customDomain": "自定义域名",
      "pricing.feat.allPremium": "全部高级功能",
      "pricing.feat.multiMemorial": "多个纪念馆",
      "pricing.feat.prioritySupport": "优先客服",
      "pricing.feat.membookDiscount": "纪念册折扣",
      "pricing.feat.plaqueDiscount": "QR铭牌折扣",
      "pricing.feat.legacy": "传承保障",
      "pricing.val.yes": "✓",
      "pricing.val.no": "✗",
      "pricing.val.dash": "—",
      "pricing.val.photos5": "5张",
      "pricing.val.unlimited": "无限",
      "pricing.val.memorials1": "1个",
      "pricing.val.memorials3": "3个",
      "pricing.val.memorials5": "最多5个",
      "pricing.val.themes3": "3款",
      "pricing.val.themesAll": "全部50+",
      "pricing.val.discount9": "9折",
      "pricing.val.discount8": "8折",
      "pricing.compare.feature": "功能",
      "pricing.compare.freeCol": "免费",
      "pricing.compare.premiumCol": "高级¥399/年",
      "pricing.compare.lifetimeCol": "终身¥999",
      "pricing.compare.row.memorialPage": "纪念馆页面",
      "pricing.compare.row.photos": "照片存储",
      "pricing.compare.row.video": "视频存储",
      "pricing.compare.row.themes": "主题模板",
      "pricing.compare.row.aiObit": "AI讣告助手",
      "pricing.compare.row.ceremony": "在线纪念仪式",
      "pricing.compare.row.music": "背景音乐",
      "pricing.compare.row.multi": "多馆管理",
      "pricing.compare.row.discount": "纪念册/QR铭牌折扣",
      "pricing.compare.row.support": "专属客服",
      "guides.admin.title": "发布文章（内容管理员）",
      "guides.admin.titlePh": "文章标题",
      "guides.admin.catCustom": "自定义",
      "guides.admin.catLabelPh": "分类显示名（如：丧礼礼仪）",
      "guides.admin.emojiPh": "图标 emoji（可选）",
      "guides.admin.summaryPh": "摘要（列表页显示）",
      "guides.admin.bodyPh": "正文（段落之间空一行）",
      "guides.admin.publish": "发布",
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
      "guides.title": "丧葬百科",
      "guides.sub": "礼仪指南、悲伤疗愈与身后事务——在艰难时刻，为您提供可靠参考",
      "guides.filter.all": "全部",
      "guides.filter.grief": "悲伤疗愈",
      "guides.filter.ritual": "丧礼礼仪",
      "guides.filter.memory": "守护记忆",
      "guides.filter.child": "与孩子谈生死",
      "guides.filter.legal": "身后事务",
      "articles.loading": "加载中…",
      "articles.empty": "暂无文章",
      "shop.addToCart": "加入购物车",
      "tools.card.obit": "AI 讣告撰写",
      "tools.card.obitDesc": "三步生成感人讣告并发布到纪念馆",
      "tools.card.plan": "葬礼规划清单",
      "tools.card.planDesc": "24 项任务清单，有序料理后事",
      "tools.card.membook": "纪念册制作",
      "tools.card.membookDesc": "智能排版，支持数字版与精装印刷",
      "tools.card.themes": "主题模板",
      "tools.card.themesDesc": "50+ 中式纪念馆主题",
      "tools.card.qr": "QR 铭牌介绍",
      "tools.card.qrDesc": "了解材质与订购流程",
      "tools.card.guides": "丧葬百科",
      "tools.card.guidesDesc": "礼仪、疗愈与身后事务指南",
      "obit.title": "AI讣告撰写助手",
      "obit.sub": "用温柔的文字，为挚爱写下最后的告白",
      "obit.step1": "基本信息",
      "obit.step2": "生平故事",
      "obit.step3": "预览发布",
      "obit.h3.step1": "基本信息",
      "obit.h3.step2": "生平故事",
      "obit.h3.preview": "讣告预览",
      "obit.label.name": "姓名",
      "obit.label.gender": "性别",
      "obit.label.dob": "出生日期",
      "obit.label.dod": "辞世日期",
      "obit.label.birthplace": "出生地",
      "obit.label.job": "职业 / 身份",
      "obit.label.family": "家庭关系",
      "obit.label.achievements": "主要成就与贡献",
      "obit.label.hobbies": "兴趣爱好与个性特质",
      "obit.label.virtues": "性格词汇（可多选）",
      "obit.label.quote": "一句代表性的话（可选）",
      "obit.ph.name": "逝者姓名",
      "obit.ph.birthplace": "如：湖南省长沙市",
      "obit.ph.job": "如：教师、工程师、家庭主妇…",
      "obit.ph.family": "如：育有二子一女，孙子三名",
      "obit.ph.achievements": "工作成就、人生亮点、对家庭社会的贡献…",
      "obit.ph.hobbies": "喜欢的事情、让人难忘的特质、趣事…",
      "obit.ph.quote": "他/她常说的一句话，或家人想说的话…",
      "obit.btn.next2": "下一步：生平故事 →",
      "obit.btn.back": "← 返回",
      "obit.btn.generate": "✨ AI生成讣告初稿",
      "obit.btn.copy": "📋 复制文本",
      "obit.btn.print": "📄 打印 / 存PDF",
      "obit.btn.newspaper": "📰 投稿报纸",
      "obit.btn.publish": "🏮 发布到纪念馆",
      "obit.btn.edit": "← 修改信息",
      "obit.btn.regenerate": "🔄 重新生成",
      "obit.preview.wait": "请完成前两步信息填写后，AI将为您生成感人的讣告初稿…",
      "plaque.label.name": "逝者姓名",
      "plaque.label.years": "生卒年份",
      "plaque.label.material": "材质",
      "plaque.label.inscription": "刻字内容（挽联/诗句）",
      "plaque.btn.cart": "加入购物车",
      "plaque.btn.shop": "浏览更多商品",
      "plaque.mat.stainless": "不锈钢铭牌 ¥298",
      "plaque.mat.brass": "黄铜典藏铭牌 ¥588",
      "plaque.mat.qr": "QR二维码铭牌 ¥388",
      "articles.zhOnly": "此文暂无英文版，以下为中文原文。",
      "planning.title": "葬礼规划清单",
      "planning.sub": "在最艰难的时刻，让我们陪您有序前行",
      "planning.progress": "完成进度",
      "planning.urgent": "紧急",
      "themes.title": "主题模板",
      "themes.sub": "50余款精心设计的中式主题，让纪念馆更具文化温度",
      "themes.filter.all": "全部风格",
      "themes.filter.ink": "水墨传统",
      "themes.filter.floral": "花卉自然",
      "themes.filter.modern": "简约现代",
      "themes.filter.seasonal": "二十四节气",
      "qr.title": "QR扫码铭牌",
      "qr.sub": "将数字纪念馆与实体墓碑相连——一块铭牌，承载永恒记忆",
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
      "home.heroTitle": "Nianguichu",
      "home.heroSub": "Digital memorial for families",
      "home.heroTagline":
        "Preserve a life and the love around it—in a calm, lasting space your family can return to anytime.",
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
      "pricing.freeDesc": "Basic memorial, free forever",
      "pricing.premiumDesc": "Full features for the whole family",
      "pricing.lifetimeDesc": "One payment, yours forever",
      "pricing.feat.memorialPage": "Memorial page",
      "pricing.feat.photos": "Photo uploads",
      "pricing.feat.basicThemes": "Basic themes",
      "pricing.feat.allThemes": "All themes",
      "pricing.feat.messages": "Guest messages",
      "pricing.feat.aiObit": "AI obituary",
      "pricing.feat.video": "Video uploads",
      "pricing.feat.customDomain": "Custom domain",
      "pricing.feat.allPremium": "All Premium features",
      "pricing.feat.multiMemorial": "Multiple memorials",
      "pricing.feat.prioritySupport": "Priority support",
      "pricing.feat.membookDiscount": "Memorial book discount",
      "pricing.feat.plaqueDiscount": "QR plaque discount",
      "pricing.feat.legacy": "Legacy guarantee",
      "pricing.val.yes": "✓",
      "pricing.val.no": "✗",
      "pricing.val.dash": "—",
      "pricing.val.photos5": "5 photos",
      "pricing.val.unlimited": "Unlimited",
      "pricing.val.memorials1": "1",
      "pricing.val.memorials3": "3",
      "pricing.val.memorials5": "Up to 5",
      "pricing.val.themes3": "3 themes",
      "pricing.val.themesAll": "50+ themes",
      "pricing.val.discount9": "10% off",
      "pricing.val.discount8": "20% off",
      "pricing.compare.feature": "Feature",
      "pricing.compare.freeCol": "Free",
      "pricing.compare.premiumCol": "Premium ¥399/yr",
      "pricing.compare.lifetimeCol": "Lifetime ¥999",
      "pricing.compare.row.memorialPage": "Memorial page",
      "pricing.compare.row.photos": "Photo storage",
      "pricing.compare.row.video": "Video storage",
      "pricing.compare.row.themes": "Themes",
      "pricing.compare.row.aiObit": "AI obituary assistant",
      "pricing.compare.row.ceremony": "Online ceremonies",
      "pricing.compare.row.music": "Background music",
      "pricing.compare.row.multi": "Memorial sites",
      "pricing.compare.row.discount": "Book / plaque discount",
      "pricing.compare.row.support": "Dedicated support",
      "guides.admin.title": "Publish article (content admin)",
      "guides.admin.titlePh": "Article title",
      "guides.admin.catCustom": "Custom",
      "guides.admin.catLabelPh": "Category label (e.g. Funeral customs)",
      "guides.admin.emojiPh": "Emoji icon (optional)",
      "guides.admin.summaryPh": "Summary (shown in list)",
      "guides.admin.bodyPh": "Body (blank line between paragraphs)",
      "guides.admin.publish": "Publish",
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
      "guides.title": "Guides & resources",
      "guides.sub": "Ritual, grief, and practical guidance when you need it most",
      "guides.filter.all": "All",
      "guides.filter.grief": "Grief support",
      "guides.filter.ritual": "Funeral customs",
      "guides.filter.memory": "Keeping memory",
      "guides.filter.child": "Children & loss",
      "guides.filter.legal": "After affairs",
      "articles.loading": "Loading…",
      "articles.empty": "No articles yet",
      "shop.addToCart": "Add to cart",
      "tools.card.obit": "AI obituary",
      "tools.card.obitDesc": "Draft and publish to the memorial in three steps",
      "tools.card.plan": "Funeral checklist",
      "tools.card.planDesc": "24 tasks to plan with clarity",
      "tools.card.membook": "Memorial book",
      "tools.card.membookDesc": "Layout for digital or print editions",
      "tools.card.themes": "Themes",
      "tools.card.themesDesc": "50+ memorial layouts",
      "tools.card.qr": "QR plaques",
      "tools.card.qrDesc": "Materials and ordering",
      "tools.card.guides": "Guides",
      "tools.card.guidesDesc": "Ritual, grief & practical help",
      "obit.title": "AI obituary assistant",
      "obit.sub": "Gentle words for a final farewell",
      "obit.step1": "Basics",
      "obit.step2": "Life story",
      "obit.step3": "Preview",
      "obit.h3.step1": "Basic information",
      "obit.h3.step2": "Life story",
      "obit.h3.preview": "Obituary preview",
      "obit.label.name": "Full name",
      "obit.label.gender": "Gender",
      "obit.label.dob": "Date of birth",
      "obit.label.dod": "Date of passing",
      "obit.label.birthplace": "Place of birth",
      "obit.label.job": "Occupation / role",
      "obit.label.family": "Survived by",
      "obit.label.achievements": "Achievements & contributions",
      "obit.label.hobbies": "Interests & personality",
      "obit.label.virtues": "Character (select any)",
      "obit.label.quote": "A representative quote (optional)",
      "obit.ph.name": "Name of the deceased",
      "obit.ph.birthplace": "e.g. Changsha, Hunan",
      "obit.ph.job": "e.g. teacher, engineer, homemaker…",
      "obit.ph.family": "e.g. spouse, two children, three grandchildren",
      "obit.ph.achievements": "Career highlights, community work, family legacy…",
      "obit.ph.hobbies": "Hobbies, habits, stories people remember…",
      "obit.ph.quote": "Words they often said, or words from the family…",
      "obit.btn.next2": "Next: life story →",
      "obit.btn.back": "← Back",
      "obit.btn.generate": "✨ Generate draft",
      "obit.btn.copy": "📋 Copy text",
      "obit.btn.print": "📄 Print / save PDF",
      "obit.btn.newspaper": "📰 Submit to newspaper",
      "obit.btn.publish": "🏮 Publish to memorial",
      "obit.btn.edit": "← Edit details",
      "obit.btn.regenerate": "🔄 Regenerate",
      "obit.preview.wait": "Complete steps 1–2, then AI will draft the obituary here…",
      "plaque.label.name": "Name on plaque",
      "plaque.label.years": "Years of life",
      "plaque.label.material": "Material",
      "plaque.label.inscription": "Inscription (verse or epitaph)",
      "plaque.btn.cart": "Add to cart",
      "plaque.btn.shop": "Browse more products",
      "plaque.mat.stainless": "Stainless steel plaque · ¥298",
      "plaque.mat.brass": "Brass heirloom plaque · ¥588",
      "plaque.mat.qr": "QR code plaque · ¥388",
      "articles.zhOnly": "English translation is not available yet. Original text below.",
      "planning.title": "Funeral planning checklist",
      "planning.sub": "A calm order of tasks in difficult days",
      "planning.progress": "Progress",
      "planning.urgent": "Urgent",
      "themes.title": "Theme gallery",
      "themes.sub": "50+ thoughtful layouts for your memorial",
      "themes.filter.all": "All styles",
      "themes.filter.ink": "Ink tradition",
      "themes.filter.floral": "Floral",
      "themes.filter.modern": "Modern",
      "themes.filter.seasonal": "Seasons",
      "qr.title": "QR memorial plaques",
      "qr.sub": "Link stone and screen—one plaque, lasting memory",
    },
  },

  /** Map Chinese toast / inline text → translation key */
  toastKeys: {
    "微信登录成功": "toast.wechatOk",
    "微信登录未配置": "toast.wechatNotConfigured",
    "微信授权已过期，请重试": "toast.wechatStateInvalid",
    "微信登录失败，请改用邮箱或手机号": "toast.wechatFail",
    "请填写留言内容": "toast.guestbookRequired",
    "留言已发布，感谢您的思念": "toast.guestbookPosted",
    "请输入姓名搜索": "toast.searchRequired",
    "已进入李明德纪念馆": "toast.demoMemorialOpen",
    "请等待服务器连接": "toast.waitForServer",
    "请填写邮箱": "toast.emailRequired",
    "请写下一点记忆": "toast.memoryRequired",
    "已交给家族保存，待确认后展示": "toast.memoryPending",
    "请先生成讣告内容": "toast.obituaryRequired",
    "讣告已发布到纪念馆 · 生平故事": "toast.obituaryPublished",
    "免费版已包含基础功能": "toast.freePlan",
    "演示版仅开放李明德纪念馆，请点击第一张卡片": "toast.demoOnlyLi",
    "更多纪念馆即将开放": "toast.moreSoon",
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

  planningDataEn: [
    {
      icon: "🚨",
      title: "Within 24 hours",
      color: "#8b2020",
      tasks: [
        { t: "Contact funeral home", d: "Report passing and arrange transport", urgent: true },
        { t: "Notify close family", d: "Call children, siblings, and next of kin", urgent: true },
        { t: "Obtain death certificate", d: "From hospital or coroner—keep originals safe", urgent: true },
        { t: "Arrange remains", d: "Hospital morgue or direct to funeral provider" },
      ],
    },
    {
      icon: "📋",
      title: "Within 48 hours",
      color: "var(--blue)",
      tasks: [
        { t: "Notify employer or school", d: "Leave and bereavement paperwork" },
        { t: "Contact executor or lawyer", d: "If a will exists, involve them early" },
        { t: "Care for dependents", d: "Arrange guardianship if minors are involved" },
        { t: "Publish obituary", d: "WeChat, newspaper, or this platform" },
      ],
    },
    {
      icon: "🏮",
      title: "Funeral preparation",
      color: "var(--teal)",
      tasks: [
        { t: "Choose service type", d: "Burial, cremation, or memorial—family agreement" },
        { t: "Set date and venue", d: "Funeral home, temple, or ceremony space" },
        { t: "Select portrait photo", d: "Clear, dignified image for displays" },
        { t: "Arrange officiant", d: "Family member or professional host" },
        { t: "Invite guests", d: "Share time, place, and any dress guidance" },
        { t: "Prepare mourning attire", d: "Per local custom for close relatives" },
      ],
    },
    {
      icon: "📝",
      title: "Estate & paperwork",
      color: "var(--green)",
      tasks: [
        { t: "Register the death", d: "Civil affairs office with required documents" },
        { t: "Bank accounts", d: "Freeze or close; begin inheritance steps" },
        { t: "Property & assets", d: "Follow will or statutory rules; lawyer if disputed" },
        { t: "Cancel ID documents", d: "ID card, license, passport, social insurance" },
        { t: "Insurance claims", d: "Contact insurers with certificate" },
        { t: "Belongings", d: "Keep heirlooms; dispose of the rest thoughtfully" },
      ],
    },
    {
      icon: "💙",
      title: "Healing together",
      color: "var(--lotus)",
      tasks: [
        { t: "Share memories", d: "Stories that comfort and connect family" },
        { t: "Create online memorial", d: "A lasting Nianguichu space for all" },
        { t: "Seek support", d: "Counseling if grief feels unmanageable" },
        { t: "Mark anniversaries", d: "Qingming and family remembrance days" },
      ],
    },
  ],

  getPlanningData() {
    if (this.isEn()) return this.planningDataEn;
    return typeof planningData !== "undefined" ? planningData : [];
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
    this.bindLangButton();
  },

  bindLangButton() {
    const attach = () => {
      const btn = document.getElementById("lang-toggle");
      if (!btn || btn.dataset.i18nBound === "1") return;
      btn.dataset.i18nBound = "1";
      btn.removeAttribute("onclick");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attach);
    } else {
      attach();
    }
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

  getDemoMemorial(slug, memorial) {
    if (this.lang !== "en") return null;
    const key =
      window.MemorialDemoContent?.resolveSlug?.(slug, memorial) || slug;
    return window.MemorialDemoContent?.[key]?.en || null;
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
    this.applySecondaryPages();
    this.applyLangButton();
    this.applyPricingPage();
    this.refreshDynamic();
  },

  applyPricingPage() {
    const page = document.getElementById("page-pricing");
    if (!page) return;
    const t = (k) => this.t(k);
    const setFeatVals = (card, vals) => {
      card.querySelectorAll(".pricing-feat-row .feat-val").forEach((el, i) => {
        if (vals[i] !== undefined) el.textContent = vals[i];
      });
    };
    const sharedFeatKeys = [
      "pricing.feat.memorialPage",
      "pricing.feat.photos",
      "pricing.feat.basicThemes",
      "pricing.feat.messages",
      "pricing.feat.aiObit",
      "pricing.feat.video",
      "pricing.feat.customDomain",
    ];
    const premiumFeatKeys = [
      "pricing.feat.memorialPage",
      "pricing.feat.photos",
      "pricing.feat.allThemes",
      "pricing.feat.messages",
      "pricing.feat.aiObit",
      "pricing.feat.video",
      "pricing.feat.customDomain",
    ];
    const lifetimeFeatKeys = [
      "pricing.feat.allPremium",
      "pricing.feat.multiMemorial",
      "pricing.feat.prioritySupport",
      "pricing.feat.membookDiscount",
      "pricing.feat.plaqueDiscount",
      "pricing.feat.legacy",
    ];
    const plans = page.querySelectorAll(".pricing-card");
    if (plans[0]) {
      const head = plans[0].querySelector(".pricing-card-head");
      const n = head?.querySelector(".plan-name");
      const d = head?.querySelector(".plan-desc");
      const b = plans[0].querySelector(".plan-select-btn");
      if (n) n.textContent = t("pricing.free");
      if (d) d.textContent = t("pricing.freeDesc");
      if (b) b.textContent = t("pricing.freeBtn");
      plans[0].querySelectorAll(".feat-name").forEach((el, i) => {
        if (sharedFeatKeys[i]) el.textContent = t(sharedFeatKeys[i]);
      });
      setFeatVals(plans[0], [
        t("pricing.val.yes"),
        t("pricing.val.photos5"),
        t("pricing.val.yes"),
        t("pricing.val.yes"),
        t("pricing.val.no"),
        t("pricing.val.no"),
        t("pricing.val.no"),
      ]);
    }
    if (plans[1]) {
      const head = plans[1].querySelector(".pricing-card-head");
      const n = head?.querySelector(".plan-name");
      const d = head?.querySelector(".plan-desc");
      const b = plans[1].querySelector(".plan-select-btn");
      const badge = plans[1].querySelector(".popular-badge");
      if (n) n.textContent = t("pricing.premium");
      if (d) d.textContent = t("pricing.premiumDesc");
      if (b) b.textContent = t("pricing.premiumBtn");
      if (badge) badge.textContent = t("pricing.popular");
      const perYear = plans[1].querySelector(".plan-price span");
      if (perYear) perYear.textContent = this.isEn() ? "/yr" : "/年";
      plans[1].querySelectorAll(".feat-name").forEach((el, i) => {
        if (premiumFeatKeys[i]) el.textContent = t(premiumFeatKeys[i]);
      });
      setFeatVals(plans[1], [
        t("pricing.val.yes"),
        t("pricing.val.unlimited"),
        t("pricing.val.yes"),
        t("pricing.val.yes"),
        t("pricing.val.yes"),
        t("pricing.val.unlimited"),
        t("pricing.val.yes"),
      ]);
    }
    if (plans[2]) {
      const head = plans[2].querySelector(".pricing-card-head");
      const n = head?.querySelector(".plan-name");
      const d = head?.querySelector(".plan-desc");
      const b = plans[2].querySelector(".plan-select-btn");
      if (n) n.textContent = t("pricing.lifetime");
      if (d) d.textContent = t("pricing.lifetimeDesc");
      if (b) b.textContent = t("pricing.lifetimeBtn");
      plans[2].querySelectorAll(".feat-name").forEach((el, i) => {
        if (lifetimeFeatKeys[i]) el.textContent = t(lifetimeFeatKeys[i]);
      });
      setFeatVals(plans[2], [
        t("pricing.val.yes"),
        t("pricing.val.memorials5"),
        t("pricing.val.yes"),
        t("pricing.val.discount8"),
        t("pricing.val.discount8"),
        t("pricing.val.yes"),
      ]);
    }
    const table = page.querySelector(".compare-table");
    if (table) {
      const header = table.querySelector("tr");
      if (header) {
        const cells = header.querySelectorAll("th");
        if (cells[0]) cells[0].textContent = t("pricing.compare.feature");
        if (cells[1]) cells[1].textContent = t("pricing.compare.freeCol");
        if (cells[2]) cells[2].textContent = t("pricing.compare.premiumCol");
        if (cells[3]) cells[3].textContent = t("pricing.compare.lifetimeCol");
      }
      const rowKeys = [
        "pricing.compare.row.memorialPage",
        "pricing.compare.row.photos",
        "pricing.compare.row.video",
        "pricing.compare.row.themes",
        "pricing.compare.row.aiObit",
        "pricing.compare.row.ceremony",
        "pricing.compare.row.music",
        "pricing.compare.row.multi",
        "pricing.compare.row.discount",
        "pricing.compare.row.support",
      ];
      const rowVals = [
        [t("pricing.val.yes"), t("pricing.val.yes"), t("pricing.val.yes")],
        [t("pricing.val.photos5"), t("pricing.val.unlimited"), t("pricing.val.unlimited")],
        [t("pricing.val.dash"), t("pricing.val.unlimited"), t("pricing.val.unlimited")],
        [t("pricing.val.themes3"), t("pricing.val.themesAll"), t("pricing.val.themesAll")],
        [t("pricing.val.dash"), t("pricing.val.yes"), t("pricing.val.yes")],
        [t("pricing.val.dash"), t("pricing.val.yes"), t("pricing.val.yes")],
        [t("pricing.val.dash"), t("pricing.val.yes"), t("pricing.val.yes")],
        [t("pricing.val.memorials1"), t("pricing.val.memorials3"), t("pricing.val.memorials5")],
        [t("pricing.val.dash"), t("pricing.val.discount9"), t("pricing.val.discount8")],
        [t("pricing.val.dash"), t("pricing.val.dash"), t("pricing.val.yes")],
      ];
      table.querySelectorAll("tr").forEach((tr, idx) => {
        if (idx === 0) return;
        const rowIdx = idx - 1;
        const cells = tr.querySelectorAll("td,th");
        if (rowKeys[rowIdx] && cells[0]) cells[0].textContent = t(rowKeys[rowIdx]);
        const vals = rowVals[rowIdx];
        if (vals) {
          if (cells[1]) cells[1].textContent = vals[0];
          if (cells[2]) cells[2].textContent = vals[1];
          if (cells[3]) cells[3].textContent = vals[2];
        }
      });
    }
  },

  applyGuidesAdminForm() {
    const box = document.getElementById("guides-admin");
    if (!box) return;
    const h3 = box.querySelector("h3");
    if (h3) h3.textContent = this.t("guides.admin.title");
    const title = document.getElementById("ga-title");
    if (title) title.placeholder = this.t("guides.admin.titlePh");
    const cat = document.getElementById("ga-cat");
    if (cat) {
      const catMap = {
        grief: "guides.filter.grief",
        ritual: "guides.filter.ritual",
        memory: "guides.filter.memory",
        child: "guides.filter.child",
        legal: "guides.filter.legal",
        custom: "guides.admin.catCustom",
      };
      [...cat.options].forEach((opt) => {
        const key = catMap[opt.value];
        if (key) opt.textContent = this.t(key);
      });
    }
    const catLabel = document.getElementById("ga-catlabel");
    if (catLabel) catLabel.placeholder = this.t("guides.admin.catLabelPh");
    const emoji = document.getElementById("ga-emoji");
    if (emoji) emoji.placeholder = this.t("guides.admin.emojiPh");
    const summary = document.getElementById("ga-summary");
    if (summary) summary.placeholder = this.t("guides.admin.summaryPh");
    const body = document.getElementById("ga-body");
    if (body) body.placeholder = this.t("guides.admin.bodyPh");
    const btn = box.querySelector(".submit-btn");
    if (btn) btn.textContent = this.t("guides.admin.publish");
  },

  applyWelcomeHero() {
    const c = window.MEMORIAL_COPY?.welcome;
    if (!c) return;
    const badge = document.querySelector(".hero-badge");
    const search = document.getElementById("searchInput");
    const searchBtn = document.querySelector(".hero-search-btn");
    const createBtn = document.querySelector(".nav-btn[data-action='create-memorial']");
    if (badge && c.badge) badge.textContent = c.badge;
    if (search && c.searchPlaceholder) search.placeholder = c.searchPlaceholder;
    if (searchBtn && c.searchBtn) searchBtn.textContent = c.searchBtn;
    if (createBtn && c.createCta) createBtn.textContent = c.createCta;
  },

  applySecondaryPages() {
    this.applyToolsPage();
    this.applyGuidesFilters();
    this.applyGuidesAdminForm();
    this.applyObituaryPage();
    this.applyPlaquePage();
    this.applyPlanningHero();
    this.applyThemesHero();
    this.applyQrPage();
    const membookTools = document.querySelectorAll("#page-membook .membook-tool-name");
    const membookKeys = [
      "membook.tool.photo",
      "membook.tool.bio",
      "membook.tool.obit",
      "membook.tool.board",
    ];
    const membookNamesZh = [
      "智能照片整理",
      "AI传记撰写",
      "传记与讣告",
      "家族留言板",
    ];
    const membookNamesEn = [
      "Photo curation",
      "AI biography",
      "Obituary & tribute",
      "Family messages",
    ];
    membookTools.forEach((el, i) => {
      const name = this.isEn() ? membookNamesEn[i] : membookNamesZh[i];
      if (name) el.textContent = name;
    });
    const membookToolTitle = document.querySelector(
      "#page-membook .membook-tools .section-title"
    );
    if (membookToolTitle) {
      membookToolTitle.textContent = this.isEn() ? "Book tools" : "制作工具";
    }
    const membookToolSub = document.querySelector(
      "#page-membook .membook-tools .section-sub"
    );
    if (membookToolSub) {
      membookToolSub.textContent = this.isEn()
        ? "Six features, one workflow"
        : "六大功能，一键完成";
    }
  },

  applyToolsPage() {
    const keys = [
      ["tools.card.obit", "tools.card.obitDesc"],
      ["tools.card.plan", "tools.card.planDesc"],
      ["tools.card.membook", "tools.card.membookDesc"],
      ["tools.card.themes", "tools.card.themesDesc"],
      ["tools.card.qr", "tools.card.qrDesc"],
      ["tools.card.guides", "tools.card.guidesDesc"],
    ];
    document.querySelectorAll("#page-tools .tool-card").forEach((card, i) => {
      const pair = keys[i];
      if (!pair) return;
      const name = card.querySelector(".tool-card-name");
      const desc = card.querySelector(".tool-card-desc");
      if (name) name.textContent = this.t(pair[0]);
      if (desc) desc.textContent = this.t(pair[1]);
    });
  },

  applyGuidesFilters() {
    const map = {
      all: "guides.filter.all",
      grief: "guides.filter.grief",
      ritual: "guides.filter.ritual",
      memory: "guides.filter.memory",
      child: "guides.filter.child",
      legal: "guides.filter.legal",
    };
    const applyFilter = (root) => {
      if (!root) return;
      root.querySelectorAll(".filter-tag").forEach((el, i) => {
        const cat = el.getAttribute("data-filter-cat");
        const key = cat && map[cat] ? map[cat] : Object.values(map)[i];
        if (key) el.textContent = this.t(key);
      });
    };
    applyFilter(document.getElementById("guides-articles-filter"));
    applyFilter(document.querySelector("#tab-grief-li .articles-filter"));
  },

  applyObituaryPage() {
    const hero = document.querySelector("#page-obituary .obit-hero");
    if (hero) {
      const h1 = hero.querySelector("h1");
      const p = hero.querySelector("p");
      if (h1) h1.textContent = this.t("obit.title");
      if (p) p.textContent = this.t("obit.sub");
    }
    const steps = ["obit.step1", "obit.step2", "obit.step3"];
    document.querySelectorAll("#page-obituary .obit-step-label").forEach((el, i) => {
      if (steps[i]) el.textContent = this.t(steps[i]);
    });
    const en = this.isEn();
    const virtuesZh = [
      "勤劳", "善良", "坚强", "幽默", "温柔", "智慧", "慷慨", "敬业", "乐观", "虔诚",
    ];
    const virtuesEn = [
      "Diligent", "Kind", "Resilient", "Humorous", "Gentle", "Wise", "Generous",
      "Dedicated", "Optimistic", "Devout",
    ];
    document.querySelectorAll("#virtue-tags .virtue-tag").forEach((el, i) => {
      el.textContent = en ? virtuesEn[i] : virtuesZh[i];
    });
    const gender = document.getElementById("obit-gender");
    if (gender && gender.options.length >= 2) {
      gender.options[0].text = en ? "Male" : "男";
      gender.options[1].text = en ? "Female" : "女";
    }
    const labelForInput = (inputId, key) => {
      const input = document.getElementById(inputId);
      const lab = input?.closest(".form-field")?.querySelector(".form-label");
      if (lab) lab.textContent = this.t(key);
    };
    const page = document.getElementById("page-obituary");
    if (page) {
      const h3s = page.querySelectorAll(".obit-step-content h3");
      if (h3s[0]) h3s[0].textContent = this.t("obit.h3.step1");
      if (h3s[1]) h3s[1].textContent = this.t("obit.h3.step2");
      if (h3s[2]) h3s[2].textContent = this.t("obit.h3.preview");
      labelForInput("obit-name", "obit.label.name");
      labelForInput("obit-gender", "obit.label.gender");
      labelForInput("obit-dob", "obit.label.dob");
      labelForInput("obit-dod", "obit.label.dod");
      labelForInput("obit-birth", "obit.label.birthplace");
      labelForInput("obit-job", "obit.label.job");
      labelForInput("obit-family", "obit.label.family");
      labelForInput("obit-achievements", "obit.label.achievements");
      labelForInput("obit-hobbies", "obit.label.hobbies");
      labelForInput("obit-quote", "obit.label.quote");
      const virtuesLab = document
        .getElementById("virtue-tags")
        ?.closest(".form-field")
        ?.querySelector(".form-label");
      if (virtuesLab) virtuesLab.textContent = this.t("obit.label.virtues");
      const nameIn = document.getElementById("obit-name");
      if (nameIn) nameIn.placeholder = this.t("obit.ph.name");
      const birthIn = document.getElementById("obit-birth");
      if (birthIn) birthIn.placeholder = this.t("obit.ph.birthplace");
      const jobIn = document.getElementById("obit-job");
      if (jobIn) jobIn.placeholder = this.t("obit.ph.job");
      const famIn = document.getElementById("obit-family");
      if (famIn) famIn.placeholder = this.t("obit.ph.family");
      const achIn = document.getElementById("obit-achievements");
      if (achIn) achIn.placeholder = this.t("obit.ph.achievements");
      const hobIn = document.getElementById("obit-hobbies");
      if (hobIn) hobIn.placeholder = this.t("obit.ph.hobbies");
      const quoteIn = document.getElementById("obit-quote");
      if (quoteIn) quoteIn.placeholder = this.t("obit.ph.quote");
      const next1 = page.querySelector("#obit-content-1 .obit-next-btn");
      if (next1) next1.textContent = this.t("obit.btn.next2");
      const back2 = page.querySelector("#obit-content-2 .obit-back-btn");
      const gen2 = page.querySelector("#obit-content-2 .obit-next-btn");
      if (back2) back2.textContent = this.t("obit.btn.back");
      if (gen2) gen2.textContent = this.t("obit.btn.generate");
      const actions = page.querySelectorAll("#obit-content-3 .obit-action-btn");
      const actionKeys = [
        "obit.btn.copy",
        "obit.btn.print",
        "obit.btn.newspaper",
        "obit.btn.publish",
      ];
      actions.forEach((btn, i) => {
        if (actionKeys[i]) btn.textContent = this.t(actionKeys[i]);
      });
      const back3 = page.querySelector("#obit-content-3 .obit-back-btn");
      const regen = page.querySelector("#obit-content-3 .obit-next-btn");
      if (back3) back3.textContent = this.t("obit.btn.edit");
      if (regen) regen.textContent = this.t("obit.btn.regenerate");
      const result = document.getElementById("obit-result");
      if (result && !result.querySelector("p")) {
        result.textContent = this.t("obit.preview.wait");
      }
    }
  },

  applyPlaquePage() {
    const page = document.getElementById("page-plaque");
    if (!page) return;
    const hero = page.querySelector(".plaque-hero");
    if (hero) {
      const h1 = hero.querySelector("h1");
      const p = hero.querySelector("p");
      if (h1) h1.textContent = this.t("plaque.title");
      if (p) p.textContent = this.t("plaque.sub");
    }
    const labels = page.querySelectorAll(".plaque-form .auth-field label");
    const labelKeys = [
      "plaque.label.name",
      "plaque.label.years",
      "plaque.label.material",
      "plaque.label.inscription",
    ];
    labels.forEach((lab, i) => {
      if (labelKeys[i]) lab.textContent = this.t(labelKeys[i]);
    });
    const mat = document.getElementById("plaque-material");
    if (mat && mat.options.length >= 3) {
      mat.options[0].text = this.t("plaque.mat.stainless");
      mat.options[1].text = this.t("plaque.mat.brass");
      mat.options[2].text = this.t("plaque.mat.qr");
    }
    const cartBtn = page.querySelector(".plaque-form .submit-btn");
    if (cartBtn) cartBtn.textContent = this.t("plaque.btn.cart");
    const shopBtn = page.querySelector(".plaque-form .obit-back-btn");
    if (shopBtn) shopBtn.textContent = this.t("plaque.btn.shop");
  },

  applyPlanningHero() {
    const hero = document.querySelector("#page-planning .planning-hero");
    if (hero) {
      const h1 = hero.querySelector("h1");
      const p = hero.querySelector("p");
      if (h1) h1.textContent = this.t("planning.title");
      if (p) p.textContent = this.t("planning.sub");
    }
    const prog = document.querySelector("#page-planning .progress-label");
    if (prog) prog.textContent = this.t("planning.progress");
    if (typeof renderPlanning === "function") {
      renderPlanning();
      if (window.MemorialContent) {
        MemorialContent.syncPlanningUI(
          MemorialContent.loadPlanningState()
        );
      }
    }
  },

  applyThemesHero() {
    const hero = document.querySelector("#page-themes .themes-hero");
    if (hero) {
      const h1 = hero.querySelector("h1");
      const p = hero.querySelector("p");
      if (h1) h1.textContent = this.t("themes.title");
      if (p) p.textContent = this.t("themes.sub");
    }
    const themeFilters = [
      "themes.filter.all",
      "themes.filter.ink",
      "themes.filter.floral",
      "themes.filter.modern",
      "themes.filter.seasonal",
    ];
    document.querySelectorAll("#page-themes .themes-filter .filter-tag").forEach((el, i) => {
      if (themeFilters[i]) el.textContent = this.t(themeFilters[i]);
    });
    if (window.MemorialContent?.renderThemesGrid) {
      MemorialContent.renderThemesGrid(
        MemorialStore?.get(MemorialCore?.slug)?.themeId || "ink-default"
      );
    }
  },

  applyQrPage() {
    const hero = document.querySelector("#page-qr .qr-hero");
    if (!hero) return;
    const h1 = hero.querySelector("h1");
    const p = hero.querySelector("p");
    if (h1) h1.textContent = this.t("qr.title");
    if (p) p.textContent = this.t("qr.sub");
    const demoLabel = hero.querySelector(".qr-demo-label");
    if (demoLabel) demoLabel.textContent = this.isEn() ? "Sample" : "示意样品";
    const feats = this.isEn()
      ? [
          ["Scan to visit", "Opens the memorial instantly—no search"],
          ["Weatherproof", "Outdoor-grade, fade-resistant materials"],
          ["Permanent link", "The URL stays valid for generations"],
          ["Custom engraving", "Name, years, and verse laser-etched"],
          ["Nationwide shipping", "Gift box, 7–15 business days"],
          ["Easy install", "Mounting kit included"],
        ]
      : [
          ["即扫即达", "扫一扫直接进入纪念馆，无需搜索"],
          ["防水防腐", "户外专用材质，历经风雨永不褪色"],
          ["永久有效", "链接永不失效，记忆永续传承"],
          ["定制刻字", "姓名、年份、诗句均可激光雕刻"],
          ["全国包邮", "精美礼盒包装，7-15个工作日送达"],
          ["专业安装", "附带安装工具包，简单固定即可"],
        ];
    hero.querySelectorAll(".qr-feat").forEach((el, i) => {
      if (!feats[i]) return;
      const title = el.querySelector(".qr-feat-title");
      const desc = el.querySelector(".qr-feat-desc");
      if (title) title.textContent = feats[i][0];
      if (desc) desc.textContent = feats[i][1];
    });
    const qrSec = document.querySelector("#page-qr .qr-products .section-title");
    const qrSub = document.querySelector("#page-qr .qr-products .section-sub");
    if (qrSec) qrSec.textContent = this.isEn() ? "Plaque products" : "铭牌产品";
    if (qrSub) qrSub.textContent = this.isEn() ? "Three materials" : "三款材质，各有千秋";
    const howTitle = document.querySelector("#page-qr .qr-how .section-title");
    const howSub = document.querySelector("#page-qr .qr-how .section-sub");
    if (howTitle) howTitle.textContent = this.isEn() ? "How it works" : "使用流程";
    if (howSub) howSub.textContent = this.isEn() ? "Three simple steps" : "三步完成，简单明了";
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
    if (window.MemorialContent?.loadHomeMemorials) {
      MemorialContent.loadHomeMemorials(!!window.MemorialCore?.useApi);
    }
    if (typeof renderPlanning === "function" && document.getElementById("planning-cats")) {
      renderPlanning();
      if (window.MemorialContent) {
        MemorialContent.syncPlanningUI(MemorialContent.loadPlanningState());
      }
    }
    if (window.MemorialCore?.refreshMemorialUI) {
      MemorialCore.refreshMemorialUI();
    }
  },
};

MemorialI18n.bootstrap();

document.addEventListener("DOMContentLoaded", () => {
  MemorialI18n.bindLangButton();
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
