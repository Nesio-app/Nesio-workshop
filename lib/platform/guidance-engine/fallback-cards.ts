/**
 * 结构化兜底 —— AI 挂了/离线时仍要出的确定性卡(第四条承诺,设计定稿 2026-07-29)。
 *
 * 铁律:**零分类、零 NLP、零正则**。兜底不许依赖被拆除的类型推断 ——
 * 防线不能依赖被拆的墙。只认结构化字段:
 *   · 今明的**所有**日历事件(不问它是什么 —— 它今天发生,这就够了)
 *   · 物品 expiry 今天/明天
 *   · (Plaid 还款日 ≤3 天 —— 数据接入后启用,collector 传入即生效)
 *
 * 零 import,纯函数,可注入 now。文案是模板不是判断:「X @ 时刻」。
 */

export interface FallbackCalendarEvent {
  id: string;
  title: string;
  startMs: number;
  endMs?: number;
}

export interface FallbackExpiryItem {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  expiry: string;
}

export interface FallbackDueBill {
  id: string;
  account: string;
  /** YYYY-MM-DD */
  dueDate: string;
  minPayment?: number;
}

export interface FallbackCard {
  id: string;
  title: string;
  body: string;
  severity: 2 | 3;
  source: 'fallback-calendar' | 'fallback-inventory' | 'fallback-bill';
}

const DAY_MS = 86_400_000;

function localDayISO(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function buildFallbackCards(
  input: {
    calendarEvents?: readonly FallbackCalendarEvent[];
    expiryItems?: readonly FallbackExpiryItem[];
    dueBills?: readonly FallbackDueBill[];
  },
  now: Date = new Date(),
): FallbackCard[] {
  const out: FallbackCard[] = [];
  const today = localDayISO(now.getTime());
  const tomorrow = localDayISO(now.getTime() + DAY_MS);

  for (const e of input.calendarEvents || []) {
    const day = localDayISO(e.startMs);
    if (day !== today && day !== tomorrow) continue;
    if ((e.endMs ?? e.startMs) < now.getTime()) continue; // 已结束的不吵
    out.push({
      id: `fallback-cal-${e.id}`,
      title: e.title.slice(0, 28),
      body: day === today ? `今天 ${hhmm(e.startMs)}` : `明天 ${hhmm(e.startMs)}`,
      severity: e.startMs - now.getTime() < 2 * 3_600_000 ? 3 : 2,
      source: 'fallback-calendar',
    });
  }

  for (const item of input.expiryItems || []) {
    if (item.expiry !== today && item.expiry !== tomorrow) continue;
    out.push({
      id: `fallback-exp-${item.id}`,
      title: `${item.name.slice(0, 20)}${item.expiry === today ? '今天' : '明天'}到效期`,
      body: '',
      severity: 2,
      source: 'fallback-inventory',
    });
  }

  for (const bill of input.dueBills || []) {
    const dueMs = Date.parse(`${bill.dueDate}T00:00:00`);
    const days = (dueMs - Date.parse(`${today}T00:00:00`)) / DAY_MS;
    if (days < 0 || days > 3) continue;
    out.push({
      id: `fallback-bill-${bill.id}`,
      title: `${bill.account.slice(0, 16)} 还款 ${bill.dueDate.slice(5).replace('-', '/')}`,
      body: bill.minPayment ? `最低 $${bill.minPayment}` : '',
      severity: days <= 1 ? 3 : 2,
      source: 'fallback-bill',
    });
  }

  return out.sort((a, b) => b.severity - a.severity);
}
