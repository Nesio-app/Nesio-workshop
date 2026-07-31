/**
 * lens — 镜头看记忆(artifact d7bd8990)。用户定核心:镜头不是独立页面,是**长在记忆上**的动作。
 * ① 吃记忆当输入(不用再打字)② 拆完存回这条记忆 + 记入心智维度 ③ 情绪重的记忆主动来找你。
 * 帮你吵/思维框架不再是孤岛,是这个「镜头库」里的条目;投资类=灰色领域扩展包。
 * 走 /api/portal/chat 出结构化分层结果;无 key/失败 → null(上层给兜底文案)。
 */
import type { MindDimension } from './growth-engine';

const DISTRESS_RE = /累|沮丧|难过|焦虑|烦|压力|失望|委屈|不开心|心情不好|崩溃|想哭|扛不住|emo|嗡|坐了很久/i;
const SELF_BLAME_RE = /没用|不行|不够|差劲|失败|搞砸|做不好|笨|都怪我|是我的错|我应该|没领导好|没以身作则/i;

/**
 * #35(2026-07-30 真机):把「前提·事实·逻辑·情绪」「认知扭曲识别」这类镜头
 * 套在一条「PROD Install Zoom Bridge 会议通知」上,输出的「情绪」一栏只能生硬地写
 * 「收到这个通知,可能意味着安装过程已经完成」—— 用户说得对:很勉强,没有实际价值。
 *
 * 这些镜头是给**人说的话**设计的。判据得是正向的:这段文字里要有**第一人称或情绪词**,
 * 才谈得上拆「你的前提」「你的情绪」。一条系统通知里没有「你」,拆出来的只能是编的。
 */
const PERSONAL_RE = /我|咱|自己|觉得|感觉|担心|希望|想要|后悔|难受|生气|开心|\bI\b|\bmy\b|\bme\b|\bfeel|\bworr|\bhope/i;

export function hasPersonalVoice(text: string): boolean {
  return PERSONAL_RE.test(String(text || ''));
}

export interface MemoryLens {
  id: string;
  name: string; nameEn: string;
  desc: string; descEn: string;
  icon: string;                 // 描线 svg path
  dim: MindDimension;           // 拆完记入的心智维度
  locked?: boolean;             // 领域扩展包(如投资)未安装
  /** 是否为这条记忆推荐(纯规则,零成本)。 */
  recommend?: (text: string) => boolean;
  /** #35:这个镜头拆的是「人说的话」。文字里没有第一人称/情绪词时不提供它。 */
  needsPersonal?: boolean;
  /** 分层拆解的键序(也进 prompt);AI 按这些键回填。 */
  layerKeys: string[];
  buildPrompt: (text: string) => string;
}

function layerPrompt(text: string, lensName: string, keys: string[], cta: string): string {
  return `把这段真实记忆用「${lensName}」拆开(只用记忆里真有的,别编):"""${text}"""\n` +
    `按这几层各写一句(温和、口语、不说教):${keys.map((k) => `「${k}」`).join('、')};` +
    `再给一句 cta:${cta}。\n只输出严格 JSON:{"layers":[${keys.map((k) => `{"k":"${k}","v":""}`).join(',')}],"cta":""}`;
}

