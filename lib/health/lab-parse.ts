/**
 * lab-parse — 化验单文字 → 结构化指标行(健康镜头 B 屏,2026-07-29)。
 *
 * 输入是 OCR 出来的**纯文本**(端上 Apple Vision 逐行识别的结果),输出是可以直接
 * 入库的指标行。全部确定性:正则 + 规则,零云、零模型。
 *
 * 为什么不交给模型:化验单是**表格**,信息全在版式里(项目 / 结果 / 单位 / 参考值 / 提示)。
 * 规则解得动的部分,交给模型只会多一个「它偶尔会编」的风险 —— 而这是医疗数据,
 * 编一个参考区间出来比解不出来糟得多。解不动的行原样交给用户在确认屏里改。
 *
 * 三条不许违反的:
 *   ① **不许编**。没识别到单位就是没有单位,没识别到参考区间就是没有;
 *      绝不「按常见值补一个」。参考区间是判定偏高偏低的唯一依据,编了整屏都是假的。
 *   ② **参考区间里的数字不能被当成结果值**。「6.80 mmol/L 3.90-6.10」里,
 *      3.90 和 6.10 是区间不是结果 —— 先把区间抠掉再找结果值,顺序反了就全错。
 *   ③ **表头/汇总行要滤掉**。「项目 结果 单位 参考值」这行没有结果值,
 *      但「参考值」三个字后面可能跟着数字,不滤就会造出一条叫「项目 结果 单位」的假指标。
 *
 * 纯函数,不碰 DOM/存储/网络。
 */

export interface ParsedLabRow {
  name: string;
  value: number;
  unit?: string;
  low?: number;
  high?: number;
  /** 相对参考区间。没有区间时为 undefined —— 不猜。 */
  flag?: 'low' | 'high' | 'normal';
  /**
   * 解析把握。UI 据此决定顺序和提示:
   *   high   名字 + 值 + 单位 + 区间齐全;
   *   medium 缺单位或缺区间;
   *   low    只解出名字和值(多半是版式没对上,请人核一眼)。
   * 不管哪一档都**必须**经人确认才入库(needsConfirm 恒真)。
   */
  confidence: 'high' | 'medium' | 'low';
  /** 原始那一行,确认屏里给人对照用。 */
  raw: string;
}

// 常见单位。列表是为了**认出**单位边界,不是为了补一个不存在的单位。
const UNIT_RE = /(?:10\^?\d+\s*\/\s*[Llµu][Ll]?|×?10\^?\d+\/[Ll]|mmol\s*\/\s*[Ll]|umol\s*\/\s*[Ll]|μmol\s*\/\s*[Ll]|nmol\s*\/\s*[Ll]|pmol\s*\/\s*[Ll]|mg\s*\/\s*d[Ll]|mg\s*\/\s*[Ll]|g\s*\/\s*[Ll]|ng\s*\/\s*m[Ll]|pg\s*\/\s*m[Ll]|[uUIμ]+\s*\/\s*[Ll]|IU\s*\/\s*m?[Ll]|fL|pg|%|mmHg|kg|cm|次\s*\/\s*分)/;

// 表头 / 抬头 / 页眉页脚 —— 有数字也不是指标行。
// ⚠️ 中英文必须分成两条:JS 的 `\b` 只认 [A-Za-z0-9_],中日韩字符两侧根本不成立 ——
// 写成 /(?:姓名|Name)\b/ 时,`姓名: 张三 … 年龄: 34` 一行照样漏过去,被解析成
// 一条名叫「姓名: 张三 性别: 女 年龄」、值 34 的假指标。契约测试抓到的。
const NOISE_CJK = /^(?:项\s*目|检验项目|结\s*果|单\s*位|参考[值范围]|提示|序号|备\s*注|标本|样本|科室|床号|住院号|门诊号|送检|采样|报告|审核|检验者|医师|医生|姓名|性别|年龄|页\s*码|第\s*\d+\s*页)/;
const NOISE_LATIN = /^(?:Item|Result|Unit|Reference|Range|Flag|Name|Sex|Age|Page)\b/i;
const isNoise = (s: string): boolean => NOISE_CJK.test(s) || NOISE_LATIN.test(s);

