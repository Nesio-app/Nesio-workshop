/**
 * 每日日报 —— 横跨 Nesio 所有面的一份文字日报。
 *
 * 2026-07-30 用户定案:「我也想有 nesio 的每日日报文字版,但是要横跨 nesio 的所有面」。
 *
 * ── 为什么是纯函数,不走 AI ────────────────────────────────────────────
 * 用户问过「还用以前的简报线路、输出改文字是不是最简单」。不是:
 *   · 旧简报线路的输入就是 天气/日历/邮件/记忆 那几样,**取材面和这里一模一样**,
 *     它本身没有跨面能力 —— 真正的活在下面的取数与配额上,换条线路一分钱省不下来;
 *   · 它是云 AI:要钱、有延迟、挂付费门、离线不可用;
 *   · **「早上 8 点定稿」在纯函数下是白送的** —— 同样的输入必然同样的输出,
 *     把 now 钉在当天 08:00 就是定稿本身;AI 每次结果都不同,要定稿还得另存快照。
 * 所以日报本体确定性、零网络、零成本、可单测;AI 只在最外面叠一层可选的「今日一句」。
 *
 * ── 结构:抄用户邮箱里那份日报的骨架 ──────────────────────────────────
 * 那份的 DNA 是:先「Top of mind(要你动)」再「按时间走」,每条带时长估计和可点动作。
 * 这里照搬前两条。但**刻意不复述邮件内容** —— 用户已经收到一份从邮件总结的日报,
 * Nesio 再做一遍就是更差的重复品。Nesio 的价值在**邮件里看不见的那几面**:
 * 牛奶后天过期、这个月哪类花超了、今天该练哪个、书还剩多少页。
 *
 * ── 红线:配额与正向准入 ──────────────────────────────────────────────
 * 14 个面 × 3 条 = 42 条,没人会读第二天。所以每面封顶、全报封顶,
 * 并且**每一面只准送「今天真要你动 / 今天真的变了」的东西** ——
 * 「本周没有异常」这类不进日报。这是这个仓库反复踩的坑(凡是没被拦住的都算数)。
 */

export interface DailyReportWeather {
  temperatureC?: number;
  condition?: string;
  forecastNote?: string;
  placeLabel?: string;
  tempMaxC?: number;
  tempMinC?: number;
  precipProb?: number;
}

export interface DailyReportEvent {
  title: string;
  start: string;        // ISO;带偏移最佳(与日历同源)
  end?: string;
  location?: string;
  calendarName?: string;
}

/** 到点的提醒(用户自己设的家务 / 账单 due)。来自 schedule-reminders。 */
export interface DailyReportReminder {
  title: string;
  /** 墙上时钟 `YYYY-MM-DDTHH:mm` */
  at: string;
  kind?: 'chore' | 'bill' | 'other';
}

/** 各域确定性引擎的判定(gatherDomainInsights 的形状,原样带过来)。 */
export interface DailyReportDomainInsight {
  domain: string;
  severity: 'flag' | 'attention';
  title: string;
  detail: string;
}

/**
 * 「往前看」的一条 —— 未来两周里**确定会发生**的事。
 *
 * 红线:这里**只放已知日期,不放任何推算**(2026-07-30 定,用户拍板窗口 14 天)。
 * 「照这个花法这个月餐饮会超」那类推测第一版一律不做:一旦推不准,它会连累
 * 前面那些确定的部分 —— 用户开始怀疑整份日报,连「牛奶后天过期」都不信了。
 * 将来真要加推测,必须**逐条标明口径和依据**,并且和这一段分开放。
 */
export interface DailyReportAhead {
  /** YYYY-MM-DD */
  date: string;
  title: string;
  kind: 'event' | 'reminder' | 'expiry';
}

/** 在途订单今天有动静的那几条(来自邮件本地抽取的 orderStatus / eta)。 */
export interface DailyReportOrder {
  title: string;
  /** 已发货 / 已送达 / 已退款 之类,已经翻好的中文 */
  status: string;
  eta?: string;
}