export const MEMORY_LENSES: MemoryLens[] = [
  {
    id: 'argue', name: '前提·事实·逻辑·情绪', nameEn: 'Premise · fact · logic · feeling',
    desc: '把这句重话拆成四层,看它是不是真那么重', descEn: 'Split the heavy line into four layers',
    icon: '<path d="M4 5h16v10H10l-4 3v-3H4z"/><path d="M8 9h8M8 12h5"/>', dim: 'emotion',
    recommend: (t) => DISTRESS_RE.test(t) || SELF_BLAME_RE.test(t),
    needsPersonal: true,
    layerKeys: ['事实', '前提', '逻辑', '情绪'],
    buildPrompt: (t) => layerPrompt(t, '前提·事实·逻辑·情绪(帮你吵)', ['事实', '前提', '逻辑', '情绪'], '一句你可以说出口的、平静的回法'),
  },
  {
    id: 'cbt', name: '认知扭曲识别', nameEn: 'Cognitive distortion',
    desc: '这句自我评价里藏着哪个思维陷阱', descEn: 'Which thinking trap hides in this self-talk',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M9 10a3 3 0 0 1 6 0c0 2-3 2-3 4M12 18h.01"/>', dim: 'blindspot',
    recommend: (t) => SELF_BLAME_RE.test(t),
    needsPersonal: true,
    layerKeys: ['陷阱', '真相', '分开'],
    buildPrompt: (t) => layerPrompt(t, '认知扭曲识别(CBT)', ['陷阱', '真相', '分开'], '敌人是那个陷阱,不是你 —— 一句拿回主动权的话'),
  },
  {
    id: 'five-whys', name: '五问根因', nameEn: 'Five whys',
    desc: '连问五个为什么,别停在表面', descEn: 'Ask why five times — past the surface',
    icon: '<path d="M12 3v18M5 8l7-5 7 5"/>', dim: 'logic',
    layerKeys: ['为什么①', '为什么②', '为什么③', '为什么④', '根因'],
    buildPrompt: (t) => layerPrompt(t, '五问根因', ['为什么①', '为什么②', '为什么③', '为什么④', '根因'], '找到根因后,现在能动的一小步'),
  },
  {
    id: 'premortem', name: '事前验尸', nameEn: 'Pre-mortem',
    desc: '假设这决定一年后错了,提前排雷', descEn: 'Assume it failed in a year — de-risk now',
    icon: '<path d="M12 4a8 8 0 1 0 8 8"/><path d="M12 4v8l5 3"/>', dim: 'control',
    layerKeys: ['假设失败', '最可能的原因', '现在能补的'],
    buildPrompt: (t) => layerPrompt(t, '事前验尸', ['假设失败', '最可能的原因', '现在能补的'], '此刻就能落的一个预防动作'),
  },
  {
    id: 'fallacy', name: '逻辑谬误识别', nameEn: 'Logical fallacy',
    desc: '指出用了哪种谬误,怎么点破', descEn: 'Name the fallacy, and how to break it',
    icon: '<path d="M4 12a8 8 0 0 1 16 0M12 4v4M8 20l4-8 4 8"/>', dim: 'logic',
    layerKeys: ['谬误', '为什么不成立', '怎么点破'],
    buildPrompt: (t) => layerPrompt(t, '逻辑谬误识别', ['谬误', '为什么不成立', '怎么点破'], '一句不带火气、能戳到点上的回应'),
  },
  {
    id: 'capability', name: '能力圈 · 段永平三问', nameEn: 'Circle of competence',
    desc: '投资框架 —— 领域扩展包 · 未安装', descEn: 'Investing pack — not installed',
    icon: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', dim: 'logic',
    locked: true, layerKeys: [], buildPrompt: () => '',
  },
];

export function lensById(id: string): MemoryLens | undefined { return MEMORY_LENSES.find((l) => l.id === id); }

/**
 * 为一条记忆排镜头:推荐的在前(命中 recommend),锁定的在最后。
 * #35:文字里没有第一人称/情绪词时,把「拆人说的话」那几个镜头**收起来**,
 * 并把收起来的数量报出去 —— 界面据此说一句「这条是事务性记录」,
 * 而不是让用户挨个点开发现输出都很勉强。
 */
export function lensesForMemory(text: string): {
  recommended: MemoryLens[]; rest: MemoryLens[]; locked: MemoryLens[]; withheldPersonal: number;
} {
  const personal = hasPersonalVoice(text);
  const recommended: MemoryLens[] = [];
  const rest: MemoryLens[] = [];
  const locked: MemoryLens[] = [];
  let withheldPersonal = 0;
  for (const l of MEMORY_LENSES) {
    if (l.locked) { locked.push(l); continue; }
    if (l.needsPersonal && !personal) { withheldPersonal += 1; continue; }
    if (l.recommend?.(text)) recommended.push(l);
    else rest.push(l);
  }
  return { recommended, rest, locked, withheldPersonal };
}

/** 情绪重的记忆 → 主动提示(上方 warm 卡)。 */
export function shouldNudge(text: string): boolean { return DISTRESS_RE.test(text) && SELF_BLAME_RE.test(text); }

export interface LensResult { layers: Array<{ k: string; v: string }>; cta: string }

