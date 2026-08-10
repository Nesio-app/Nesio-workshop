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
 *
 * #24(2026-07-30 真机):「动态生成的提醒卡片内容完全没跟着翻译,只有菜单类静态文案
 * 被翻译了」。根就在这儿 —— 这几句模板是**写死的中文**,函数连 locale 参数都没有,
 * 于是英文界面下今天页的卡片是中文。
 * 注意区分两种东西:卡里那个**事件标题 / 物品名 / 账户名是用户自己的数据**,
 * 它不该被翻译(把用户记的「牛奶」翻成 Milk 是另一种失真);
 * 要跟着语言走的是**我们加的那几个词**(今天 / 明天 / 到效期 / 还款 / 最低)。
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

/** 只翻**我们加的那几个词**;用户自己的名字/标题原样不动。 */
const COPY = {
  zh: { today: '今天', tomorrow: '明天', expires: '到效期', dueOn: '还款', minPay: '最低' },
  en: { today: 'today', tomorrow: 'tomorrow', expires: ' expires', dueOn: 'due', minPay: 'min' },
} as const;

export function buildFallbackCards(
  input: {
    calendarEvents?: readonly FallbackCalendarEvent[];
    expiryItems?: readonly FallbackExpiryItem[];
    dueBills?: readonly FallbackDueBill[];
  },
  now: Date = new Date(),
  locale: string = 'zh',
): FallbackCard[] {
  const t = locale === 'en' ? COPY.en : COPY.zh;
  const out: FallbackCard[] = [];
  const today = localDayISO(now.getTime());
  const tomorrow = localDayISO(now.getTime() + DAY_MS);

  for (const e of input.calendarEvents || []) {
    const delta = e.startMs - now.getTime();
    // 图5:提醒卡只收 >24h 的事件;≤24h 归时间线,两边不得重复。
    if (delta <= DAY_MS) continue;
    if (delta >= 7 * DAY_MS) continue; // 太远不吵(≥7 天)
    if ((e.endMs ?? e.startMs) < now.getTime()) continue; // 已结束的不吵
    const day = localDayISO(e.startMs);
    out.push({
      id: `fallback-cal-${e.id}`,
      title: e.title.slice(0, 28),
      body: day === today ? `${t.today} ${hhmm(e.startMs)}` : day === tomorrow ? `${t.tomorrow} ${hhmm(e.startMs)}` : `${day.slice(5).replace('-', '/')} ${hhmm(e.startMs)}`,
      severity: delta < 2 * 3_600_000 ? 3 : 2,
      source: 'fallback-calendar',
    });
  }

  for (const item of input.expiryItems || []) {
    if (item.expiry !== today && item.expiry !== tomorrow) continue;
    out.push({
      id: `fallback-exp-${item.id}`,
      // 物品名是用户自己的数据,原样;跟着语言走的是后面那半句
      title: `${item.name.slice(0, 20)}${locale === 'en' ? ' ' : ''}${item.expiry === today ? t.today : t.tomorrow}${t.expires}`,
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
      title: `${bill.account.slice(0, 16)} ${t.dueOn} ${bill.dueDate.slice(5).replace('-', '/')}`,
      body: bill.minPayment ? `${t.minPay} $${bill.minPayment}` : '',
      severity: days <= 1 ? 3 : 2,
      source: 'fallback-bill',
    });
  }

  return out.sort((a, b) => b.severity - a.severity);
}
