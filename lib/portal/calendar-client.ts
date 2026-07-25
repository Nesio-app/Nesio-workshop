/**
 * 客户端建日程:POST /api/portal/calendar。结构化或自然语言二选一。
 * 自动带浏览器时区(相对时间锚点用)。返回统一形状,失败态显式(红线)。
 */

export interface CreateEventInput {
  summary?: string;
  startISO?: string;
  endISO?: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  timeZone?: string;
  text?: string; // 自然语言(与 summary/startISO 二选一)
}

export interface CreatedEvent {
  id: string;
  htmlLink: string;
  summary: string;
  start: unknown;
  end: unknown;
}

export interface CreateEventResult {
  ok: boolean;
  event?: CreatedEvent;
  error?: string;
  message?: string;
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  } catch {
    return 'Asia/Shanghai';
  }
}

export async function createCalendarEvent(input: CreateEventInput): Promise<CreateEventResult> {
  const timeZone = input.timeZone || browserTimeZone();
  try {
    const res = await fetch('/api/portal/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ ...input, timeZone }),
    });
    const data = (await res.json().catch(() => ({}))) as CreateEventResult;
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || `http_${res.status}`,
        message: data.message || '写入日历没成功,稍后再试一次。',
      };
    }
    return data;
  } catch {
    return { ok: false, error: 'network', message: '网络不太稳,稍后再试一次。' };
  }
}

/** 本地「日期+时间」拼成不带偏移的 dateTime(配 timeZone 交给 Google 解释,避免手算偏移)。 */
export function localDateTime(dateYmd: string, timeHm: string): string {
  return `${dateYmd}T${timeHm.length === 5 ? `${timeHm}:00` : timeHm}`;
}
