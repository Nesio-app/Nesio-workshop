/** Common public holidays (Gregorian). Extend yearly as needed. */
const CN_HOLIDAYS: { name: string; date: string }[] = [
  { name: '元旦', date: '2025-01-01' },
  { name: '春节', date: '2025-01-29' },
  { name: '清明节', date: '2025-04-04' },
  { name: '劳动节', date: '2025-05-01' },
  { name: '端午节', date: '2025-05-31' },
  { name: '中秋节', date: '2025-10-06' },
  { name: '国庆节', date: '2025-10-01' },
  { name: '元旦', date: '2026-01-01' },
  { name: '春节', date: '2026-02-17' },
  { name: '清明节', date: '2026-04-05' },
  { name: '劳动节', date: '2026-05-01' },
  { name: '端午节', date: '2026-06-19' },
  { name: '中秋节', date: '2026-09-25' },
  { name: '国庆节', date: '2026-10-01' },
  { name: '元旦', date: '2027-01-01' },
];

/** US federal holidays (Gregorian). Extend yearly as needed. */
const US_HOLIDAYS: { name: string; date: string }[] = [
  { name: "New Year's Day", date: '2025-01-01' },
  { name: 'MLK Day', date: '2025-01-20' },
  { name: "Presidents' Day", date: '2025-02-17' },
  { name: 'Memorial Day', date: '2025-05-26' },
  { name: 'Juneteenth', date: '2025-06-19' },
  { name: 'Independence Day', date: '2025-07-04' },
  { name: 'Labor Day', date: '2025-09-01' },
  { name: 'Columbus Day', date: '2025-10-13' },
  { name: 'Veterans Day', date: '2025-11-11' },
  { name: 'Thanksgiving', date: '2025-11-27' },
  { name: 'Christmas', date: '2025-12-25' },
  { name: "New Year's Day", date: '2026-01-01' },
  { name: 'MLK Day', date: '2026-01-19' },
  { name: "Presidents' Day", date: '2026-02-16' },
  { name: 'Memorial Day', date: '2026-05-25' },
  { name: 'Juneteenth', date: '2026-06-19' },
  { name: 'Independence Day', date: '2026-07-04' },
  { name: 'Labor Day', date: '2026-09-07' },
  { name: 'Columbus Day', date: '2026-10-12' },
  { name: 'Veterans Day', date: '2026-11-11' },
  { name: 'Thanksgiving', date: '2026-11-26' },
  { name: 'Christmas', date: '2026-12-25' },
  { name: "New Year's Day", date: '2027-01-01' },
  { name: 'MLK Day', date: '2027-01-18' },
  { name: "Presidents' Day", date: '2027-02-15' },
  { name: 'Memorial Day', date: '2027-05-31' },
  { name: 'Juneteenth', date: '2027-06-19' },
  { name: 'Independence Day', date: '2027-07-04' },
  { name: 'Labor Day', date: '2027-09-06' },
  { name: 'Columbus Day', date: '2027-10-11' },
  { name: 'Veterans Day', date: '2027-11-11' },
  { name: 'Thanksgiving', date: '2027-11-25' },
  { name: 'Christmas', date: '2027-12-25' },
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function formatLunarLine(date: Date): string {
  try {
    const lunar = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      month: 'long',
      day: 'numeric',
    }).format(date);
    const year = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      year: 'numeric',
    }).format(date);
    return `农历 ${year} ${lunar}`;
  } catch {
    return '';
  }
}

function nextHolidayFromList(
  holidays: { name: string; date: string }[],
  from: Date,
  todayLabel: string,
  countdownLabel: (name: string, days: number) => string,
): string {
  const today = startOfDay(from).getTime();
  const upcoming = holidays
    .map((h) => ({
      name: h.name,
      time: startOfDay(new Date(h.date + 'T12:00:00')).getTime(),
    }))
    .filter((h) => h.time >= today)
    .sort((a, b) => a.time - b.time);

  const next = upcoming[0];
  if (!next) return '';
  const days = Math.round((next.time - today) / 86_400_000);
  if (days === 0) return `${todayLabel} ${next.name}`;
  return countdownLabel(next.name, days);
}

export function nextHolidayLine(from = new Date()): string {
  return nextHolidayFromList(CN_HOLIDAYS, from, '今天', (name, days) =>
    `${name} · 还有 ${days} 天`,
  );
}

export function nextUSHolidayLine(from = new Date()): string {
  return nextHolidayFromList(US_HOLIDAYS, from, 'Today', (name, days) =>
    `${name} · ${days}d`,
  );
}
