/**
 * when-parse —— 从一句话里认出「什么时候」(2026-07-31)。
 *
 * 起因:用户在首页打「设一个明天下午 3 点医生提醒」,系统认出了「提醒」这个意图、
 * 在屏幕上显示了「设置提醒」四个字,**然后什么也没做** —— 那句话落成一条普通记录,
 * 明天下午三点不会有任何事发生。intent-router 认得出意图,但没有人把「明天下午 3 点」
 * 变成一个时刻。这个文件补的就是那一步。
 *
 * ── 三条自律 ────────────────────────────────────────────────────────────
 * ① **认不出就返回 null**,绝不硬凑一个时间。宁可让用户自己去日程页加,
 *    也不要给他一个「设在了某个他没说过的时刻」的提醒 —— 后者他不会发现,
 *    直到错过了那件事。
 * ② **猜了什么必须说出来**。返回值里带 `hasExplicitTime`:时间是默认填的(只说了
 *    「明天」没说几点),界面有义务标明「默认早上 9:00」,而不是假装用户定过。
 * ③ 输出**墙上时钟**(YYYY-MM-DDTHH:mm,本地,不带时区),与 schedule-reminders 同一种格式。
 *    「明天下午三点」是一件关于钟面的事,折成 UTC 再折回来,换时区或碰上夏令时会漂一小时。
 *
 * 纯函数,`now` 由调用方注入 —— 「明天」是相对哪一天,必须能在测试里钉死。
 */

export interface WhenGuess {
  /** 墙上时钟 `YYYY-MM-DDTHH:mm`(本地)。 */
  at: string;
  /**
   * 用户是不是**明确说了几点**。false = 只说了日期,时间是默认填的 —— 界面必须标出来。
   * 这一位就是「② 猜了什么必须说出来」的载体,别把它当内部细节吞掉。
   */
  hasExplicitTime: boolean;
  /** 命中的那段原文(「明天下午 3 点」)。界面可以把它标出来,让用户看见系统读懂了什么。 */
  matched: string;
  /** 去掉时间词之后剩下的正文,当提醒标题。剩空了就退回整句。 */
  title: string;
  /**
   * 重复方式(2026-07-31 从「例行提醒」并过来的能力)。**没说就是 undefined**,
   * 不默认成「每天」—— 把一次性的事变成天天响,是最快让人关掉整个功能的做法。
   */
  repeat?: RepeatGuess;
}

/** 三者互斥,weekdays 优先。「每周一三五」不是等间隔,用 everyDays 表达不了。 */
export interface RepeatGuess {
  everyDays?: number;
  everyMonths?: number;
  weekdays?: number[];
}

/** 只说了日期没说时间时填这个钟点。填了就必须在界面上说 —— 见 hasExplicitTime。 */
export const DEFAULT_HOUR = 9;

const CN_NUM: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 「十」「十一」「二十三」这类。认不出返回 NaN —— 不兜底成 0。 */
function cnNumber(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  if (!s) return NaN;
  if (s === '十') return 10;
  if (s.startsWith('十')) return 10 + (CN_NUM[s[1]] ?? NaN);
  if (s.length === 1) return CN_NUM[s] ?? NaN;
  if (s[1] === '十') return (CN_NUM[s[0]] ?? NaN) * 10 + (s.length > 2 ? (CN_NUM[s[2]] ?? 0) : 0);
  return NaN;
}

