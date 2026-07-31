/**
 * receipt-extract —— 从一张发票/小票的文字里抽出**金额 + 日期 + 商户**,
 * 好让它去认领银行里的那笔流水。
 *
 * ## 它在这条链上的位置
 *
 *   上传发票 → (这一层:抽出金额和日期) → claimCandidates → 你点头 → 认领
 *
 * 认领那一段早就通了(`spend-claim.ts`),缺的就是「从一张图/一份 PDF 里拿到金额」
 * 这一步。这里补上文字那一半。
 *
 * ## 抽不到就说抽不到
 *
 * 返回 `null` 而不是猜一个。抽错金额的后果是你认领了错的一笔流水 ——
 * 而认领是「一笔钱只能被一件东西认领」的,认错了就把真正该认领它的那件东西挡住了。
 * 宁可让你手填。
 *
 * ## 取哪一个金额
 *
 * 一张小票上有一堆数字:单价、小计、税、小费、**合计**。要的是合计。
 * 规则:优先找「合计/总计/Total/Amount Due」附近的那个数;找不到关键词时
 * 取**最大**的那个 —— 合计几乎总是最大的(除非有找零,所以「找零/Change」
 * 附近的数要排除掉)。
 *
 * 纯函数,不碰存储/网络 —— 图片转文字是调用方的事(端上视觉插件或你粘贴)。
 */

/** 金额:$1,234.56 / 1234.56元 / ¥88 */
const MONEY = /(?:[$￥¥€£]\s?)(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\s?(?:USD|CNY|RMB|元|美元)/gi;

/** 同一个模式,不带 /g —— 给 `.test()` 用(带 g 的 test 有状态,循环里会串)。 */
const MONEY_ONCE = new RegExp(MONEY.source, 'i');

/** 合计关键词 —— 命中的那个数优先。 */
const TOTAL_HINT = /(合计|总计|总额|应付|实付|grand\s*total|amount\s*due|total\s*due|\btotal\b)/i;
/**
 * 这附近的数一律不当合计:找零、**收现**、小费、税。
 *
 * 「收现」是把测试加强之后才发现漏的:小票上「Cash $100.00 / Change $80.00」很常见,
 * 收的现金比合计大 —— 取最大就会把 $100 当成你花的钱。
 * 只排找零、不排收现,等于白排。
 */
const NOT_TOTAL_HINT = /(找零|零钱|收现|现金|change\s*due|\bchange\b|\bcash\b|tender|tip|小费|tax|税)/i;

const DATE_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string | null]> = [
  [/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/, (m) => ymd(+m[1], +m[2], +m[3])],
  [/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/, (m) => ymd(+m[3], +m[1], +m[2])],
  [/(20\d{2})年(\d{1,2})月(\d{1,2})日/, (m) => ymd(+m[1], +m[2], +m[3])],
];

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

export interface ReceiptFields {
  /** 正数。抽不到就没有这个字段(整个函数返回 null)。 */
  amount: number;
  /** YYYY-MM-DD。抽不到就是 null —— 没日期也能配,只是配错概率大得多。 */
  date: string | null;
  /** 商户线索(第一行非空、非纯数字的文字)。可空。 */
  merchant: string | null;
  /** 这个金额是靠关键词找到的,还是靠「取最大」猜的。UI 该据此决定要不要提醒你核对。 */
  amountFrom: 'keyword' | 'largest';
}

/**
 * 从一段文字里抽发票字段。
 *
 * @param text 小票/发票的文字(OCR 出来的、PDF 里提的、或你粘的)
 */
export function extractReceiptFields(text: string): ReceiptFields | null {
  if (!text || !text.trim()) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  // ① 先找带「合计」关键词那一行上的金额
  let amount: number | null = null;
  let amountFrom: ReceiptFields['amountFrom'] = 'largest';
  for (const line of lines) {
    if (!TOTAL_HINT.test(line) || NOT_TOTAL_HINT.test(line)) continue;
    const nums = [...line.matchAll(MONEY)].map((m) => toNumber(m[1] ?? m[2])).filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length) {
      // 同一行里有多个数(「合计 3 件 $52.30」)→ 取最大的那个
      amount = Math.max(...nums);
      amountFrom = 'keyword';
      break;
    }
  }

  // ② 没关键词 → 全文取最大,但跳过找零/税/小费那几行
  if (amount == null) {
    const pool: number[] = [];
    for (const line of lines) {
      if (NOT_TOTAL_HINT.test(line)) continue;
      for (const m of line.matchAll(MONEY)) {
        const n = toNumber(m[1] ?? m[2]);
        if (Number.isFinite(n) && n > 0) pool.push(n);
      }
    }
    if (pool.length) amount = Math.max(...pool);
  }

  // 抽不到金额就返回 null —— 猜一个的代价是你认领错流水,而一笔流水只能被认领一次
  if (amount == null || !(amount > 0)) return null;

  // ③ 日期:全文第一个能解析的
  let date: string | null = null;
  for (const line of lines) {
    for (const [re, build] of DATE_PATTERNS) {
      const m = line.match(re);
      if (m) { const d = build(m); if (d) { date = d; break; } }
    }
    if (date) break;
  }

  // ④ 商户:第一行有字母/汉字、且不是纯金额的
  // ⚠️ 这里**不能**用 MONEY:它带 /g,`.test()` 会推进 lastIndex,循环里第二次调用
  // 就从半路开始匹配 —— 那种 bug 只在「第二张发票」上出现,几乎查不出来。
  // 用一份不带 g 的副本。(matchAll 不受影响,它内部用的是克隆。)
  const merchant = lines.find((l) => /[\p{L}]/u.test(l) && !MONEY_ONCE.test(l) && l.length <= 40) ?? null;

  return { amount, date, merchant, amountFrom };
}
