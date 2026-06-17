/** @typedef {{ text: string, tag?: string, kind?: 'normal'|'action'|'math'|'formula', formula?: string, bubble?: string }} ReadingLine */
/** @typedef {{ title: string, lines: ReadingLine[] }} Section */
/** @typedef {{ title: string, sections: Section[] }} Chapter */
/** @typedef {{ id: string, title: string, author: string, category: string, spine: { gradient: string, label: string }, chapters: Chapter[] }} Book */

/** @type {Book[]} */
window.READING_BOOKS = [
  {
    id: 'cfa-fixed-income',
    title: 'Fixed Income Valuation',
    author: 'CFA Level II',
    category: 'CFA',
    spine: { gradient: 'linear-gradient(135deg,#2C5F8A,#1A3A5C)', label: 'CFA L2' },
    chapters: [
      {
        title: 'Chapter 3',
        sections: [
          {
            title: '§2 Key Rate Duration',
            lines: [
              { text: 'Convexity 修正解释了债券价格与利率之间非线性关系。' },
              { text: '画出 Price-Yield 曲线弧形。', tag: '⚡物理动作', kind: 'action' },
              { text: 'Parallel shifts affect all maturities uniformly.' },
              {
                text: 'Key rate duration isolates sensitivity at a specific maturity point.',
                bubble:
                  'Key rate duration 是 Ch.2 §3 引入的局部敏感性工具。它只盯着你指定的到期节点——相当于曲线上的精准手术刀，而非对整条曲线同等敏感的普通久期。',
              },
              { text: 'Bucket approach 将曲线切分为若干关键期限节点。' },
              { text: '纸上标出 2Y / 5Y / 10Y 三个桶。', tag: '⚡物理动作', kind: 'action' },
              { text: 'Effective duration assumes a parallel shift of the entire yield curve.' },
              { text: 'Summing all key rate durations ≈ effective duration of the bond.' },
              { kind: 'formula', formula: 'KRD(t) = −[ΔP / P] / Δy(t)' },
              { text: 'Practical use: hedging non-parallel yield curve exposure in portfolio.' },
              { text: '做 §3 练习题前先完成 §2 KRD 自测。', tag: '⚡下一步', kind: 'action' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'identity-personality',
    title: '身份与人格',
    author: '朱建军',
    category: '心理',
    spine: { gradient: 'linear-gradient(135deg,#4A7C5F,#2D5C42)', label: '心理' },
    chapters: [
      {
        title: 'Chapter 6',
        sections: [
          {
            title: '子人格的边界',
            lines: [
              { text: '每个人内心都住着许多子人格，它们各自承担不同功能。' },
              { text: '当某个子人格过度主导，整体就会失去弹性。', tag: '💡觉察', kind: 'action' },
              {
                text: '边界不是隔离，而是让各个部分都能被听见。',
                bubble: '这与 CFA 里「严格控制边界条件」同源：不是为了封闭，而是为了保护系统稳定运行。',
              },
              { text: '练习：写下今天最强势的那个「声音」来自谁。', tag: '⚡物理动作', kind: 'action' },
              { text: '允许自己重置，是能量管理的高阶策略，而非失控。' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'talk-smart',
    title: 'Think Fast Talk Smart',
    author: 'Matt Abrahams',
    category: '演讲',
    spine: { gradient: 'linear-gradient(135deg,#7B5EA7,#5C3E8A)', label: '演讲' },
    chapters: [
      {
        title: 'Pace · Space · Grace',
        sections: [
          {
            title: '节奏与停顿',
            lines: [
              { text: 'Great speakers use pace, space, and grace to land ideas.' },
              { text: '在关键切点处主动制造停顿，让听众有时间消化信号。', tag: '⚡物理动作', kind: 'action' },
              {
                text: 'Silence is not empty—it is where meaning settles.',
                bubble: '与 Key Rate Duration 切割曲线节点的逻辑本质相同：在关键切点处停顿，让信号被充分吸收。',
              },
              { text: 'Practice one sentence with a deliberate pause after the verb.' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'zhuangzi',
    title: '庄子·逍遥游',
    author: '庄子',
    category: '古典',
    spine: { gradient: 'linear-gradient(135deg,#3d5a4c,#1a2e26)', label: '逍' },
    chapters: [
      {
        title: '逍遥游',
        sections: [
          {
            title: '开篇',
            lines: [
              { text: '北冥有鱼，其名为鲲。鲲之大，不知其几千里也。' },
              { text: '化而为鸟，其名为鹏。鹏之背，不知其几千里也。' },
              {
                text: '怒而飞，其翼若垂天之云。',
                bubble: '「怒」在这里不是愤怒，而是奋起、鼓动。读古典时，先放下现代汉语的直觉反应。',
              },
              { text: '是鸟也，海运则将徙于南冥。南冥者，天池也。' },
            ],
          },
        ],
      },
    ],
  },
];

window.INSIGHT_CARDS = [
  {
    id: 'i1',
    type: 'CBT 认知对撞',
    icon: '🧠',
    iconBg: 'rgba(193,122,58,.1)',
    title: '边界即防线——两套体系的共鸣',
    body: '你在阅读中划下的「严格控制边界条件」，和你在生活适配里记录的「运动日严禁红光仪」，在深层逻辑上完全重合。它们都是你为了保护大后方稳固而设下的物理过载切断器。',
    sources: ['📖 CFA Ch.3', '🌱 生活适配', '💡 笔记'],
    pts: 40,
    time: '2天前',
    tag: 'CBT',
    new: false,
  },
  {
    id: 'i2',
    type: '逆向思考视角',
    icon: '🔄',
    iconBg: 'rgba(123,94,167,.1)',
    title: '进度蒸发不是放弃',
    body: '「无损蒸发进度」与「自我不是稳定实体」指向同一意象：允许自己重置，是能量管理的高阶策略，而非失控。',
    sources: ['📖 身份与人格', '🎯 行为观察'],
    pts: 35,
    time: '4天前',
    tag: '逆向',
    new: false,
  },
  {
    id: 'i3',
    type: '二阶思考',
    icon: '⚡',
    iconBg: 'rgba(74,124,95,.1)',
    title: '说话节奏与利率节点的同构',
    body: 'Talk Smart 的「Pace/Space/Grace」与 Key Rate Duration 切割曲线节点的逻辑本质相同——在关键切点处主动制造停顿，让听众（或市场）有时间消化信号。',
    sources: ['📖 Talk Smart', '📖 CFA §2'],
    pts: 50,
    time: '刚刚',
    tag: '二阶',
    new: true,
  },
];

window.SHOP_ITEMS = [
  { id: 'coffee', emoji: '☕', name: '20分钟咖啡放空', desc: '无屏幕，只是坐着发呆，完全合理', cost: 200, affordable: true },
  { id: 'bath', emoji: '🛁', name: '泡澡 30 分钟', desc: '含精油，含蜡烛，含完全不想任何事', cost: 400, affordable: false },
  { id: 'walk', emoji: '🐕', name: '特别遛弯', desc: '双倍时长，不看手机，只专注于当下', cost: 150, affordable: true },
  { id: 'game', emoji: '🎮', name: '游戏 1 小时', desc: '本周已读满 3 章方可兑换', cost: 600, affordable: false },
  { id: 'rabbit', emoji: '🐇', name: '5分钟兔子洞', desc: '特许解压舱 · 杂念倾倒后自动收网', cost: 0, free: true, action: 'rabbit' },
  { id: 'vapor', emoji: '🌀', name: '进度无损蒸发', desc: '重置一本书 · 划线资产完整保留', cost: 0, free: true, accent: true, action: 'eraser' },
];

window.ONBOARD_STEPS = [
  { icon: '🌱', title: '从这里开始', body: '告诉我们你最常阅读的内容类型，系统会为你调校最适合的神经友好模式。' },
  { icon: '👁', title: '只负责「看」', body: '无需划线，无需连图。视线停留 4 秒，系统自动在后台静默标记已吸收碎片。' },
  { icon: '🌊', title: '瀑布流脱水', body: '每行不超过 25 字，只含一个逻辑要点。卡拉 OK 遮罩让你的视线永远有清晰焦点。' },
  { icon: '✦', title: '知识自动对撞', body: '合上书后，AI 跨书、跨时间线熬制洞察，让你的划线碎片持续回充多巴胺。' },
];
