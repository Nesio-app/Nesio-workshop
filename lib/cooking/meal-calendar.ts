/**
 * meal-calendar —— 美食日历(Bug4 图25-27)。
 *
 * 旧的「做饭计划」是**算出来**的:planWeek 按库存现排一周,页面上改两笔也只活在
 * 组件 state 里,退出去就没了。用户要的是相反的东西 ——「这里仅显示已经有的安排」,
 * 也就是一份**你自己定过的**日历,一天三顿,谁也不替你填。
 *
 * 于是这份表只存用户真正安排过的格子:date × slot → 菜名。没安排的格子就是空的,
 * 不猜、不占位。planWeek 仍然留着 —— 它现在的用处是「换一道」时给候选,不再是计划本身。
 */

import { createBlobStore } from '../portal/idb-blob-store';
import { reportStorageDropped } from '../portal/storage-health';

export const MEAL_CALENDAR_KEY = 'nesio-meal-calendar-v1';
export const MEAL_CALENDAR_EVENT = 'nesio-meal-calendar-updated';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_SLOT_LABEL: Record<MealSlot, { zh: string; en: string }> = {
  breakfast: { zh: '早', en: 'Breakfast' },
  lunch: { zh: '午', en: 'Lunch' },
  dinner: { zh: '晚', en: 'Dinner' },
  snack: { zh: '加餐', en: 'Snack' },
};

/** date(YYYY-MM-DD)→ 三顿各安排了什么。没排的键直接不存。 */
export type MealCalendar = Record<string, Partial<Record<MealSlot, string>>>;

const store = createBlobStore<MealCalendar>({
  key: MEAL_CALENDAR_KEY,
  updateEvent: MEAL_CALENDAR_EVENT,
  validate: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
  onWriteError: reportStorageDropped,
});

export function mealCalendarReady(): Promise<void> {
  return store.ready().then(() => undefined);
}

export function loadMealCalendar(): MealCalendar {
  const raw = store.load();
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function getDayPlan(date: string): Partial<Record<MealSlot, string>> {
  return loadMealCalendar()[date] ?? {};
}

/** 排一顿;dish 空 = 取消这一顿(整天空了就把这一天也删掉,不留空壳)。 */
export function setMealPlan(date: string, slot: MealSlot, dish: string | null): void {
  const all = { ...loadMealCalendar() };
  const day = { ...(all[date] ?? {}) };
  const name = (dish ?? '').trim();
  if (name) day[slot] = name;
  else delete day[slot];
  if (Object.keys(day).length === 0) delete all[date];
  else all[date] = day;
  // 只留 180 天内的:日历是给「接下来吃什么」用的,不是流水账。
  const cut = dayKey(new Date(Date.now() - 180 * 86_400_000));
  for (const k of Object.keys(all)) if (k < cut) delete all[k];
  store.save(all);
}

/** 从今天起 n 天的日期键(用来渲染日历,天数固定,内容可以为空)。 */
export function upcomingDayKeys(n: number, from = new Date()): string[] {
  return dayKeysFrom(from, n);
}

/** 从某个锚点日起 n 天的日期键(左右翻周用)。 */
export function dayKeysFrom(anchor: Date, n: number): string[] {
  const base = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  return Array.from({ length: n }, (_, i) => dayKey(new Date(base.getTime() + i * 86_400_000)));
}

/** 这份日历里已经排上的全部菜名(去重)—— 算「还差什么」时用。 */
export function plannedDishes(dates: readonly string[]): string[] {
  const cal = loadMealCalendar();
  const out = new Set<string>();
  for (const d of dates) for (const s of MEAL_SLOTS) {
    const v = cal[d]?.[s];
    if (v) out.add(v);
  }
  return [...out];
}