// 数字:允许 5、5.4、.5、5,4(OCR 偶尔把小数点认成逗号)
const NUM = String.raw`\d{1,3}(?:[,.]\d+)?|\.\d+`;

/** 「5,4」这种 OCR 噪声 → 5.4。整数里的千分位逗号本函数不处理(化验值极少上千)。 */
function toNum(s: string): number {
  return Number(s.replace(',', '.'));
}

interface RangeHit { low?: number; high?: number; start: number; end: number }

/**
 * 找参考区间,返回它在行内的位置(好把这一段从「找结果值」的候选里抠掉)。
 * 支持:3.9-6.1 / 3.9~6.1 / 3.9—6.1 / 3.9 to 6.1 / <5.2 / ≤5.2 / >1.0 / ≥1.0
 */
export function findRange(line: string): RangeHit | null {
  const pair = new RegExp(String.raw`(${NUM})\s*(?:[-~—–－]|to)\s*(${NUM})`).exec(line);
  if (pair) {
    const a = toNum(pair[1]);
    const b = toNum(pair[2]);
    // 「3.9-6.1」低在前;反了就当没认出来,别硬凑一个上下颠倒的区间。
    if (Number.isFinite(a) && Number.isFinite(b) && a <= b) {
      return { low: a, high: b, start: pair.index, end: pair.index + pair[0].length };
    }
    return null;
  }
  const upper = new RegExp(String.raw`[<≤]\s*=?\s*(${NUM})`).exec(line);
  if (upper) return { high: toNum(upper[1]), start: upper.index, end: upper.index + upper[0].length };
  const lower = new RegExp(String.raw`[>≥]\s*=?\s*(${NUM})`).exec(line);
  if (lower) return { low: toNum(lower[1]), start: lower.index, end: lower.index + lower[0].length };
  return null;
}

/**
 * 化验单上的偏高偏低标记。识别不到返回 undefined(不猜)。
 *
 * 两层防护(第一层是契约测试抓出来的,第二层是补给它兜底的):
 *   · **边界收紧**:第一版用 `\bL\b`,而 JS 的 `\b` 只看 [A-Za-z0-9_} ——
 *     「mmol/L」里 L 前面是 `/`(非词字符),照样成边界 → 每一条常规化验被判成偏低,
 *     判完还看起来毫无异样。改成必须前有空白、后接空白或行尾。
 *   · **先剥单位**:OCR 常把斜杠两边分开成「10^9 / L」,这时那个孤立的 L 前后都是空格,
 *     光靠边界拦不住。所以找标记之前把单位整段抹掉。
 * 剥单位能覆盖上面那条的大部分情形,但只对 UNIT_RE 认识的单位有效 ——
 * 遇到没收录的单位时,收紧后的边界才是那道还站着的墙。两层都留着。
 */
export function findMarker(line: string): 'low' | 'high' | undefined {
  const zone = line.replace(new RegExp(UNIT_RE.source, 'g'), ' ');
  if (/[↑⇑]/.test(zone) || /(?:^|\s)H(?:igh)?(?=\s|$)/.test(zone) || /偏高|升高/.test(zone)) return 'high';
  if (/[↓⇓]/.test(zone) || /(?:^|\s)L(?:ow)?(?=\s|$)/.test(zone) || /偏低|降低/.test(zone)) return 'low';
  return undefined;
}

/** 按区间判定。没有区间 → undefined。 */
export function flagOf(value: number, low?: number, high?: number): 'low' | 'high' | 'normal' | undefined {
  if (low == null && high == null) return undefined;
  if (low != null && value < low) return 'low';
  if (high != null && value > high) return 'high';
  return 'normal';
}

