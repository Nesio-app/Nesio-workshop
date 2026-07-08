import type { FlomoMemo } from './flomo-api';

/** Demo timeline when read API is unavailable (webhook-only or token missing). */
export const FLOMO_DEMO_MEMOS: FlomoMemo[] = [
  {
    slug: 'demo-1',
    content: '午餐后 13 分钟出门走了 15 分钟，血糖峰压在 134，比久坐的日子低了约 22。',
    created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    tags: ['#健康', '#血糖'],
  },
  {
    slug: 'demo-2',
    content: '晚餐减半，夜里血糖一直平。今天神经系统也在往恢复方向走。',
    created_at: new Date(Date.now() - 9 * 3600000).toISOString(),
    updated_at: new Date(Date.now() - 9 * 3600000).toISOString(),
    tags: ['#饮食'],
  },
  {
    slug: 'demo-3',
    content: '把大事拆小，把今天过好就够了。',
    created_at: new Date(Date.now() - 26 * 3600000).toISOString(),
    updated_at: new Date(Date.now() - 26 * 3600000).toISOString(),
    tags: ['#觉察'],
  },
];
