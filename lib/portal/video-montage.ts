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
  /**
   * Bug4 图21「让按钮功能实现」:端上真能做出来的那一种短片 ——
   * 拿你自己记忆里的照片和原话,在本机排成一段会自己走的画面。
   * 有 slides 就走幻灯播放器(不需要 videoUrl,也不需要任何后端)。
   */
  slides?: MontageSlide[];
}

export interface MontageSlide {
  /** 图片在 IndexedDB 本机图库里的 assetId(getLocalImage 读) */
  assetId: string;
  /** 这张图配的那句话 —— 用户自己写的,不生成、不改写 */
  caption?: string;
  /** 这一张来自哪个记忆节点(点开可回到原记忆) */
  nodeId?: string;
}

/** 每张停留时长。3.2s 是「看清楚 + 不拖沓」的折中,整片时长 = 张数 × 它。 */
export const SLIDE_MS = 3200;

/** Pro 月额度(UI stub;真实计费/额度扣减在 Lab 端生成时,后续接 entitlement)。 */
export const MONTHLY_PRO_QUOTA = 2;

import { reportStorageDropped } from './storage-health';

const KEY = 'nesio-video-montage-v1';

export function loadMontages(): VideoMontage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

export function saveMontage(m: VideoMontage): boolean {
  const all = loadMontages().filter((x) => x.id !== m.id);
  try {
    localStorage.setItem(KEY, JSON.stringify([m, ...all].slice(0, 60)));
    return true;
  } catch {
    // 红线:写失败会丢用户刚做的片子,不能静默 —— 派可见事件,并让调用方能报错。
    reportStorageDropped();
    return false;
  }
}

/**
 * 从真实记忆节点拼一部本机短片(Bug4 图21)。
 * 只用节点里已有的东西:第一张图当海报底、用户自己写的原话当字幕。
 * 不调 AI、不写文案、不上传 —— 拼不出来就返回 null,由调用方告诉用户为什么。
 */
export function buildMemoryMontage(
  picks: Array<{ nodeId: string; assetId: string; caption?: string; createdAt?: string }>,
  opts: { title: string; id: string } ,
): VideoMontage | null {
  const slides: MontageSlide[] = picks
    .filter((p) => p.assetId)
    .map((p) => ({ assetId: p.assetId, caption: (p.caption || '').trim() || undefined, nodeId: p.nodeId }));
  if (slides.length === 0) return null;
  const firstLine = slides.find((s) => s.caption)?.caption || '';
  return {
    id: opts.id,
    title: opts.title,
    storyLine: firstLine,
    poster: '',                       // 海报即第一张 slide,播放/卡片按 assetId 现读
    createdAt: new Date().toISOString(),
    durationSec: Math.round((slides.length * SLIDE_MS) / 1000),
    kind: 'memory',
    status: 'ready',
    sourceNote: firstLine || undefined,
    slides,
  };
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
