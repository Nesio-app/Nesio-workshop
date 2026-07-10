/**
 * Roadmap 注册表 — 展示给用户评分的 backlog 功能清单。
 *
 * 单一事实源:加/删/改条目只动这里;App 内 RoadmapSheet 和
 * /admin 的评分汇总都读这份。投票落 Supabase feature_votes 表
 * (按设备去重,分数 1-5)。标题/描述双语,由渲染处按 locale 取。
 */

export interface RoadmapItem {
  id: string;
  title: { zh: string; en: string };
  description: { zh: string; en: string };
  status: 'exploring' | 'planned' | 'building';
}

export const ROADMAP_ITEMS: readonly RoadmapItem[] = [
  {
    id: 'daily_brief',
    title: { zh: '语音版简报', en: 'Audio daily brief' },
    description: {
      zh: '文字版每日简报已上线(今日焦点的「打开简报」);语音朗读版(真人音色)在探索中。',
      en: 'The text daily brief is live ("Open brief" on Today). An audio version with a natural voice is being explored.',
    },
    status: 'exploring',
  },
  {
    id: 'apple_widget',
    title: { zh: '苹果桌面 Widget', en: 'Apple home-screen widget' },
    description: {
      zh: '主屏一眼看到今日焦点和提醒。需要 App Store 原生版才能做(网页版做不了 Widget),原生壳是它的前置。',
      en: "Today's focus and reminders at a glance on the home screen. Requires the native App Store build (PWAs cannot ship widgets).",
    },
    status: 'planned',
  },
  {
    id: 'week_review',
    title: { zh: '每周回顾', en: 'Weekly review' },
    description: {
      zh: '周日晚自动生成:这周你记了什么、完成了什么、被照顾到了什么。',
      en: 'Auto-generated Sunday night: what you noted, finished, and were cared for this week.',
    },
    status: 'planned',
  },
  {
    id: 'location_journal',
    title: { zh: '位置自动日记', en: 'Location auto-journal' },
    description: {
      zh: '像 Life Cycle 一样,自动记录你去过哪、待了多久,变成可回看的一天。',
      en: 'Like Life Cycle: automatically log where you went and for how long, as a reviewable day.',
    },
    status: 'exploring',
  },
  {
    id: 'family_share',
    title: { zh: '家人共享空间', en: 'Family shared space' },
    description: {
      zh: '把"钥匙在哪、药还剩多少"这类家庭记忆共享给家人,各自手机都能问。',
      en: 'Share household memories — where the keys are, how much medicine is left — so everyone can ask.',
    },
    status: 'exploring',
  },
  {
    id: 'voice_diary',
    title: { zh: '语音日记', en: 'Voice diary' },
    description: {
      zh: '睡前说一分钟,自动整理成当天的日记和待确认线索。',
      en: 'Speak for a minute before bed; it becomes the day’s diary and confirmable clues.',
    },
    status: 'planned',
  },
  {
    id: 'purchase_insights',
    title: { zh: '购买与成本分析', en: 'Purchase & cost insights' },
    description: {
      zh: '记录的购买自动汇总:这个月花在哪、什么快到期该补货。',
      en: 'Purchases roll up automatically: where the money went and what needs restocking.',
    },
    status: 'exploring',
  },
  {
    id: 'calendar_write',
    title: { zh: '说一句就建日程', en: 'Say it, schedule it' },
    description: {
      zh: '「周五下午和 Linda 喝咖啡」直接写进你的 Google 日历,不用打开日历 App。',
      en: '"Coffee with Linda Friday afternoon" goes straight into Google Calendar.',
    },
    status: 'building',
  },
] as const;
