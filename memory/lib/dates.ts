export type MemorialScheduleItem = {
  id: string;
  labelKey: string;
  label: string;
  date: Date;
  dateStr: string;
  note: string;
  isPast: boolean;
  daysUntil: number;
};

export function formatZhDate(date: Date): string {
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（周${weekdays[date.getDay()]}）`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function nextQingming(from = new Date()): Date {
  const year = from.getFullYear();
  let q = new Date(year, 3, 5, 9, 0, 0);
  if (q < from) q = new Date(year + 1, 3, 5, 9, 0, 0);
  return q;
}

export function buildMemorialSchedule(deathDate: Date): MemorialScheduleItem[] {
  const items = [
    {
      id: "touqi",
      labelKey: "touqi",
      label: "头七",
      date: addDays(deathDate, 6),
      note: "传统上为辞世后第七日，家人相聚追思。",
    },
    {
      id: "qiqi",
      labelKey: "qiqi",
      label: "七七",
      date: addDays(deathDate, 48),
      note: "四十九日之期，悼念将转入日常的思念。",
    },
    {
      id: "anniversary",
      labelKey: "anniversary",
      label: "周年忌日",
      date: addDays(deathDate, 365),
      note: "每年的这一天，门会为家人留着。",
    },
    {
      id: "qingming",
      labelKey: "qingming",
      label: "清明",
      date: nextQingming(addDays(deathDate, 1)),
      note: "春清明，祭扫与追忆。",
    },
  ];

  const now = new Date();
  return items.map((it) => ({
    ...it,
    dateStr: formatZhDate(it.date),
    isPast: it.date < now,
    daysUntil: Math.ceil((it.date.getTime() - now.getTime()) / 86400000),
  }));
}

export function dueRemindersToday(
  schedule: MemorialScheduleItem[],
  windowDays = 7
): MemorialScheduleItem[] {
  return schedule.filter((it) => !it.isPast && it.daysUntil >= 0 && it.daysUntil <= windowDays);
}