const pad = (n: number) => String(n).padStart(2, '0');
const wallClock = (d: Date, h: number, m: number) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}`;

const addDays = (d: Date, n: number) => {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
};

/* ── 日期 ────────────────────────────────────────────────────────────────── */

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

interface DateHit { date: Date; matched: string }

function parseDate(text: string, now: Date): DateHit | null {
  // 明确的年月日 / 月日:8/1、8-1、8月1日
  const md = text.match(/(\d{1,2})\s*[/\-月]\s*(\d{1,2})\s*日?/);
  if (md) {
    const mo = Number(md[1]);
    const day = Number(md[2]);
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
      // 没写年份 = 说的是**下一个**这个日子。已经过去的月日理解成明年,
      // 否则「1/5」在十二月会被设到十一个月前,提醒当场就是过期的。
      let year = now.getFullYear();
      const cand = new Date(year, mo - 1, day);
      if (cand < new Date(now.getFullYear(), now.getMonth(), now.getDate())) year += 1;
      return { date: new Date(year, mo - 1, day), matched: md[0] };
    }
  }

  // 光一个「15 号」——「每月 15 号交房租」里没有月份,但它明确说的是某一天。
  // 当月的那天过了就落到下个月,否则会造出一条一建就过期的提醒。
  const dom = text.match(/(?:^|[^0-9:：])(\d{1,2})\s*[号號]/);
  if (dom) {
    const day = Number(dom[1]);
    if (day >= 1 && day <= 31) {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let cand = new Date(now.getFullYear(), now.getMonth(), day);
      if (cand < today) cand = new Date(now.getFullYear(), now.getMonth() + 1, day);
      return { date: cand, matched: dom[0].replace(/^[^0-9]/, '') };
    }
  }

  // 相对日
  for (const [re, delta] of [
    [/大后天/, 3], [/后天/, 2], [/明天|明日|tomorrow/i, 1], [/今天|今日|今晚|今早|today|tonight/i, 0],
  ] as Array<[RegExp, number]>) {
    const m = text.match(re);
    if (m) return { date: addDays(now, delta), matched: m[0] };
  }

  // 周几:下周三 / 这周三 / 周三 / 礼拜三 / 星期三
  const wd = text.match(/(下下|下|这|本)?\s*(?:周|週|星期|礼拜)\s*([一二三四五六日天])/);
  if (wd) {
    const target = wd[2] === '天' ? 0 : WEEKDAY_CN.indexOf(wd[2]);
    if (target >= 0) {
      const cur = now.getDay();
      let delta = (target - cur + 7) % 7;
      // 「周三」当天说「周三」指的是今天;但「下周三」永远是下一周那个。
      if (wd[1] === '下') delta += 7;
      else if (wd[1] === '下下') delta += 14;
      return { date: addDays(now, delta), matched: wd[0] };
    }
  }
  return null;
}

/* ── 时间 ────────────────────────────────────────────────────────────────── */

interface TimeHit { hour: number; minute: number; matched: string }

/**
 * 整句里的时段词。为什么需要它:「今晚 8 点」的「晚」被**日期**那一步吃掉了
 * (今晚 = 今天),留给时间解析的只剩「8 点」—— 于是解析成早上八点,
 * 用户拿到一条一创建就已经过期的提醒。时段词在句子哪个位置都是同一个意思,
 * 所以紧邻前缀没有时,回退到整句找一次。
 */
function sentenceMeridiem(text: string): string {
  const m = text.match(/(上午|早上|早晨|今早|明早|中午|下午|傍晚|晚上|今晚|明晚|夜里|am|pm)/i);
  return m ? m[1] : '';
}

function parseTime(text: string): TimeHit | null {
  const fallback = sentenceMeridiem(text);
  // 24 小时制或带冒号:15:00、3:30、下午 3:30
  const colon = text.match(/(上午|早上|早晨|中午|下午|傍晚|晚上|夜里|am|pm)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/i);
  if (colon) {
    let h = Number(colon[2]);
    const m = Number(colon[3]);
    if (h <= 23 && m <= 59) {
      h = applyMeridiem(h, colon[1] || fallback);
      return { hour: h, minute: m, matched: colon[0].trim() };
    }
  }

  // 「3点」「三点半」「下午三点一刻」「8pm」
  const cn = text.match(/(上午|早上|早晨|中午|下午|傍晚|晚上|夜里)?\s*([0-9]{1,2}|[零〇一两二三四五六七八九十]{1,3})\s*(?:点|時|时|:00)\s*(半|一刻|三刻|[0-9]{1,2}|[零〇一两二三四五六七八九十]{1,3})?\s*分?/);
  if (cn) {
    const h = cnNumber(cn[2]);
    if (Number.isFinite(h) && h >= 0 && h <= 23) {
      let m = 0;
      if (cn[3] === '半') m = 30;
      else if (cn[3] === '一刻') m = 15;
      else if (cn[3] === '三刻') m = 45;
      else if (cn[3]) { const v = cnNumber(cn[3]); if (Number.isFinite(v) && v <= 59) m = v; }
      return { hour: applyMeridiem(h, cn[1] || fallback), minute: m, matched: cn[0].trim() };
    }
  }

  const en = text.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (en) {
    const h = Number(en[1]);
    if (h >= 1 && h <= 12) return { hour: applyMeridiem(h, en[2]), minute: 0, matched: en[0] };
  }
  return null;
}

/**
 * 上午/下午的换算。
 *
 * 没有前缀时**不动**这个数字 —— 「15 点」就是 15 点,「3 点」就是 3 点。
 * 刻意不做「3 点多半是下午吧」的推断:猜错 12 小时,人是在半夜被叫醒或者错过整件事,
 * 而他压根不知道系统替他改过。界面会把解析出来的时刻**原样显示**,
 * 觉得不对当场就能改 —— 这比替他猜可靠得多。
 */
function applyMeridiem(hour: number, prefix?: string): number {
  const p = (prefix || '').toLowerCase();
  if (!p) return hour;
  // 用单字「晚」而不是「晚上」—— 「今晚 8 点」「明晚 8 点」里没有「晚上」两个字,
  // 写全词的话这两句最常见的表达会被解析成早上八点(实测栽过)。
  if (/下午|晚|夜里|pm/.test(p)) return hour < 12 ? hour + 12 : hour;
  if (/中午/.test(p)) return hour === 12 ? 12 : (hour < 12 ? hour + 12 : hour);
  // 上午/早上/早晨/am:12 点在这里是 0 点(「上午 12 点」现实里说的是中午,但极少见,按字面 12 处理)
  if (/am/.test(p) && hour === 12) return 0;
  return hour;
}

/* ── 频率 ────────────────────────────────────────────────────────────────── */

interface RepeatHit { repeat: RepeatGuess; matched: string }

/**
 * 「每天 / 每周三 / 每周一三五 / 工作日 / 每月 / 每两天」。
 *
 * 认不出就返回 null,**绝不默认成每天** —— 把一次性的事变成天天响,
 * 是最快让人把整个提醒功能关掉的做法。
 */
function parseRepeat(text: string): RepeatHit | null {
  // 工作日
  const wk = text.match(/(?:每个?)?工作日|weekdays?/i);
  if (wk) return { repeat: { weekdays: [1, 2, 3, 4, 5] }, matched: wk[0] };

  // 每周一三五 / 每周三 / 每星期二四
  const wd = text.match(/每\s*(?:周|週|星期|礼拜)\s*([一二三四五六日天]+)/);
  if (wd) {
    const days = [...wd[1]].map((c) => (c === '天' ? 0 : WEEKDAY_CN.indexOf(c))).filter((d) => d >= 0);
    if (days.length) return { repeat: { weekdays: [...new Set(days)].sort() }, matched: wd[0] };
  }
  // 「每周」不带星期几 —— 说不清是哪天,不猜(调用方拿到 undefined 就当一次性处理)。

  // 每两天 / 每 3 天 / 每天 / daily
  const dy = text.match(/每\s*([0-9]{1,2}|[两二三四五六七八九十]{1,2})?\s*(?:天|日)|daily/i);
  if (dy) {
    const n = dy[1] ? cnNumber(dy[1]) : 1;
    if (Number.isFinite(n) && n >= 1) return { repeat: { everyDays: n }, matched: dy[0] };
  }

  // 每两个月 / 每月 / monthly
  const mo = text.match(/每\s*([0-9]{1,2}|[两二三四五六七八九十]{1,2})?\s*个?\s*月|monthly/i);
  if (mo) {
    const n = mo[1] ? cnNumber(mo[1]) : 1;
    if (Number.isFinite(n) && n >= 1) return { repeat: { everyMonths: n }, matched: mo[0] };
  }
  return null;
}

/* ── 标题清洗 ────────────────────────────────────────────────────────────── */

/** 「设一个…提醒」这类外壳词。留着会让提醒标题变成「设一个医生提醒」。 */
const SHELL = /^(?:帮我|请|麻烦)?\s*(?:设(?:一个|个|下)?|加(?:一个|个)?|新建|建(?:一个|个)?|添加|提醒我?|记得|别忘了?|remind\s+me\s*(?:to|about)?|set\s+(?:a|an)?)\s*/i;
const TAIL = /\s*(?:的?提醒|这件事|一下|吧|哦|啊|remind(?:er)?)\s*$/i;

function cleanTitle(text: string, matches: string[]): string {
  let s = text;
  for (const m of matches) if (m) s = s.replace(m, ' ');
  s = s.replace(SHELL, '').replace(TAIL, '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

/* ── 入口 ────────────────────────────────────────────────────────────────── */

/**
 * 从一句话里认时间。认不出返回 **null** —— 调用方据此决定要不要提议「设成提醒」。
 *
 * 只说了时间没说日期(「3 点开会」)也算数:那指的是**今天的 3 点**,
 * 但如果今天这个钟点已经过去,它说的显然是明天 —— 否则用户会拿到一个
 * 一创建就已经过期的提醒。
 */
export function parseWhen(text: string, now: Date = new Date()): WhenGuess | null {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const rep = parseRepeat(raw);
  const d = parseDate(raw, now);
  const t = parseTime(raw);
  // 只说了「每天」而没有任何钟点线索,也算认出来了 —— 缺省钟点由 DEFAULT_HOUR 补,
  // 界面会照实说「你没说几点」。三样都没有才是真的认不出。
  if (!d && !t && !rep) return null;   // 一样都认不出 —— 不硬凑

  let date = d ? d.date : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hour = t ? t.hour : DEFAULT_HOUR;
  const minute = t ? t.minute : 0;

  // 认出来的时刻已经过去了 —— 这种提醒一创建就是过期的,不如不给。
  // 两种情况分开处理:只说钟点的推到明天(下面),明确说了哪天的如实返回
  // (「今晚 8 点」在夜里 10 点说,那确实是过去了 —— 界面会把时刻显示出来,用户自己看得见)。
  // 只说了钟点、没说哪天,而今天这个钟点已经过去 → 说的是明天。
  // 不这样处理的话,晚上十点打「8 点提醒我」会拿到一条今早八点的、一创建就过期的提醒。
  // 没说哪天(不管说没说钟点),而算出来的时刻已经过去 → 说的是明天。
  // 「每两天浇花」在夜里打进来也会落到今天早上九点 —— 一建就是过期的,得往后挪一天。
  if (!d) {
    const todayAt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
    if (todayAt.getTime() <= now.getTime()) date = addDays(now, 1);
  }

  // 「每周三 8 点」:at 落在下一个周三,repeat 记住每周三 —— 两者都要,不是二选一。
  // 只说了「每周三」没说日期时,parseDate 认不出(它只认「周三」不认「每周三」),
  // 这里用 weekdays 把首次落点补上,否则会落在今天、当天就过期。
  if (!d && rep?.repeat.weekdays?.length) {
    const set = new Set(rep.repeat.weekdays);
    for (let i = 0; i <= 7; i += 1) {
      const cand = addDays(now, i);
      const at = new Date(cand.getFullYear(), cand.getMonth(), cand.getDate(), hour, minute);
      if (set.has(cand.getDay()) && at.getTime() > now.getTime()) { date = cand; break; }
    }
  }

  const matchedParts = [rep?.matched, d?.matched, t?.matched].filter(Boolean) as string[];
  const title = cleanTitle(raw, matchedParts);

  return {
    at: wallClock(date, hour, minute),
    hasExplicitTime: !!t,
    matched: matchedParts.join(' '),
    title: title || raw,
    ...(rep ? { repeat: rep.repeat } : {}),
  };
}

/** 「8/1 15:00」这种给人看的写法。用于回执 —— 系统读懂了什么必须摆出来。 */
export function formatWhen(at: string): string {
  const m = at.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return at;
  return `${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`;
}
