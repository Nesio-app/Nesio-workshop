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
  tier?: 'free' | 'pro';    // 免费 / Pro(金角标);缺省 free
  gift?: boolean;           // 送你的第一部(零操作自动拍好的惊喜首片,做 hero)
  feel?: string;            // 落差揭晓的「说中你」结尾句(播放揭晓 + 分享卡用)
  sourceNote?: string;      // 取材来源/你写下的原话(播放开头亮出来 + 怎么做到解释)
}

/** Pro 月额度(UI stub;真实计费/额度扣减在 Lab 端生成时,后续接 entitlement)。 */
export const MONTHLY_PRO_QUOTA = 2;

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
    storyLine: '你大概忘了这一天 —— 我们没忘。',
    poster: '/demo/montage/p1-dog.jpg',
    videoUrl: '/demo/montage/p1-dog.mp4',
    createdAt: '2026-07-13T16:00:00.000Z',
    durationSec: 13,
    kind: 'memory',
    status: 'ready',
    tier: 'free',
    gift: true,
    feel: '开了一周会，你终于什么都没做 —— 就陪它，晒了一下午太阳。',
    sourceNote: '你 7/13 那条:「陪它坐了很久」+ 那天 4 张照片',
  },
  {
    id: 'demo-week',
    title: '这一周',
    storyLine: '十个会、八个快递 —— 但你也停下来过。',
    poster: '/demo/montage/p2-week.jpg',
    videoUrl: '/demo/montage/p2-week.mp4',
    createdAt: '2026-07-16T21:00:00.000Z',
    durationSec: 21,
    kind: 'week',
    status: 'ready',
    tier: 'free',
    feel: '忙，但你也停下来过。',
    sourceNote: '你这周:10 个会 · 8 个快递 · 涨了些的账单 + 周日午后那张',
  },
  {
    id: 'demo-story',
    title: '飞跃球网',
    storyLine: '你写的那段打球的记忆，变成一部小短剧。',
    poster: '/demo/montage/p3-story.jpg',
    videoUrl: '/demo/montage/p3-story.mp4',
    createdAt: '2026-07-18T10:00:00.000Z',
    durationSec: 29,
    kind: 'story',
    status: 'ready',
    tier: 'pro',
    feel: '那一下，你比自己以为的更勇敢。',
    sourceNote: '你写的那段打球的记忆',
  },
];
