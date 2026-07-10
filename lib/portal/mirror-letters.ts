/**
 * 多面镜月度信 — 认知模块的 Pro 形态(v1 规格 §2.3)。
 *
 * 每月一封:选一面镜子,它读你的本地档案,用第二人称写给你。
 * 规则:只回看不预测;每段带证据、可反驳(✓/✗);低置信不写;
 * 批量导入(通讯录等)剔出证据 —— 见 life-graph.isBulkImported。
 * 老友视角免费可试读,其余四面镜挂 Pro 门(feature: 'mirror_letter')。
 */

export type MirrorId = 'friend' | 'socratic' | 'jung' | 'blindspot' | 'stoic';

export interface MirrorDef {
  id: MirrorId;
  name: string;
  nameEn: string;
  desc: string;
  descEn: string;
  /** 免费可试读(其余挂 Pro 门) */
  freePreview?: boolean;
}

/** 镜子的人格 prompt 在服务端(app/api/portal/mirror-letter),客户端只传 id。 */
export const MIRRORS: MirrorDef[] = [
  { id: 'friend',    name: '老友',     nameEn: 'Old friend',     desc: '温暖直白,像认识你十年的人', descEn: 'Warm and direct, like someone who has known you for ten years', freePreview: true },
  { id: 'socratic',  name: '苏格拉底', nameEn: 'Socrates',       desc: '不下结论,只把你的矛盾变成问题', descEn: 'No conclusions — turns your contradictions into questions' },
  { id: 'jung',      name: '荣格',     nameEn: 'Jung',           desc: '反复出现的意象、你回避的主题', descEn: 'Recurring imagery and the themes you avoid' },
  { id: 'blindspot', name: '盲区侦探', nameEn: 'Blind-spot detective', desc: '你从不记什么,和这说明什么', descEn: 'What you never write down, and what that means' },
  { id: 'stoic',     name: '斯多葛',   nameEn: 'Stoic',          desc: '你惦记的事里哪些真的可控', descEn: 'Of the things on your mind, which are truly in your control' },
];

export interface MirrorParagraph {
  id: string;
  text: string;
  evidence: string[];
  confidence: number;
}

export interface MirrorLetter {
  mirrorId: MirrorId;
  /** 'YYYY-MM' */
  month: string;
  paragraphs: MirrorParagraph[];
  generatedAt: string;
}

const LETTERS_KEY = 'nesio-mirror-letters-v1';
const FEEDBACK_KEY = 'nesio-mirror-letter-feedback-v1';

export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function loadAllLetters(): Record<string, MirrorLetter> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(LETTERS_KEY) || '{}') as Record<string, MirrorLetter>;
  } catch { return {}; }
}

export function loadMirrorLetter(month: string, mirrorId: MirrorId): MirrorLetter | null {
  return loadAllLetters()[`${month}:${mirrorId}`] ?? null;
}

export function saveMirrorLetter(letter: MirrorLetter): void {
  if (typeof window === 'undefined') return;
  try {
    const all = loadAllLetters();
    all[`${letter.month}:${letter.mirrorId}`] = letter;
    // 只留最近 12 封,别让信堆爆配额
    const keys = Object.keys(all).sort();
    while (keys.length > 12) { delete all[keys.shift() as string]; }
    localStorage.setItem(LETTERS_KEY, JSON.stringify(all));
  } catch { /* 配额满就不缓存,下次重新生成 */ }
}

export type MirrorVerdict = 'yes' | 'no';

export function loadMirrorFeedback(): Record<string, MirrorVerdict> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}') as Record<string, MirrorVerdict>;
  } catch { return {}; }
}

/** ✓说得对 / ✗不像我 — 存本地,下一封生成时注入 prompt(接现有反馈环)。 */
export function saveMirrorFeedback(paragraphKey: string, verdict: MirrorVerdict): void {
  if (typeof window === 'undefined') return;
  try {
    const all = loadMirrorFeedback();
    all[paragraphKey] = verdict;
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

/** 最近的反馈样本(带原文),给下一封信的 prompt 用。 */
export function recentFeedbackSamples(limit = 8): Array<{ text: string; verdict: MirrorVerdict }> {
  const feedback = loadMirrorFeedback();
  const letters = loadAllLetters();
  const out: Array<{ text: string; verdict: MirrorVerdict }> = [];
  for (const key of Object.keys(letters).sort().reverse()) {
    for (const p of letters[key].paragraphs) {
      const v = feedback[`${key}:${p.id}`];
      if (v) out.push({ text: p.text.slice(0, 80), verdict: v });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