export interface DailyReportInput {
  displayName?: string;
  /** 报告的「今天」。**定稿口径**:落库时钉在当天 08:00,见 daily-report-persist。 */
  now?: Date;
  weather?: DailyReportWeather;
  location?: string;             // 设备反地理编码城市,如 "Cary, NC"
  events?: DailyReportEvent[];
  emailHighlights?: string[];
  memoryNotes?: string[];
  locale?: 'zh' | 'en';

  /* ── 2026-07-30 跨面扩展 ────────────────────────────────────────── */
  /** 今天到点的提醒(家务 / 账单 due) */
  reminders?: DailyReportReminder[];
  /** 七个域的判定:健康/财务/地点/物品/心情/关系/阅读 */
  domainInsights?: DailyReportDomainInsight[];
  /** 今天该练哪个(训练计划已排好的那一节) */
  fitnessSession?: string;
  /** 今天穿什么(衣橱按天气 + 今天正式度给的一句) */
  outfitNote?: string;
  /** 今天计划的菜 */
  meals?: string[];
  /** 在途订单今天的动静 */
  orders?: DailyReportOrder[];
  /**
   * **昨天那份日报里的判定集**(原始,未格式化)。有它才能出「新进展」——
   * 差分而不是快照。没有(第一天 / 老节点)就退回出快照,标题也跟着换,不装作有进展。
   */
  yesterdayInsights?: DailyReportDomainInsight[];
  /** 未来两周里确定会发生的事(已知日期,无推算) */
  ahead?: DailyReportAhead[];
}

/**
 * 段落 id。加新段时同步 components/portal/today/DailyReportCard.tsx 的 SECTION_ICON。
 */
export type DailyReportSectionId =
  | 'action'    // 要你动:到点的提醒 / flag 级判定 / 到货
  | 'calendar'  // 按时间走
  | 'today'     // 今天的底色:天气 / 穿 / 吃 / 练
  | 'domain'    // 新进展(有昨天可比时是差分)/ 这几面(第一天时是快照)
  | 'ahead'     // 往前看:未来两周确定会发生的事(默认折叠)
  | 'email'     // 邮件:只给一行汇总 + 出口,不复述内容
  | 'memory';   // 念念还记得

export interface DailyReportSection {
  id: DailyReportSectionId;
  title: string;
  lines: string[];
}

export interface DailyReport {
  date: string;                  // YYYY-MM-DD
  title: string;                 // 「每日日报 · X月X日 周X」(存记忆 name / 历史列表标题)
  greeting: string;
  headline: string;              // 一句话概览
  sections: DailyReportSection[];
  markdown: string;              // 存记忆 / 展示 / 机器人直接念
  empty: boolean;                // 无任何实质内容(自动预生成可据此跳过)
}

/* ── 配额:不定这个,日报必然变成流水账 ────────────────────────────── */
/** 「要你动」最多几条 —— 超过 5 件事就不叫 top of mind 了。 */
const MAX_ACTION = 5;
/**
 * 「要你动」里**每一类来源各自的位置**。三条加起来正好 MAX_ACTION。
 *
 * 为什么不是先到先得:先到先得的话,判定一多就把订单挤没了 —— 那条永远轮不到,
 * 而用户根本不知道它被挤掉了(契约实锤过:4 条 flag + 1 条提醒直接吃满 5 个位置)。
 * 这和「每域封顶」是同一族问题:一类来源饿死另一类。各留位置,谁也不会消失。
 *
 * 提醒给得最多 —— 那是用户**亲手写下的时间**,优先级天然高于系统算出来的判定。
 */
