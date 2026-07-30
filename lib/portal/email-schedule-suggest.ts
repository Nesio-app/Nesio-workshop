/**
 * email-schedule-suggest —— 从邮件里认出「明确带时间的安排」(2026-07-30 用户要求:
 * 「邮件里可以识别明确带有时间的安排,直接放入日程,或者弹出一个提示框,让我确认」)。
 *
 * 用户给了两条路,这里走**确认**那条 —— 不是偷懒,是因为这个仓库在「猜用户的意思」
 * 上翻过车(邮件标题里的「健身」被认成健康打卡、一张毯子的照片长出假「明天」)。
 * 自动写进日程的代价是不可见的:错了他不会知道,只会发现日程里多了不认识的东西;
 * 而弹一次确认的代价是一次点击。这个不对称决定了走哪条。
 *
 * 判据是**正向且苛刻**的:必须同时出现
 *   ① 一个明确的**日历日期**(2026-08-03 / Aug 3 / 8月3日)——
 *      「明天」「下周」这类相对词一概不认。它们正是假日期的来源:
 *      「明天要还的钱」和「明天见」在字面上没有区别;
 *   ② 一个明确的**钟点**(14:00 / 2pm / 下午两点);
 *   ③ 两者**挨得很近**(NEAR_CHARS 以内)。否则页眉的日期会和页脚的营业时间凑成一场约会。
 * 三条缺一条就返回 null。宁可漏掉一封真有约的邮件(用户还能自己加),
 * 也不要弹一个莫名其妙的确认框 —— 那种东西弹三次,用户就再也不看了。
 *
 * 纯函数,不碰存储/DOM/网络。
 */

/** 日期和钟点最远隔多少个字符还算「说的是同一件事」。 */
const NEAR_CHARS = 48;
/** 只看主题 + 正文开头 —— 再往下是签名档和条款,那里的日期不是约会。 */
const SCAN_BODY_CHARS = 1200;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

interface Found { index: number; y?: number; m: number; d: number; }
interface FoundTime { index: number; h: number; mi: number; }

function collectDates(hay: string): Found[] {
  const out: Found[] = [];
  const push = (index: number, y: number | undefined, m: number, d: number) => {
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) out.push({ index, y, m, d });
  };

  // 2026-08-03 / 2026/8/3
  for (const m of hay.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    push(m.index ?? 0, Number(m[1]), Number(m[2]), Number(m[3]));
  }
  // Aug 3 / August 3rd, 2026
  for (const m of hay.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/gi)) {
    push(m.index ?? 0, m[3] ? Number(m[3]) : undefined, MONTHS[m[1].toLowerCase()], Number(m[2]));
  }
  // 3 Aug / 3rd August 2026
  for (const m of hay.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*(20\d{2}))?\b/gi)) {
    push(m.index ?? 0, m[3] ? Number(m[3]) : undefined, MONTHS[m[2].toLowerCase()], Number(m[1]));
  }
  // 2026年8月3日 / 8月3号
  for (const m of hay.matchAll(/(?:(20\d{2})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g)) {
    push(m.index ?? 0, m[1] ? Number(m[1]) : undefined, Number(m[2]), Number(m[3]));
  }
  return out;
}

