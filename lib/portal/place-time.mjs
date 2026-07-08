/**
 * 地点时间还原(纯函数,可单测)—— 修足迹时间线的两类时间错误:
 *
 * 1. 导入的 Google 时间轴时间戳常带原时区偏移(如 2024-05-01T19:00:00+08:00,
 *    在中国的晚饭)。旧代码 new Date(iso) 后按设备时区取日期/小时 —— 在美东
 *    显示成 07:00、日期还挪了一天。这里:时间戳带显式偏移时,按**字面钟点**
 *    (事发地当地时间)还原日期与时刻;Z/无偏移则维持设备时区换算。
 *
 * 2. 'YYYY-MM-DD' 日期键被 new Date(key) 当 UTC 午夜解析,西半球时区显示
 *    上一天(日期头全部偏一天)。这里提供本地安全的解析。
 */

const OFFSET_RE = /[+-]\d{2}:?\d{2}$/;
const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/**
 * @param {string} iso
 * @returns {{ y: number; mo: number; d: number; hh: number; mm: number } | null}
 *   带显式时区偏移(非 Z)→ 字面钟点(事发地当地时间);否则 null(调用方走设备时区)。
 */
export function explicitWallClock(iso) {
  const s = String(iso || '');
  if (!OFFSET_RE.test(s)) return null;
  const m = WALL_RE.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), hh: Number(m[4]), mm: Number(m[5]) };
}

/** 'YYYY-MM-DD' 日期键:带偏移的按事发地当地日,否则按设备本地日。 */
export function wallDateKey(iso) {
  const w = explicitWallClock(iso);
  if (w) return `${w.y}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
  const dt = new Date(iso);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** 小时(0-23):带偏移的按事发地当地钟点。供时段分布/展示。 */
export function wallHour(iso) {
  const w = explicitWallClock(iso);
  if (w) return w.hh;
  return new Date(iso).getHours();
}

/** 'HH:MM' 展示:带偏移的按事发地当地钟点。 */
export function wallHHMM(iso) {
  const w = explicitWallClock(iso);
  if (w) return `${String(w.hh).padStart(2, '0')}:${String(w.mm).padStart(2, '0')}`;
  const dt = new Date(iso);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' → 本地 Date(不经 UTC,修日期头偏一天)。 */
export function dateKeyToLocalDate(key) {
  const [y, mo, d] = String(key || '').split('-').map(Number);
  return new Date(y || 1970, (mo || 1) - 1, d || 1);
}

/**
 * 段结束跨天时截到开始那天的 23:59(按事发地钟点算距离,返回新的 epoch ISO)。
 * 旧实现用设备时区 setHours(23,59)——对带偏移的导入段,截断点落错了天。
 */
export function clampEndToWallDay(startIso, endIso) {
  if (wallDateKey(endIso) === wallDateKey(startIso)) return endIso;
  const w = explicitWallClock(startIso);
  if (w) {
    const minsLeft = (23 * 60 + 59) - (w.hh * 60 + w.mm);
    return new Date(new Date(startIso).getTime() + minsLeft * 60_000).toISOString();
  }
  const d = new Date(startIso);
  d.setHours(23, 59, 59, 0);
  return d.toISOString();
}
