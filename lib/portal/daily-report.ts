/**
 * 每日图文日报(前瞻型)——「今天要发生的」结构化图文版每日简报。
 *
 * 复用 daily-brief 的同一份输入(天气 / 当天日程 / 邮件亮点 / 记忆),但产出**结构化图文段落 +
 * markdown**:可存记忆(externalId 幂等)、可在洞察页做历史、可弹到 Today 未来预测卡。
 * 纯函数、无网络、无 AI —— 与月报/生活报告一致,可单测。AI「今日一句」润色是单独一层(不在此)。
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

export interface DailyReportInput {
  displayName?: string;
  now?: Date;                    // 报告的「今天」(默认当前)
  weather?: DailyReportWeather;
  location?: string;             // 设备反地理编码城市,如 "Cary, NC"
  events?: DailyReportEvent[];
  emailHighlights?: string[];
  memoryNotes?: string[];
  locale?: 'zh' | 'en';
}

export interface DailyReportSection {
  id: 'weather' | 'calendar' | 'email' | 'memory';
  icon: string;
  title: string;
  lines: string[];
}

export interface DailyReport {
  date: string;                  // YYYY-MM-DD
  greeting: string;
  headline: string;              // 一句话概览(几个安排 + 天气)
  sections: DailyReportSection[];
  markdown: string;              // 存记忆 / 展示
  empty: boolean;                // 无任何实质内容(自动预生成可据此跳过)
}

const pad = (n: number) => String(n).padStart(2, '0');
function dateKey(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** 记忆幂等键:同一天重生成原地更新,不堆重复节点。 */
export function dailyReportExternalId(d: Date): string { return `daily-report-${dateKey(d)}`; }

function tt(locale: 'zh' | 'en', zh: string, en: string): string { return locale === 'en' ? en : zh; }

function greetingFor(hour: number, locale: 'zh' | 'en'): string {
  if (hour < 5) return tt(locale, '凌晨好', 'Good early morning');
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

/** 前瞻图文日报生成(纯函数)。 */
export function buildDailyReport(input: DailyReportInput): DailyReport {
  const locale: 'zh' | 'en' = input.locale === 'en' ? 'en' : 'zh';
  const now = input.now ?? new Date();
  const dayEnd = new Date(now).setHours(23, 59, 59, 999);

  const greeting = `${greetingFor(now.getHours(), locale)}${input.displayName ? (locale === 'en' ? `, ${input.displayName}` : `,${input.displayName}`) : ''}`;

  const events = Array.isArray(input.events) ? input.events : [];
  const todayEvents = events
    .filter((e) => {
      const t = new Date(e.start).getTime();
      return Number.isFinite(t) && t >= now.getTime() - 30 * 60_000 && t <= dayEnd;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const upcoming = events
    .filter((e) => { const t = new Date(e.start).getTime(); return Number.isFinite(t) && t > dayEnd; })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, 3);

  const wText = weatherText(input.weather, input.location, locale);
  const emails = (input.emailHighlights || []).filter(Boolean).slice(0, 3);
  const notes = (input.memoryNotes || []).filter(Boolean).slice(0, 3);

  const sections: DailyReportSection[] = [];
  if (wText) sections.push({ id: 'weather', icon: '🌤️', title: tt(locale, '天气', 'Weather'), lines: [wText] });

  const calLines = todayEvents.length
    ? todayEvents.map((e) => fmtEvent(e, locale))
    : upcoming.length
      ? [tt(locale, '今天日历上没有安排。', 'Nothing on today’s calendar.'),
         `${tt(locale, '下一个:', 'Next: ')}${fmtEvent(upcoming[0], locale)}`]
      : [tt(locale, '今天没有日历安排,可以专注深度工作。', 'No calendar events today — a good day for deep work.')];
  sections.push({ id: 'calendar', icon: '📅', title: tt(locale, '今日日程', 'Today’s schedule'), lines: calLines });

  if (emails.length) sections.push({ id: 'email', icon: '✉️', title: tt(locale, '邮件亮点', 'Email highlights'), lines: emails });
  if (notes.length) sections.push({ id: 'memory', icon: '🧠', title: tt(locale, '记忆提醒', 'From your memory'), lines: notes });

  // 一句话概览
  const headlineParts: string[] = [];
  if (todayEvents.length) {
    headlineParts.push(tt(locale, `今天 ${todayEvents.length} 个安排`, `${todayEvents.length} event${todayEvents.length > 1 ? 's' : ''} today`));
  } else {
    headlineParts.push(tt(locale, '今天日程空', 'Clear schedule today'));
  }
  if (wText) headlineParts.push(wText.split(locale === 'en' ? ',' : ',')[0]);
  const headline = headlineParts.join(locale === 'en' ? ' · ' : ' · ');

  // markdown(存记忆 / 展示;与月报同风格)
  const dateLabel = now.toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const md: string[] = [`# ${tt(locale, '每日日报', 'Daily report')} · ${dateLabel}`, '', `_${headline}_`, ''];
  for (const s of sections) {
    md.push(`## ${s.icon} ${s.title}`);
    for (const line of s.lines) md.push(`- ${line}`);
    md.push('');
  }
  const markdown = md.join('\n').trim();

  // 无天气、无今日/临近安排、无邮件、无记忆 → 空(自动预生成跳过)
  const empty = !wText && todayEvents.length === 0 && upcoming.length === 0 && emails.length === 0 && notes.length === 0;

  return { date: dateKey(now), greeting, headline, sections, markdown, empty };
}