const ACTION_QUOTA = { reminders: 3, flags: 2, orders: 1 } as const;
/** 「变了什么」最多几条。 */
const MAX_DOMAIN = 4;
/** 同一个域最多占几条 —— 防止健康一家把整段刷满。 */
const MAX_PER_DOMAIN = 2;
/** 今天的日程最多列几条,余下折成「还有 N 件」。 */
const MAX_EVENTS = 6;
/**
 * 「新进展」里**渐变**最多占几条。
 *
 * 有些指标每天必然动一格(「和妈妈上次通话 11 天前 → 12 天前」「还剩 3 天到期 → 2 天」)。
 * 那是时间在走,不是进展。不给它单独封顶的话,这一段会天天被这类句子占满,
 * 而真正的事件(新冒出来的 / 不再提示的)被挤到看不见 —— 那是「一类饿死另一类」的老病。
 * 所以排序是 **新出现 → 不再提示 → 渐变**,渐变垫底且封顶。
 * (不去猜「哪个指标算自然流逝」—— 那要语义判断,正是这个仓库反复踩的坑;
 *  改用配额,并且把两个数值都摆出来让用户自己看。)
 */
const MAX_CHANGED = 2;
/** 「往前看」最多列几条 —— 两周的东西全倒出来能有二三十条。 */
const MAX_AHEAD = 6;
/** 「往前看」的窗口:两周(2026-07-30 用户拍板)。 */
export const AHEAD_DAYS = 14;