/** 应用一个镜头:走 /api/portal/chat 出分层结果;失败/无 key → null。 */
export async function applyLens(lens: MemoryLens, text: string, locale: string): Promise<LensResult | null> {
  if (lens.locked || !text.trim()) return null;
  try {
    const res = await fetch('/api/portal/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: lens.buildPrompt(text), uiLocale: locale.toLowerCase().startsWith('en') ? 'en' : 'zh' }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok?: boolean; response?: string };
    if (!data.ok || !data.response) return null;
    const j = safeJson(data.response);
    if (!j || !Array.isArray(j.layers) || !j.layers.length) return null;
    return { layers: j.layers.map((l) => ({ k: String(l.k || ''), v: String(l.v || '') })), cta: String(j.cta || '') };
  } catch { return null; }
}

function safeJson(text: string): { layers?: Array<{ k?: string; v?: string }>; cta?: string } | null {
  const t = text.trim().replace(/^```json?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {
    const m = t.match(/\{[\s\S]*\}/); if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

/* ── 念念还记得(Bug4 图6:「内容逻辑正确吗?」)────────────────────────────── */

/**
 * 一条记忆的「回声」:更早那条**共享同一个主题标签**的记忆。
 *
 * 原来的写法对 tag 一视同仁地取交集,而记忆上挂的标签一大半根本不是主题 ——
 * 采集方式(手记 / Voice)、来源(邮件 / flomo / 日历)、内部维度(domain: / facet:)。
 * 任意两条邮件都共享「邮件」,于是这句「你 X/Y 也记过类似的一次」对几乎任何一条
 * 记忆都会出现,而两条之间毫无关系 —— 和「健身邮件被认成健康打卡」是同一族的错。
 *
 * 纯函数,不读全局:传入这条 + 全部,自己判。isTopicTag 是仓库里「什么算主题」的唯一判据。
 */
export interface LensEcho {
  /** 共享的那个主题标签 —— 印出来才让这句话可被用户检验 */
  tag: string;
  /** 更早那条的时间 */
  at: string;
  /** 更早的同标签记忆一共几条 */
  count: number;
  /** ≥2 条才敢叫「模式」。n=1 说模式是硬凑 */
  many: boolean;
  /**
   * #36:这个标签是**背景常量**吗 —— 几乎每天都出现的那种。
   * 现场:「你 7/30 也提过『Fidelity』——在这之前一共 58 次——也许是个值得留意的模式」。
   * 可 Fidelity 是每天日程同步通知里固定出现的 401k 托管方名字,它**本来就该天天出现**。
   * 天天出现的东西描述的是「你每天都会收到这类通知」,不是「你最近在关注它」。
   * 把它包装成「值得留意的模式」是伪洞察。
   */
  background: boolean;
}

/** 出现在这么大比例的日子里,且条数够多 → 当背景常量,不叫模式。 */
export const BACKGROUND_DAY_COVERAGE = 0.6;
export const BACKGROUND_MIN_COUNT = 10;

export function lensEcho(
  node: { id: string; createdAt: string; tags?: string[] },
  all: ReadonlyArray<{ id: string; createdAt: string; tags?: string[] }>,
  isTopic: (t: string) => boolean,
): LensEcho | null {
  const norm = (t: unknown) => String(t ?? '').trim();
  const mine = (node.tags || [])
    .map(norm)
    .filter((t) => t && isTopic(t) && !/^(domain:|facet:)/i.test(t));
  if (!mine.length) return null;
  const self = new Date(node.createdAt).getTime();
  if (Number.isNaN(self)) return null;
  const earlier = all.filter((x) => {
    if (x.id === node.id) return false;
    const t = new Date(x.createdAt).getTime();
    if (Number.isNaN(t) || t >= self) return false;
    return (x.tags || []).some((tg) => mine.includes(norm(tg)));
  });
  if (!earlier.length) return null;
  const sorted = [...earlier].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const prev = sorted[0];
  const tag = (prev.tags || []).map(norm).find((t) => mine.includes(t)) || '';

  // 背景常量判定:这个标签占了多少比例的「有记录的日子」。
  const dayKey = (iso: string) => String(iso).slice(0, 10);
  const allDays = new Set(all.map((x) => dayKey(x.createdAt)).filter(Boolean));
  const tagDays = new Set(sorted.map((x) => dayKey(x.createdAt)).filter(Boolean));
  const coverage = allDays.size ? tagDays.size / allDays.size : 0;
  const background = sorted.length >= BACKGROUND_MIN_COUNT && coverage >= BACKGROUND_DAY_COVERAGE;

  return {
    tag,
    at: prev.createdAt,
    count: sorted.length,
    // 天天出现的不算模式 —— 它只是背景
    many: sorted.length >= 2 && !background,
    background,
  };
}
