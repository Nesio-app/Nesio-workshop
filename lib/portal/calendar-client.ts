/**
 * 客户端建日程:POST /api/portal/calendar。结构化或自然语言二选一。
 * 时区固定纽约(见 user-timezone)。返回统一形状,失败态显式(红线)。
 */
import { USER_TIME_ZONE } from './user-timezone';

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
  /**
   * Google 原样返回的错误文本(服务端已截到 300 字)。
   *
   * 服务端一直在返回它,客户端却从没读过 —— 于是任何写入失败都塌成一句
   * 「写入日历没成功,稍后再试。」,连是权限没给、日历不存在、还是配额满了都看不出来
   * (标注 图1 报的就是这个,当时无从下手)。自己用的东西,得能看见真话。
   */
  detail?: string;
}

export async function createCalendarEvent(input: CreateEventInput): Promise<CreateEventResult> {
  // 个人版固定纽约时区(不信设备,设备可能是 Asia/Shanghai)。服务端也会再兜一层。
  const timeZone = input.timeZone || USER_TIME_ZONE;
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
        detail: data.detail,
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
