/**
 * video-montage — 小剧场(用户定:把一段真实记忆变成一小段厚涂动漫短片)。
 *
 * v0 只做「呈现层」:短片由 Lab 端(OpenMontage/Veo)从你的真实记忆生成后
 * 落进本机,这里读出来做画廊。数据主权同其余记忆:只在本机,可删。
 * 生成流程本身不在 App 运行时(端上不跑 Veo);此 tab 是它的家与入口。
 */

export interface VideoMontage {
  id: string;
  title: string;
  storyLine: string;        // 一句话故事(海报上/卡片上的那句)
  poster: string;           // 海报图 URL(本机或 /demo)
  videoUrl?: string;        // 成片 URL;生成中时可空
  createdAt: string;        // ISO
  durationSec: number;
  kind: 'memory' | 'week' | 'story';  // 记忆片段 / 一周故事 / 剧本小剧场
  status: 'ready' | 'generating';
}

const KEY = 'nesio-video-montage-v1';

export function loadMontages(): VideoMontage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

export function saveMontage(m: VideoMontage): void {
  const all = loadMontages().filter((x) => x.id !== m.id);
  try { localStorage.setItem(KEY, JSON.stringify([m, ...all].slice(0, 60))); } catch { /* quota */ }
}

export function deleteMontage(id: string): void {
  try { localStorage.setItem(KEY, JSON.stringify(loadMontages().filter((x) => x.id !== id))); } catch { /* quota */ }
}

export const KIND_LABEL: Record<VideoMontage['kind'], { zh: string; en: string }> = {
  memory: { zh: '记忆片段', en: 'Memory' },
  week: { zh: '一周故事', en: 'Your week' },
  story: { zh: '小剧场', en: 'Short film' },
};

/** 示例卡:store 为空时展示「它长什么样」,让用户看到呈现形态(标 示例,不混入真数据)。 */
export const DEMO_MONTAGES: VideoMontage[] = [
  {
    id: 'demo-dog',
    title: '那个周六的下午',
    storyLine: '开了一周的会，终于有时间，就什么都不做，陪它晒太阳。',
    poster: '/demo/montage/p1-dog.jpg',
    videoUrl: '/demo/montage/p1-dog.mp4',
    createdAt: '2026-07-13T16:00:00.000Z',
    durationSec: 13,
    kind: 'memory',
    status: 'ready',
  },
  {
    id: 'demo-week',
    title: '这一周',
    storyLine: '十个会、八个快递、涨了些的账单 —— 忙，但你也停下来过。',
    poster: '/demo/montage/p2-week.jpg',
    videoUrl: '/demo/montage/p2-week.mp4',
    createdAt: '2026-07-16T21:00:00.000Z',
    durationSec: 21,
    kind: 'week',
    status: 'ready',
  },
  {
    id: 'demo-story',
    title: '飞跃球网',
    storyLine: '你写的那段打球的记忆，变成了一部小短剧。',
    poster: '/demo/montage/p3-story.jpg',
    videoUrl: '/demo/montage/p3-story.mp4',
    createdAt: '2026-07-17T15:00:00.000Z',
    durationSec: 27,
    kind: 'story',
    status: 'ready',
  },
];
