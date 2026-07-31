/**
 * jot-draft —— 今天页那条「记一笔」草稿的存法(2026-07-30,bug #25)。
 *
 * 用户原话:「首页输入框里『关注chong』这行草稿文字,切换语言、清空缓存、
 * 多次导航之后依然一直存在,从未被清空过。」
 *
 * 草稿持久化本身是对的(没点记下就退出,下次进来还在)。错的是它**没有尽头**:
 *   · 存的只有一串文字,没有「什么时候留下的」;
 *   · 于是三个月前语音把环境音听成的半句,今天打开还躺在输入框里,
 *     看起来就像你刚刚打的。
 *
 * 加一件事就够了:**记下它是什么时候留下的**。
 *   · 超过 DRAFT_TTL_DAYS 天没碰 → 不再恢复(它是 cache 类数据,丢了本来就没关系);
 *   · 在这之内但不是今天留下的 → 恢复,但在输入条下面说清楚是哪天的,
 *     用户一眼就知道这不是自己刚打的。
 *
 * 兼容老格式:以前存的是裸字符串。读到裸字符串照样恢复(那是用户的字,不能扔),
 * 只是没有日期可说 —— 下一次写入就升级成带时间的格式。
 *
 * 纯函数 + 一层薄存储,键 `nesio-jot-draft-v1`(已在 CACHE_KEYS 与 storage-key-registry 登记)。
 */

export const JOT_DRAFT_KEY = 'nesio-jot-draft-v1';
/** 多久没碰就不再恢复。 */
export const DRAFT_TTL_DAYS = 14;
/** 读入防线:超长的一律丢(QA:草稿里出现过从未输入过的长串)。 */
export const MAX_DRAFT_CHARS = 2000;

const DAY_MS = 86_400_000;

export interface JotDraft {
  text: string;
  /** ISO 时刻;老格式(裸字符串)读出来是空串。 */
  at: string;
}

/** 从存下来的原始值解析出草稿 —— 纯函数,便于单测。 */
export function parseDraft(raw: string | null, now: number = Date.now()): JotDraft | null {
  if (!raw || typeof raw !== 'string') return null;
  let text = '';
  let at = '';
  if (raw.startsWith('{')) {
    try {
      const o = JSON.parse(raw) as { text?: unknown; at?: unknown };
      text = typeof o.text === 'string' ? o.text : '';
      at = typeof o.at === 'string' ? o.at : '';
    } catch { return null; }
  } else {
    text = raw;   // 老格式:裸字符串,没有日期
  }
  if (!text.trim()) return null;
  if (text.length > MAX_DRAFT_CHARS) return null;
  if (at) {
    const t = Date.parse(at);
    // 日期读不出来 → 当没有日期用(不因为脏数据就把用户的字扔掉)
    if (Number.isFinite(t) && now - t > DRAFT_TTL_DAYS * DAY_MS) return null;
  }
  return { text, at };
}

/**
 * 这条草稿要不要在输入条下面说一句「这是哪天留下的」。
 * 今天留下的、或者不知道哪天的(老格式)→ 不说,那是噪音。
 */
export function draftAgeNote(draft: JotDraft, now: Date = new Date()): { zh: string; en: string } | null {
  if (!draft.at) return null;
  const t = Date.parse(draft.at);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return null;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return {
    zh: `这是 ${md} 留下的草稿`,
    en: `Draft left on ${md}`,
  };
}

export function readJotDraft(now: Date = new Date()): JotDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseDraft(localStorage.getItem(JOT_DRAFT_KEY), now.getTime());
  } catch { return null; }
}

export function writeJotDraft(text: string, now: Date = new Date()): void {
  if (typeof window === 'undefined') return;
  try {
    if (text) localStorage.setItem(JOT_DRAFT_KEY, JSON.stringify({ text, at: now.toISOString() }));
    else localStorage.removeItem(JOT_DRAFT_KEY);
  } catch { /* 草稿是 cache 类:存不下就下次再说,不值得打扰用户 */ }
}
