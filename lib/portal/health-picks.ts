/**
 * health-picks —— 「今日精选」里每张卡**到底是哪天的数**(2026-07-30)。
 *
 * 出问题的地方:概览页标题写着「今日精选」,里面却混着一条 07/05 的步数
 * (三周前),而同屏的活动三环 / 睡眠 / 血糖都是这两天的。日期小小地印在角上,
 * 看起来就像今天走了 554 步。
 *
 * 老代码是 `data.metrics.find(m => m.key === 'steps' || m.group === 'activity')`——
 * 拿到最新一条就放进去,**从不问它有多新**。又是「凡是没被拦住的都算数」。
 *
 * 这里定的判据是正向的:一张卡要挂在「今日」底下,得**自己报出日期,且日期就是今天**。
 *   · 报不出日期 → 不许说今天;
 *   · 日期不是今天 → 卡片上明说「7/5 · 3 周前」,不许只印个小小的 07/05;
 *   · 一张卡只要不是今天的,整段标题就从「今日精选」退成「近期精选」——
 *     标题是对整组的承诺,一条不成立整句就不成立。
 *
 * 不删数据:三周前的步数仍然是真的读数,错的是把它叫「今日」。
 *
 * 纯函数,不碰存储、不碰 DOM。
 */

const DAY_MS = 86_400_000;

/** 一张精选卡说的是**哪一天**,还是**一段时间**。 */
export type PickSpan = 'day' | 'span';

export interface AsOfNote {
  /** 就是今天的数据吗。只有全部为 true,标题才配叫「今日」。 */
  fresh: boolean;
  /** 卡片副标上要补的那句(fresh 时为空串 —— 今天的数不用解释)。 */
  zh: string;
  en: string;
}

/** 本地日历日(不是 UTC —— 用户看的是墙上的今天)。 */
export function dayKeyOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'YYYY-MM-DD' → 'M/D'(去掉前导零,7/5 而不是 07/05)。 */
function shortDate(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  return `${Number(m[2])}/${Number(m[3])}`;
}

function daysBetween(fromKey: string, toKey: string): number | null {
  const a = Date.parse(`${fromKey}T00:00:00`);
  const b = Date.parse(`${toKey}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

/**
 * 这张卡的数据有多旧,该怎么说。
 *
 * @param asOf   卡片自己报的日期(YYYY-MM-DD);报不出来传 null/undefined
 * @param today  今天(YYYY-MM-DD)
 * @param span   'day' = 某一天的读数;'span' = 一段时间的汇总(血糖 TIR、情绪均值)
 */
export function asOfNote(asOf: string | null | undefined, today: string, span: PickSpan = 'day'): AsOfNote {
  if (!asOf) {
    // 报不出日期的,一律不算今天 —— 沉默地挂在「今日」下面才是骗人
    return { fresh: false, zh: '日期未知', en: 'date unknown' };
  }
  const diff = daysBetween(asOf, today);
  if (diff === null) return { fresh: false, zh: '日期未知', en: 'date unknown' };
  if (diff === 0 && span === 'day') return { fresh: true, zh: '', en: '' };

  const d = shortDate(asOf);
  if (span === 'span') {
    // 汇总卡永远不是「某一天」,但它截到哪天是硬事实
    if (diff <= 0) return { fresh: true, zh: '', en: '' };
    if (diff === 1) return { fresh: false, zh: '截至昨天', en: 'through yesterday' };
    if (diff < 7) return { fresh: false, zh: `截至 ${d} · ${diff} 天前`, en: `through ${d} · ${diff}d ago` };
    if (diff < 30) return { fresh: false, zh: `截至 ${d} · ${Math.round(diff / 7)} 周前`, en: `through ${d} · ${Math.round(diff / 7)}w ago` };
    return { fresh: false, zh: `截至 ${d} · ${Math.round(diff / 30)} 个月前`, en: `through ${d} · ${Math.round(diff / 30)}mo ago` };
  }
  // 未来日期是脏数据,不当今天用,也不编一句「-3 天前」
  if (diff < 0) return { fresh: false, zh: `${d} 的数据`, en: `from ${d}` };
  if (diff === 1) return { fresh: false, zh: '昨天的数据', en: 'from yesterday' };
  if (diff < 7) return { fresh: false, zh: `${d} · ${diff} 天前`, en: `${d} · ${diff}d ago` };
  if (diff < 30) return { fresh: false, zh: `${d} · ${Math.round(diff / 7)} 周前`, en: `${d} · ${Math.round(diff / 7)}w ago` };
  return { fresh: false, zh: `${d} · ${Math.round(diff / 30)} 个月前`, en: `${d} · ${Math.round(diff / 30)}mo ago` };
}

/**
 * 整段标题能不能叫「今日精选」。
 * 一条不是今天的就不能 —— 标题是对整组卡的承诺,不是对最新那张卡的承诺。
 * 空组也不叫今日(没有任何东西支撑这句话)。
 */
export function picksAreToday(notes: readonly AsOfNote[]): boolean {
  return notes.length > 0 && notes.every((n) => n.fresh);
}