/** 清掉名字里的序号前缀、尾部残符号、重复空白。 */
export function cleanName(s: string): string {
  return s
    .replace(/^\s*\d{1,3}\s*[.、,)）]\s*/, '')   // 「1. 」「01、」
    .replace(/[|｜:：\-–—\s]+$/, '')
    .replace(/^[|｜\s]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 解一行。解不出来返回 null —— **返回 null 是正常结果**,不是失败。
 * 化验单上大半行是抬头、科室、医生签名,本来就没有指标。
 */
export function parseLabLine(line: string): ParsedLabRow | null {
  const raw = line.trim();
  if (!raw || raw.length > 120) return null;
  if (isNoise(cleanName(raw))) return null;

  // ② 先抠掉参考区间,剩下的才是「名字 + 结果值 + 单位」。顺序反了会把区间下界当成结果。
  // 序号前缀要**先**剥掉:「1. 白细胞计数 5.6 …」里的 1 会被当成结果值,名字随之变成
  // 空串,整行被丢弃 —— 表现是「带编号的化验单一条都识别不出来」。契约测试抓到的。
  const body = raw.replace(/^\s*\d{1,3}\s*[.\u3001,)\uFF09]\s+/, '');
  const range = findRange(body);
  const withoutRange = range ? body.slice(0, range.start) + '   ' + body.slice(range.end) : body;

  // 结果值:抠掉区间后的第一个数字
  const valMatch = new RegExp(String.raw`(${NUM})`).exec(withoutRange);
  if (!valMatch) return null;
  const value = toNum(valMatch[1]);
  if (!Number.isFinite(value)) return null;

  const name = cleanName(withoutRange.slice(0, valMatch.index));
  // 名字至少得有个字。纯数字行(页码、日期残片)不算指标。
  if (!name || !/[\p{L}]/u.test(name)) return null;

  // 单位:结果值之后、区间之前的那一段里找
  const after = withoutRange.slice(valMatch.index + valMatch[1].length);
  const unitMatch = UNIT_RE.exec(after);
  const unit = unitMatch ? unitMatch[0].replace(/\s+/g, '') : undefined;

  const low = range?.low;
  const high = range?.high;
  // ① 化验单自己印了 ↑/↓ 就听它的(它是出报告那台机器判的);否则按区间算;都没有 → 不猜。
  const flag = findMarker(raw) ?? flagOf(value, low, high);

  const hasRange = low != null || high != null;
  const confidence: ParsedLabRow['confidence'] =
    unit && hasRange ? 'high' : (unit || hasRange) ? 'medium' : 'low';

  return { name, value, ...(unit ? { unit } : {}), ...(low != null ? { low } : {}), ...(high != null ? { high } : {}), ...(flag ? { flag } : {}), confidence, raw };
}

/**
 * 解整张单子。
 *
 * 排序:**异常项置顶**(规格红线里那条「异常项 amber 置顶」),同档内保持原始顺序 ——
 * 让人先核最要紧的几行,而不是从头翻到尾。
 * 同名同值的重复行去掉(OCR 有时把一行认两遍)。
 */
export function parseLabReport(text: string): ParsedLabRow[] {
  const rows: ParsedLabRow[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const row = parseLabLine(line);
    if (!row) continue;
    const key = `${row.name.toLowerCase()}|${row.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  const rank = (r: ParsedLabRow) => (r.flag === 'high' || r.flag === 'low' ? 0 : 1);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/** 单子上有几项偏离参考区间(确认屏标题用)。 */
export function abnormalCount(rows: ParsedLabRow[]): number {
  return rows.filter((r) => r.flag === 'high' || r.flag === 'low').length;
}

/**
 * 化验单日期。找不到返回 null —— **不许回退成「今天」**:
 * 一张三个月前的单子被记成今天,曲线上的点就落错位置,C 屏那条「吃药后有没有用」直接失真。
 * 找不到就让用户在确认屏里选。
 */
export function findReportDate(text: string): string | null {
  const m = /(20\d{2})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})/.exec(text);
  if (!m) return null;
  const [, y, mo, d] = m;
  const mm = Number(mo);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
