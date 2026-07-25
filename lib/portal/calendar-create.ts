/**
 * 创建 Google 日历事件的纯函数层(可单测,无副作用)。
 * 路由 app/api/portal/calendar POST 复用:自然语言 → 草稿事件 → Google events 体。
 * 需 calendar.events scope(见 connect 路由);写主日历(primary)。
 */

/** 归一后的草稿事件。时间用 ISO 8601(含时区偏移)或纯日期(all-day)。 */
export interface DraftEvent {
  summary: string;
  startISO: string;      // dateTime(带时区)或 all-day 时的 'YYYY-MM-DD'
  endISO?: string;       // 缺省 = 起始 +1 小时(定时)/ +1 天(all-day)
  allDay?: boolean;
  description?: string;
  location?: string;
  timeZone?: string;     // IANA,如 'Asia/Shanghai';定时事件用
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 校验草稿。返回错误码或 null(通过)。不抛异常。 */
export function validateDraft(d: Partial<DraftEvent> | null | undefined): string | null {
  if (!d || typeof d !== 'object') return 'no_draft';
  if (!d.summary || !d.summary.trim()) return 'missing_summary';
  if (!d.startISO || !d.startISO.trim()) return 'missing_start';
  const startMs = Date.parse(d.startISO);
  if (!Number.isFinite(startMs)) return 'bad_start';
  if (d.endISO) {
    const endMs = Date.parse(d.endISO);
    if (!Number.isFinite(endMs)) return 'bad_end';
    if (endMs <= startMs) return 'end_before_start';
  }
  return null;
}

/** 纯日期 +1 天(all-day end 是排他的,Google 要求 end.date = 次日)。 */
function nextDay(dateOnly: string): string {
  const ms = Date.parse(`${dateOnly}T00:00:00Z`);
  return new Date(ms + 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 草稿 → Google Calendar events.insert 请求体。假定已过 validateDraft。 */
export function draftToGoogleEvent(d: DraftEvent): Record<string, unknown> {
  const body: Record<string, unknown> = { summary: d.summary.trim() };
  if (d.description?.trim()) body.description = d.description.trim();
  if (d.location?.trim()) body.location = d.location.trim();

  const isAllDay = d.allDay || DATE_ONLY.test(d.startISO);
  if (isAllDay) {
    const startDate = d.startISO.slice(0, 10);
    const endDate = d.endISO && DATE_ONLY.test(d.endISO) ? d.endISO : nextDay(startDate);
    body.start = { date: startDate };
    body.end = { date: endDate };
  } else {
    const startMs = Date.parse(d.startISO);
    const endISO = d.endISO || new Date(startMs + 60 * 60 * 1000).toISOString();
    body.start = d.timeZone ? { dateTime: d.startISO, timeZone: d.timeZone } : { dateTime: d.startISO };
    body.end = d.timeZone ? { dateTime: endISO, timeZone: d.timeZone } : { dateTime: endISO };
  }
  return body;
}

/**
 * 自然语言解析提示词(纯函数)。给 LLM「现在时刻 + 时区」做相对时间锚点
 * (「周五下午3点」「明天」都相对 now 解析),要求只回 JSON。
 */
export function buildEventParsePrompt(text: string, nowISO: string, timeZone: string): string {
  return [
    `You convert a natural-language scheduling request into a calendar event.`,
    `Current time: ${nowISO}. User timezone: ${timeZone}.`,
    `Resolve relative dates/times ("tomorrow", "this Friday 3pm", "下周一上午十点") against the current time and timezone.`,
    `Return ONLY a JSON object, no prose, with keys:`,
    `  summary (string, the event title),`,
    `  startISO (ISO 8601 with timezone offset for timed events, or "YYYY-MM-DD" for all-day),`,
    `  endISO (optional; omit to default 1h / all-day),`,
    `  allDay (optional boolean),`,
    `  location (optional string),`,
    `  description (optional string),`,
    `  timeZone (IANA name, e.g. "${timeZone}").`,
    `If no clear time is given, make it all-day for the most likely date.`,
    `Request: ${text}`,
  ].join('\n');
}

/** 从 LLM 文本里抠出草稿事件(容错 ```json 围栏 / 前后杂字)。失败返回 null。 */
export function parseDraftFromLlm(text: string): DraftEvent | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Partial<DraftEvent>;
    if (!obj.summary || !obj.startISO) return null;
    return {
      summary: String(obj.summary),
      startISO: String(obj.startISO),
      endISO: obj.endISO ? String(obj.endISO) : undefined,
      allDay: obj.allDay === true,
      location: obj.location ? String(obj.location) : undefined,
      description: obj.description ? String(obj.description) : undefined,
      timeZone: obj.timeZone ? String(obj.timeZone) : undefined,
    };
  } catch {
    return null;
  }
}

/** 念念/Alexa 用的一句话回执(建成 or 失败,warm-coach 语气)。 */
export function eventConfirmSpoken(summary: string, whenLabel: string, ok: boolean): string {
  if (ok) return `已加到日历:${summary}(${whenLabel})。`;
  return `我记下了「${summary}」,但这会儿没能写进日历——先保存文字,稍后可以再试一次。`;
}
