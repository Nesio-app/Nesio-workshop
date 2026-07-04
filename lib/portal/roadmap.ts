/**
 * Roadmap 注册表 — 展示给用户评分的 backlog 功能清单。
 *
 * 单一事实源:加/删/改条目只动这里;App 内 RoadmapSheet 和
 * /admin 的评分汇总都读这份。投票落 Supabase feature_votes 表
 * (按设备去重,分数 1-5)。
 */

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  status: 'exploring' | 'planned' | 'building';
}

export const ROADMAP_ITEMS: readonly RoadmapItem[] = [
  {
    id: 'week_review',
    title: '每周回顾',
    description: '周日晚自动生成:这周你记了什么、完成了什么、被照顾到了什么。',
    status: 'planned',
  },
  {
    id: 'location_journal',
    title: '位置自动日记',
    description: '像 Life Cycle 一样,自动记录你去过哪、待了多久,变成可回看的一天。',
    status: 'exploring',
  },
  {
    id: 'family_share',
    title: '家人共享空间',
    description: '把"钥匙在哪、药还剩多少"这类家庭记忆共享给家人,各自手机都能问。',
    status: 'exploring',
  },
  {
    id: 'voice_diary',
    title: '语音日记',
    description: '睡前说一分钟,自动整理成当天的日记和待确认线索。',
    status: 'planned',
  },
  {
    id: 'purchase_insights',
    title: '购买与成本分析',
    description: '记录的购买自动汇总:这个月花在哪、什么快到期该补货。',
    status: 'exploring',
  },
  {
    id: 'calendar_write',
    title: '说一句就建日程',
    description: '「周五下午和 Linda 喝咖啡」直接写进你的 Google 日历,不用打开日历 App。',
    status: 'building',
  },
] as const;