function collectTimes(hay: string): FoundTime[] {
  const out: FoundTime[] = [];

  /*
   * **am/pm 先扫,而且要把它盖住的位置记下来。**
   *
   * 「Sat, Aug 3 at 7:30 PM」里,`7:30` 同时能被 24 小时制那条正则认走 —— 两条命中
   * 起点相同,后来的挤不掉先来的,于是 7:30 PM 变成了早上 7:30(真机踩到:
   * 一场晚餐订位被排到了清晨)。谁更具体谁先说话:带 PM 的那条信息量严格更大。
   */
  const claimed = new Set<number>();
  // 2pm / 2:30 p.m.
  for (const m of hay.matchAll(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?\s?m\.?\b/gi)) {
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === 'p') h += 12;
    const index = m.index ?? 0;
    claimed.add(index);
    out.push({ index, h, mi: m[2] ? Number(m[2]) : 0 });
  }
  // 14:00 / 9:30(跳过已经被 am/pm 认走的那几处)
  for (const m of hay.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)) {
    const index = m.index ?? 0;
    if (claimed.has(index)) continue;
    out.push({ index, h: Number(m[1]), mi: Number(m[2]) });
  }
  // 下午两点半 / 早上 10 点 / 晚上8点15分
  for (const m of hay.matchAll(/(上午|下午|早上|晚上|中午)?\s*(\d{1,2})\s*[点時时](?:\s*(\d{1,2})\s*分|\s*(半))?/g)) {
    let h = Number(m[2]);
    if (h > 24) continue;
    const period = m[1];
    if ((period === '下午' || period === '晚上') && h < 12) h += 12;
    if (period === '中午' && h < 12) h = 12;
    if (h >= 24) continue;
    out.push({ index: m.index ?? 0, h, mi: m[4] ? 30 : m[3] ? Number(m[3]) : 0 });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

export interface ScheduleHint {
  /** 墙上时钟 `YYYY-MM-DDTHH:mm`(与 schedule-reminders 同一种格式)。 */
  at: string;
  /** 原文里认出来的那一小段 —— 确认框里要把它摆给用户看,让他自己判断对不对。 */
  snippet: string;
}

/**
 * 认一封邮件里有没有「明确带时间的安排」。
 *
 * @param emailDateIso 这封邮件的时间。**只用来补年份**(信里常写「Aug 3」不写年),
 *   不参与任何「明天/下周」的推算 —— 那种推算正是假日期的来源。
 */
export function suggestScheduleFromEmail(
  subject: string,
  body: string,
  emailDateIso?: string,
): ScheduleHint | null {
  const hay = `${subject || ''}\n${(body || '').slice(0, SCAN_BODY_CHARS)}`;
  const dates = collectDates(hay);
  const times = collectTimes(hay);
  if (!dates.length || !times.length) return null;

  // 找**挨得最近**的一对。隔得远说明它们在讲两件事。
  let best: { d: Found; t: FoundTime; gap: number } | null = null;
  for (const d of dates) {
    for (const t of times) {
      const gap = Math.abs(d.index - t.index);
      if (gap > NEAR_CHARS) continue;
      if (!best || gap < best.gap) best = { d, t, gap };
    }
  }
  if (!best) return null;

  const sent = emailDateIso ? new Date(emailDateIso) : null;
  const sentOk = sent && !Number.isNaN(sent.getTime()) ? sent : null;
  let year = best.d.y ?? (sentOk ? sentOk.getFullYear() : new Date().getFullYear());

  const make = (y: number) => new Date(y, best!.d.m - 1, best!.d.d, best!.t.h, best!.t.mi, 0, 0);
  let when = make(year);
  // 没写年份、而算出来的日子比这封信早了一周以上 → 说的多半是明年
  // (12 月底收到的信里写「Jan 5」)。只在**年份缺失**时才动,写了年份就照写的算。
  if (best.d.y === undefined && sentOk && when.getTime() < sentOk.getTime() - 7 * 864e5) {
    year += 1;
    when = make(year);
  }
  // 日子对不上(2月30日之类)就算了 —— 不四舍五入到 3 月 2 日
  if (when.getMonth() !== best.d.m - 1 || when.getDate() !== best.d.d) return null;
  // 离这封信一年以上的,多半认错了(条款里的有效期、页脚的版权年)
  if (sentOk && Math.abs(when.getTime() - sentOk.getTime()) > 366 * 864e5) return null;

  const from = Math.max(0, Math.min(best.d.index, best.t.index) - 12);
  const to = Math.min(hay.length, Math.max(best.d.index, best.t.index) + 28);
  const snippet = hay.slice(from, to).replace(/\s+/g, ' ').trim();

  return {
    at: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`,
    snippet,
  };
}

/* ── 查重:日程里已经有了就别再建议一遍 ────────────────────────────────
   2026-07-30 真机实锤(用户:「如果日程已经有了,就不重复。要自动检查」):
   一封 "THIS SATURDAY — Virtual Orientation" 的邮件被确认加成了提醒,
   而同一场活动 "Sea Cadets Virtual Orientation" 本来就在 Google 日历里 ——
   同一件事在同一页出现两遍,而且名字还不一样,看着像两个约。               */

/** 日程里已有的一条(日历项 / 我设的提醒都归一成这个形状)。 */
export interface ScheduledSlot {
  /** 绝对时刻(毫秒) */
  ms: number;
  title: string;
}

const normTitle = (t: string) => (t || '').replace(/\s+/g, '').toLowerCase();

/**
 * 这件事日程里是不是已经有了。
 *
 * 判据只有两条,都**保守且可解释**:
 *   ① 标题去空格、忽略大小写后**完全相同**;
 *   ② 时刻相差在 toleranceMin 以内。
 *
 * ② 是主力:一个人同一天的同一个钟点,不会有两件不同的约。
 * 刻意**不做**标题的模糊/语义相似 —— "THIS SATURDAY — Virtual Orientation" 和
 * "Sea Cadets Virtual Orientation" 字面上共同的只有 "Virtual Orientation",
 * 靠公共子串去认,既会把两场真的不同的会判成同一件,也认不出改了名的同一件事。
 * 时间才是这件事的身份。
 */
export function alreadyScheduled(
  atMs: number,
  title: string,
  existing: readonly ScheduledSlot[],
  toleranceMin = 60,
): boolean {
  if (!Number.isFinite(atMs)) return false;
  const tol = toleranceMin * 60_000;
  const key = normTitle(title);
  for (const e of existing) {
    if (!Number.isFinite(e.ms)) continue;
    if (key && normTitle(e.title) === key) return true;
    if (Math.abs(e.ms - atMs) <= tol) return true;
  }
  return false;
}