const pad = (n: number) => String(n).padStart(2, '0');
function dateKey(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** 记忆幂等键:同一天重生成原地更新,不堆重复节点。 */
export function dailyReportExternalId(d: Date): string { return `daily-report-${dateKey(d)}`; }

function tt(locale: 'zh' | 'en', zh: string, en: string): string { return locale === 'en' ? en : zh; }

function greetingFor(hour: number, locale: 'zh' | 'en'): string {
  if (hour < 5) return tt(locale, '凌晨好', 'Good morning');
  if (hour < 12) return tt(locale, '早上好', 'Good morning');
  if (hour < 18) return tt(locale, '下午好', 'Good afternoon');
  return tt(locale, '晚上好', 'Good evening');
}

function weatherText(w: DailyReportWeather | undefined, location: string | undefined, locale: 'zh' | 'en'): string | null {
  if (!w) return null;
  const place = location || w.placeLabel || '';
  const temp = typeof w.tempMinC === 'number' && typeof w.tempMaxC === 'number'
    ? `${w.tempMinC}~${w.tempMaxC}°C`
    : typeof w.temperatureC === 'number' ? `${w.temperatureC}°C` : '';
  const precip = typeof w.precipProb === 'number' && w.precipProb >= 50 && !w.forecastNote
    ? tt(locale, `,降水概率 ${w.precipProb}%`, `, ${w.precipProb}% chance of rain`)
    : '';
  const cond = w.condition || '';
  const note = w.forecastNote ? (locale === 'en' ? `, ${w.forecastNote}` : `,${w.forecastNote}`) : precip;
  const body = [temp, cond].filter(Boolean).join(locale === 'en' ? ', ' : ',');
  return `${body}${note}${place ? (locale === 'en' ? ` (${place})` : `(${place})`)  : ''}`.trim();
}

function fmtTime(iso: string, locale: 'zh' | 'en'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(locale === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function fmtEvent(e: DailyReportEvent, locale: 'zh' | 'en'): string {
  const t = fmtTime(e.start, locale);
  const loc = e.location ? (locale === 'en' ? ` (${e.location})` : `(${e.location})`) : '';
  return `${t ? t + ' ' : ''}${e.title}${loc}`;
}

/** 墙上时钟 `YYYY-MM-DDTHH:mm` 里的钟点部分。认不出就返回空串(不猜)。 */
function wallClockTime(at: string): string {
  const m = /T(\d{2}):(\d{2})$/.exec(at || '');
  return m ? `${m[1]}:${m[2]}` : '';
}

/** 这条提醒是不是今天的事(含今天已过点的 —— 那正是最该提的)。 */
function isReminderToday(r: DailyReportReminder, todayKey: string): boolean {
  return typeof r.at === 'string' && r.at.slice(0, 10) === todayKey;
}

const DOMAIN_LABEL: Record<string, [string, string]> = {
  health: ['健康', 'Health'],
  finance: ['财务', 'Money'],
  location: ['地点', 'Places'],
  inventory: ['物品', 'Things'],
  mood: ['心情', 'Mood'],
  relationship: ['关系', 'People'],
  reading: ['阅读', 'Reading'],
};

/**
 * 按域配额挑判定 —— **flag 和 attention 一次挑完,共用同一份每域预算**。
 *
 * 这里必须一次挑完,不能分两次调:分开调的话两段各带各的 perDomain,
 * 健康就能在「先处理这几件」占 2 条、又在「这几面有变化」占 2 条 —— 合计 4 条,
 * 一个域吃掉半份日报,而 MAX_PER_DOMAIN 表面上还「生效」着。(契约实锤过。)
 *
 * flag 先挑(更急);每域全报封顶 MAX_PER_DOMAIN;两段各自再封顶。
 * 传进来的顺序即优先级(gatherDomainInsights 已按 flag 在前排好)。
 */
function splitInsights(
  all: readonly DailyReportDomainInsight[],
  maxFlag: number,
  maxAttention: number,
): { flags: DailyReportDomainInsight[]; attentions: DailyReportDomainInsight[] } {
  const perDomain = new Map<string, number>();
  const take = (severity: 'flag' | 'attention', limit: number) => {
    const out: DailyReportDomainInsight[] = [];
    for (const it of all) {
      if (it.severity !== severity) continue;
      const n = perDomain.get(it.domain) || 0;
      if (n >= MAX_PER_DOMAIN) continue;   // 全报共用这一份预算
      perDomain.set(it.domain, n + 1);
      out.push(it);
      if (out.length >= limit) break;
    }
    return out;
  };
  const flags = take('flag', maxFlag);          // 先给急的
  const attentions = take('attention', maxAttention);
  return { flags, attentions };
}

function insightLine(it: DailyReportDomainInsight, locale: 'zh' | 'en'): string {
  const label = DOMAIN_LABEL[it.domain];
  const tag = label ? tt(locale, label[0], label[1]) : it.domain;
  return `${tag} · ${it.title}${it.detail ? ` —— ${it.detail}` : ''}`;
}

/**
 * 判定的**稳定 key** —— 同一件事在不同日子必须算同一个 key。
 *
 * title 里带着数值(「空腹血糖 7 天均值 6.4」)。原样比的话,昨天 6.7、今天 6.4
 * 会被判成「昨天那条没了 + 今天新出一条」—— 那是最典型的假差分,而且两条都错。
 * 把数字抹成 # 再比。同一个 domain 内抹完撞车的概率很低,而且撞车的后果是
 * 「本该报变化的报成了没变化」—— 安全方向(少说一句,不是说错一句)。
 */
function insightKey(it: DailyReportDomainInsight): string {
  return `${it.domain}|${it.title.replace(/[\d.]+/g, '#')}`;
}

interface InsightDiff {
  fresh: DailyReportDomainInsight[];                                      // 今天新出现的
  changed: Array<{ now: DailyReportDomainInsight; before: string }>;      // 还在,但数值变了
  gone: DailyReportDomainInsight[];                                       // 昨天有、今天不再提示
}

/**
 * 和昨天那份日报比,算出**进展**。
 *
 * 为什么要差分:快照说的是「血糖 6.4」,那不是进展;「从 6.7 降到 6.4」才是。
 * 天天推同一句快照,读第三天就会被当成噪音自动跳过 —— 而它本来是这份日报里
 * 最有价值的一段。
 */
export function diffInsights(
  today: readonly DailyReportDomainInsight[],
  yesterday: readonly DailyReportDomainInsight[],
): InsightDiff {
  const before = new Map(yesterday.map((it) => [insightKey(it), it]));
  const todayKeys = new Set(today.map(insightKey));
  const fresh: DailyReportDomainInsight[] = [];
  const changed: InsightDiff['changed'] = [];
  for (const it of today) {
    const was = before.get(insightKey(it));
    if (!was) { fresh.push(it); continue; }
    if (was.title !== it.title) changed.push({ now: it, before: was.title });
  }
  const gone = yesterday.filter((it) => !todayKeys.has(insightKey(it)));
  return { fresh, changed, gone };
}

/** 跨面前瞻日报生成(纯函数)。 */
export function buildDailyReport(input: DailyReportInput): DailyReport {
  const locale: 'zh' | 'en' = input.locale === 'en' ? 'en' : 'zh';
  const now = input.now ?? new Date();
  const todayKey = dateKey(now);
  const dayEnd = new Date(now).setHours(23, 59, 59, 999);
  const dayStart = new Date(now).setHours(0, 0, 0, 0);

  const greeting = `${greetingFor(now.getHours(), locale)}${input.displayName ? (locale === 'en' ? `, ${input.displayName}` : `,${input.displayName}`) : ''}`;

  /* ── 日程 ────────────────────────────────────────────────────────
     窗口是**当天整天**,不是「从现在起」。定稿口径钉在 08:00,而人可能中午才打开;
     用「从现在起」的话,早上那场会就从这份日报里消失了 —— 可它明明是这份日报的一部分。 */
  const events = Array.isArray(input.events) ? input.events : [];
  const todayEvents = events
    .filter((e) => {
      const t = new Date(e.start).getTime();
      return Number.isFinite(t) && t >= dayStart && t <= dayEnd;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const upcoming = events
    .filter((e) => { const t = new Date(e.start).getTime(); return Number.isFinite(t) && t > dayEnd; })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, 3);

  const wText = weatherText(input.weather, input.location, locale);
  const emails = (input.emailHighlights || []).filter(Boolean);
  const notes = (input.memoryNotes || []).filter(Boolean).slice(0, 3);
  const insights = (input.domainInsights || []).filter((i) => i && i.title);
  const todayReminders = (input.reminders || []).filter((r) => r && r.title && isReminderToday(r, todayKey));
  const orders = (input.orders || []).filter((o) => o && o.title && o.status);
  const { flags, attentions } = splitInsights(insights, MAX_ACTION, MAX_DOMAIN);

  const sections: DailyReportSection[] = [];

  /* ── ① 要你动(Top of mind)──────────────────────────────────────
     准入是正向的:到点的提醒、flag 级判定、有动静的订单。
     「一切正常」不进这一段 —— 没有要你动的事,这一段整段不出现。 */
  const reminderLines = todayReminders.slice(0, ACTION_QUOTA.reminders).map((r) => {
    const t = wallClockTime(r.at);
    const kind = r.kind === 'bill' ? tt(locale, '账单', 'Bill') : r.kind === 'chore' ? tt(locale, '家务', 'Chore') : '';
    return `${t ? t + ' ' : ''}${r.title}${kind ? ` · ${kind}` : ''}`;
  });
  const flagLines = flags.slice(0, ACTION_QUOTA.flags).map((it) => insightLine(it, locale));
  const orderLines = orders.slice(0, ACTION_QUOTA.orders).map(
    (o) => `${o.title} · ${o.status}${o.eta ? tt(locale, ` · 预计 ${o.eta}`, ` · ETA ${o.eta}`) : ''}`,
  );
  // 各类先按自己的配额取,再合并 —— 不是先到先得,免得一类把另一类饿死。
  const actionLines = [...reminderLines, ...flagLines, ...orderLines].slice(0, MAX_ACTION);
  if (actionLines.length) {
    sections.push({ id: 'action', title: tt(locale, '先处理这几件', 'Top of mind'), lines: actionLines });
  }

  /* ── ② 按时间走 ─────────────────────────────────────────────── */
  const shownEvents = todayEvents.slice(0, MAX_EVENTS);
  const calLines = shownEvents.length
    ? [
        ...shownEvents.map((e) => fmtEvent(e, locale)),
        ...(todayEvents.length > MAX_EVENTS
          ? [tt(locale, `还有 ${todayEvents.length - MAX_EVENTS} 件,在日程里`, `${todayEvents.length - MAX_EVENTS} more — see Schedule`)]
          : []),
      ]
    : upcoming.length
      ? [tt(locale, '今天日历上没有安排。', 'Nothing on today’s calendar.'),
         `${tt(locale, '下一个:', 'Next: ')}${fmtEvent(upcoming[0], locale)}`]
      : [tt(locale, '今天没有日历安排,可以专注深度工作。', 'No calendar events today — a good day for deep work.')];
  sections.push({ id: 'calendar', title: tt(locale, '今日日程', 'Today’s schedule'), lines: calLines });

  /* ── ③ 今天的底色:天气 / 穿 / 吃 / 练 ──────────────────────────
     这一段是 Nesio 独有的那部分 —— 邮箱里那份日报永远给不出来。 */
  const todayLines: string[] = [];
  if (wText) todayLines.push(wText);
  if (input.outfitNote) todayLines.push(tt(locale, `穿:${input.outfitNote}`, `Wear: ${input.outfitNote}`));
  const meals = (input.meals || []).filter(Boolean).slice(0, 3);
  if (meals.length) todayLines.push(tt(locale, `吃:${meals.join('、')}`, `Eat: ${meals.join(', ')}`));
  if (input.fitnessSession) todayLines.push(tt(locale, `练:${input.fitnessSession}`, `Train: ${input.fitnessSession}`));
  if (todayLines.length) {
    sections.push({ id: 'today', title: tt(locale, '今天', 'Today'), lines: todayLines });
  }

  /* ── ④ 新进展(有昨天可比)/ 这几面(第一天)──────────────────────
     快照说的是「血糖 6.4」,那不是进展;「从 6.7 降到 6.4」才是。天天推同一句快照,
     读第三天就会被当成噪音自动跳过 —— 而这本该是整份日报里最有价值的一段。
     没有昨天的冻结件时退回快照,**标题也跟着换** —— 不装作有进展。 */
  const yesterday = input.yesterdayInsights;
  let domainLines: string[];
  let domainTitle: string;
  if (yesterday && yesterday.length) {
    const d = diffInsights(insights, yesterday);
    // 真事件优先:新出现 → 不再提示;渐变垫底且封顶(见 MAX_CHANGED)。
    const lines: string[] = [];
    for (const it of d.fresh) lines.push(`${insightLine(it, locale)}${tt(locale, ' · 新', ' · new')}`);
    for (const it of d.gone) {
      const label = DOMAIN_LABEL[it.domain];
      const tag = label ? tt(locale, label[0], label[1]) : it.domain;
      lines.push(`${tag} · ${it.title}${tt(locale, ' · 不再提示了', ' · cleared')}`);
    }
    for (const c of d.changed.slice(0, MAX_CHANGED)) {
      lines.push(`${insightLine(c.now, locale)}${tt(locale, ` · 昨天是「${c.before}」`, ` · was “${c.before}”`)}`);
    }
    domainLines = lines.slice(0, MAX_DOMAIN);
    domainTitle = tt(locale, '新进展', 'What moved');
  } else {
    domainLines = attentions.map((it) => insightLine(it, locale));
    domainTitle = tt(locale, '这几面', 'Across your life');
  }
  if (domainLines.length) {
    sections.push({ id: 'domain', title: domainTitle, lines: domainLines });
  }

  /* ── ⑤ 往前看:未来两周确定会发生的事 ────────────────────────────
     **只有已知日期,没有任何推算**(见 DailyReportAhead 的红线)。
     按日期由近到远;超出配额的如实说「还有 N 件」,不静默截断。 */
  /* 窗口在**这里**也过一遍。采集端(daily-report-sources)已经过滤过,但那是好意,
     不是保证 —— 调用方多传一条超窗的进来,纯函数照单全收的话,「两周」这个标题就在说谎,
     而且契约在纯函数这一侧根本测不到。自己的输出自己负责。 */
  const aheadFrom = todayKey;
  const aheadUntilDate = new Date(now); aheadUntilDate.setDate(aheadUntilDate.getDate() + AHEAD_DAYS);
  const aheadUntil = dateKey(aheadUntilDate);
  const aheadAll = (input.ahead || [])
    .filter((a) => a && a.title && /^\d{4}-\d{2}-\d{2}$/.test(a.date))
    .filter((a) => a.date > aheadFrom && a.date <= aheadUntil)   // 今天不算(今天有自己的段)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (aheadAll.length) {
    const fmtDay = (ymd: string) => {
      const d = new Date(`${ymd}T12:00:00`);
      if (Number.isNaN(d.getTime())) return ymd;
      return locale === 'en'
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : `${d.getMonth() + 1}月${d.getDate()}日`;
    };
    const kindTag = (k: DailyReportAhead['kind']) => (
      k === 'reminder' ? tt(locale, '提醒', 'Reminder')
        : k === 'expiry' ? tt(locale, '到期', 'Expires')
          : tt(locale, '日程', 'Event'));
    const shown = aheadAll.slice(0, MAX_AHEAD);
    const lines = shown.map((a) => `${fmtDay(a.date)} ${a.title} · ${kindTag(a.kind)}`);
    if (aheadAll.length > MAX_AHEAD) {
      lines.push(tt(locale, `还有 ${aheadAll.length - MAX_AHEAD} 件`, `${aheadAll.length - MAX_AHEAD} more`));
    }
    sections.push({ id: 'ahead', title: tt(locale, '往前看 · 两周', 'Two weeks ahead'), lines });
  }

  /* ── ⑤ 邮件:只给一行汇总 + 出口,**不复述内容** ────────────────
     用户已经收到一份从邮件总结的日报了。在这里再抄一遍,就是花力气做一个更差的
     重复品,还会把上面那几段真正只有 Nesio 知道的东西挤下去。 */
  if (emails.length) {
    sections.push({
      id: 'email',
      title: tt(locale, '邮件', 'Mail'),
      lines: [tt(locale, `有 ${emails.length} 封值得看一眼 —— 在日程页的「收件」里`,
                       `${emails.length} worth a look — under Inbox in Schedule`)],
    });
  }

  /* ── ⑥ 念念还记得 ──────────────────────────────────────────── */
  if (notes.length) sections.push({ id: 'memory', title: tt(locale, '念念还记得', 'From your memory'), lines: notes });

  /* ── 一句话概览 ─────────────────────────────────────────────── */
  const headlineParts: string[] = [];
  if (actionLines.length) {
    headlineParts.push(tt(locale, `${actionLines.length} 件要你动`, `${actionLines.length} to handle`));
  }
  headlineParts.push(todayEvents.length
    ? tt(locale, `今天 ${todayEvents.length} 个安排`, `${todayEvents.length} event${todayEvents.length > 1 ? 's' : ''} today`)
    : tt(locale, '今天日程空', 'Clear schedule today'));
  if (wText) headlineParts.push(wText.split(locale === 'en' ? ',' : ',')[0]);
  const headline = headlineParts.join(' · ');

  /* ── markdown(存记忆 / 展示 / 机器人直接念)──────────────────── */
  const dateLabel = now.toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const title = `${tt(locale, '每日日报', 'Daily report')} · ${dateLabel}`;
  const md: string[] = [`# ${title}`, '', `_${headline}_`, ''];
  for (const s of sections) {
    md.push(`## ${s.title}`);
    for (const line of s.lines) md.push(`- ${line}`);
    md.push('');
  }
  const markdown = md.join('\n').trim();

  /**
   * 空 = 这一天**什么实质内容都没有**。
   * 不能拿 sections.length 判:日程那一段永远会渲染(哪怕只是「今天没有安排」),
   * 那样就永远不空,自动预生成会天天往记忆里存一条只写着「今天没安排」的空日报。
   */
  const empty = !wText
    && todayEvents.length === 0 && upcoming.length === 0
    && actionLines.length === 0 && domainLines.length === 0
    && todayLines.length === 0 && aheadAll.length === 0
    && emails.length === 0 && notes.length === 0;

  return { date: todayKey, title, greeting, headline, sections, markdown, empty };
}
