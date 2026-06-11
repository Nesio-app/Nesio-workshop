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

export function nextHolidayLine(from = new Date()): string {
  const today = startOfDay(from).getTime();
  const upcoming = CN_HOLIDAYS.map((h) => ({
    name: h.name,
    time: startOfDay(new Date(h.date + 'T12:00:00')).getTime(),
  }))
    .filter((h) => h.time >= today)
    .sort((a, b) => a.time - b.time);

  const next = upcoming[0];
  if (!next) return '';
  const days = Math.round((next.time - today) / 86_400_000);
  if (days === 0) return `今天 ${next.name}`;
  return `${next.name} · 还有 ${days} 天`;
}
