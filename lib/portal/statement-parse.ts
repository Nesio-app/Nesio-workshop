/**
 * statement-parse — 银行/信用卡 statement 的确定性解析(L3 · S1)。
 *
 * 设计依据见 docs/design/finance-ledger-plan.md 第 6 节。
 *
 * ⚠️ **解析器永远不直接写账。它只产出「候选行」,进对账台,由你确认。**
 * 银行 PDF 版式千变万化,解析必然有错。错了不能污染账本 —— 只能停在候选区。
 * 这也让「发现逻辑问题立刻改」成立:重新解析同一个文件,候选重算,账本不受影响。
 *
 * 零 AI,全部正则 + 结构:
 *   · **可复现** —— 同一个文件永远解析出同样结果,改了规则能立刻验证
 *   · **可解释** —— 每个候选行能指回「第几页第几行」+ 原始文本
 *   · **免费** —— 符合「免费 = 端上/确定性」的产品红线
 *   · **隐私** —— statement 是最敏感的文件之一,不出设备
 *
 * 这一层是纯函数:吃 `PdfLine[]`(pdfjs-loader 的 groupItemsIntoRows 产物),
 * 吐候选行 + 三条自校验。真的取文本层在调用方(浏览器端)。
 *
 * 三条自校验是这里最关键的设计,比任何「置信度分数」都硬:
 *   A. 期初余额 + Σ(解析出的交易) = 期末余额?
 *   B. 解析出的交易日期是否都落在 statement 期间内?
 *   C. 交易笔数 vs 页面上写的「N transactions」(若有)?
 * **A 不成立 = 解析漏了或多了**,而不是把错的东西塞进账本。
 */

import type { PdfLine } from './pdfjs-loader';

// ── 金额 ────────────────────────────────────────────────────────────────────

/** 一个金额 token 及其在行内的 x —— 方向判定要靠列位置。 */
export interface AmountToken { x: number; value: number; text: string; explicitSign: boolean }

const AMOUNT_RE = /^\(?-?\$?\s*(\d{1,3}(?:,\d{3})*|\d+)(\.\d{2})\s*\)?-?$/;

/**
 * 把一个 token 解析成金额。**必须带两位小数** —— 这是最重要的一条限制:
 * 不要求小数的话,日期里的 `07`、卡号尾号 `2K4LM` 里的数、页码 `3`
 * 全会被当成金额,一份 statement 能解析出几百笔不存在的交易。
 *
 * 认得:`1,234.56` / `$1,234.56` / `(1,234.56)` 括号负 / `1,234.56-` 尾随负 / `-1,234.56`
 * 借贷标记(CR/DR)不在 token 里,由 `parseAmountCell` 连着相邻 token 一起看。
 */
export function parseAmountToken(raw: string): { value: number; explicitSign: boolean } | null {
  const s = raw.trim();
  const m = AMOUNT_RE.exec(s);
  if (!m) return null;
  // 两位小数这条限制**同时**由正则的 (\.\d{2}) 和下面这个 isFinite 守住:
  // 把小数组改成可选的话,`${m[1]}${undefined}` 会变成 "07undefined" → NaN → 这里挡下。
  // 自查反证过 —— 单独放宽正则不改变行为,要真放进整元金额得把两处一起改
  // (那时 ①b 立刻转红)。别把任何一处当唯一防线。
  const digits = Number(`${m[1].replace(/,/g, '')}${m[2]}`);
  if (!Number.isFinite(digits)) return null;
  const neg = s.startsWith('(') || s.startsWith('-') || s.endsWith('-');
  return { value: neg ? -digits : digits, explicitSign: neg };
}

/** 抽出一行里所有金额 token(带 x)。CR/DR 后缀会翻转符号。 */
export function amountTokensOfLine(line: PdfLine): AmountToken[] {
  const out: AmountToken[] = [];
  for (let i = 0; i < line.cells.length; i++) {
    const cell = line.cells[i];
    // pdf.js 常把 `1,234.56 CR` 拆成两块,也可能在一块里。两种都吃。
    const inline = /^(.*?)\s*(CR|DR)$/i.exec(cell.text);
    const body = inline ? inline[1] : cell.text;
    const parsed = parseAmountToken(body);
    if (!parsed) continue;
    let mark = inline?.[2];
    if (!mark) {
      const next = line.cells[i + 1]?.text;
      if (next && /^(CR|DR)$/i.test(next)) mark = next;
    }
    let value = parsed.value;
    let explicitSign = parsed.explicitSign;
    if (mark) {
      // CR = credit(进账),DR = debit(出账)。有标记就以标记为准 —— 它比列位置可靠。
      value = Math.abs(value) * (/^CR$/i.test(mark) ? 1 : -1);
      explicitSign = true;
    }
    out.push({ x: cell.x, value, text: cell.text, explicitSign });
  }
  return out;
}

// ── 日期 ────────────────────────────────────────────────────────────────────

const MONTHS: Readonly<Record<string, number>> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
const isRealDate = (y: number, m: number, d: number): boolean => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * 解析一个日期 token。支持 `MM/DD`、`MM/DD/YY(YY)`、`YYYY-MM-DD`、`DD MMM YYYY`、`MMM DD`。
 *
 * `fallbackYear` 是**必需**的:美国 statement 的交易行常常只印 `07/12`,没有年份。
 * 拿「今天的年份」去补会在一月读十二月的单子时全错一年,所以年份必须来自
 * **statement 自己的期间**(见 `extractHeader`),而不是系统时间。
 *
 * 跨年 statement(12/28–01/03)在这里也处理:月份比期间结束月大很多时按上一年算。
 */
export function parseDateToken(
  raw: string,
  fallbackYear: number,
  periodEndMonth?: number,
): string | null {
  const s = raw.trim().toUpperCase();

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isRealDate(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }

  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s);
  if (m) {
    const mo = Number(m[1]); const d = Number(m[2]);
    let y = fallbackYear;
    if (m[3]) y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    else if (periodEndMonth !== undefined && mo > periodEndMonth + 1) y = fallbackYear - 1;
    return isRealDate(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }

  m = /^(\d{1,2})\s*([A-Z]{3})[A-Z]*\.?\s*(\d{4})?$/.exec(s);
  if (m && MONTHS[m[2]]) {
    const y = m[3] ? Number(m[3]) : fallbackYear;
    return isRealDate(y, MONTHS[m[2]], Number(m[1])) ? `${y}-${pad2(MONTHS[m[2]])}-${pad2(Number(m[1]))}` : null;
  }

  m = /^([A-Z]{3})[A-Z]*\.?\s*(\d{1,2})(?:,?\s*(\d{4}))?$/.exec(s);
  if (m && MONTHS[m[1]]) {
    const y = m[3] ? Number(m[3]) : fallbackYear;
    return isRealDate(y, MONTHS[m[1]], Number(m[2])) ? `${y}-${pad2(MONTHS[m[1]])}-${pad2(Number(m[2]))}` : null;
  }
  return null;
}

/** 从行首找日期。交易行的日期几乎总在最左边 —— 在行中间乱找会把描述里的数字当日期。 */
function leadingDate(line: PdfLine, year: number, endMonth?: number): { iso: string; consumed: number } | null {
  // 前两块拼起来也试一次:`07` `/12` 或 `JUL` `12` 常被 pdf.js 拆开。
  for (const take of [1, 2]) {
    const chunk = line.cells.slice(0, take).map((c) => c.text).join(' ');
    const iso = parseDateToken(chunk, year, endMonth);
    if (iso) return { iso, consumed: take };
  }
  return null;
}

// ── 页眉锚点 ────────────────────────────────────────────────────────────────

export interface StatementHeader {
  /** 账户尾号(4 位)。用来确认「这张单是哪个账户的」,不是猜。 */
  accountTail?: string;
  periodStart?: string;
  periodEnd?: string;
  openingBalance?: number;
  closingBalance?: number;
  /** 单子上自己印的交易笔数(有些银行有)。自校验 C 用。 */
  txCountClaimed?: number;
}

const OPENING_RE = /(BEGINNING|OPENING|PREVIOUS)\s+(BALANCE|STATEMENT\s+BALANCE)|期初(余额)?|上期余额/i;
const CLOSING_RE = /(ENDING|CLOSING|NEW)\s+(BALANCE|STATEMENT\s+BALANCE)|期末(余额)?|本期余额/i;

/**
 * 从整份文档里抽页眉锚点。这一步决定了后面所有交易行的年份,所以宁可抽不到
 * (返回 undefined,让调用方要求人工填),也不要猜错 —— 猜错年份 = 整份单子日期全错。
 */
export function extractHeader(lines: readonly PdfLine[]): StatementHeader {
  const h: StatementHeader = {};
  for (const line of lines) {
    const t = line.text;

    if (!h.accountTail) {
      const m = /(?:ACCOUNT|ACCT|CARD)[^\n]{0,24}?(?:\*{2,}|x{4,}|·{2,}|\s)(\d{4})\b/i.exec(t);
      if (m) h.accountTail = m[1];
    }

    if (!h.periodStart || !h.periodEnd) {
      // 「07/01/2026 - 07/31/2026」/「July 1, 2026 through July 31, 2026」/「2026-07-01 至 2026-07-31」
      const m = /([A-Za-z]{3,9}\.?\s*\d{1,2},?\s*\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})\s*(?:-|–|—|through|thru|to|至|~)\s*([A-Za-z]{3,9}\.?\s*\d{1,2},?\s*\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(t);
      if (m) {
        // 期间行自带四位年份,所以 fallbackYear 传什么都不影响 —— 传 0 让「没年份就解析失败」
        // 而不是被悄悄补上一个错的年。
        const a = parseDateToken(m[1], 0);
        const b = parseDateToken(m[2], 0);
        if (a && b && a <= b) { h.periodStart = a; h.periodEnd = b; }
      }
    }

    // 期初取行内**第一个**金额、期末取**最后一个** —— 有些单子把
    // 「Beginning Balance 1,000.00   Ending Balance 2,000.00」印在同一行,
    // 两个都用 pop() 的话期初会被读成期末,自校验 A 直接失效(而且看起来还很合理)。
    if (h.openingBalance === undefined && OPENING_RE.test(t)) {
      const amt = amountTokensOfLine(line)[0];
      if (amt) h.openingBalance = amt.value;
    }
    if (h.closingBalance === undefined && CLOSING_RE.test(t)) {
      const amt = amountTokensOfLine(line).pop();
      if (amt) h.closingBalance = amt.value;
    }
    if (h.txCountClaimed === undefined) {
      const m = /\b(\d{1,4})\s+(?:transactions?|items?)\b|共\s*(\d{1,4})\s*笔/i.exec(t);
      if (m) h.txCountClaimed = Number(m[1] ?? m[2]);
    }
  }
  return h;
}

// ── 候选行 ──────────────────────────────────────────────────────────────────

export interface CandidateTx {
  /** 稳定 id:同一个文件重新解析得到同样的 id(诊断要用它指回原文)。 */
  id: string;
  page: number;
  line: number;
  /** 原始视觉行文本 —— 诊断第①步「哪里错」直接展示这个。 */
  raw: string;
  occurredAt: string;
  description: string;
  /** 有符号:流入为正,流出为负。 */
  amount: number;
  /**
   * 这一行的方向是怎么定的 —— 让人能判断该不该信。从强到弱:
   *   explicit_sign    单子自己写了符号(括号 / 负号 / CR / DR)
   *   running_balance  和当日余额列对得上(上一行余额 ± 本行金额 = 本行余额)
   *   column           落在哪个金额列(借列 / 贷列)
   *   account_default  以上都没有,只能按账户类型默认 —— **最弱**
   */
  directionBasis: 'explicit_sign' | 'running_balance' | 'column' | 'account_default';
}

export interface StatementParseResult {
  header: StatementHeader;
  rows: CandidateTx[];
  /** 认不出来的行。**不是丢弃** —— 要能给人看,否则「漏了一笔」永远查不出来。 */
  skipped: Array<{ page: number; line: number; raw: string; why: string }>;
  selfCheck: SelfCheck;
  /**
   * 页眉里没有 statement 期间、调用方也没给年份 —— 交易行上只印「07/12」,
   * 补哪一年无从得知,所以一行都没解析。
   *
   * 这必须和「扫描件没有文字层」分开报:两者都是「0 笔」,但处置完全不同 ——
   * 一个是让人填个年份(一秒钟),一个是要走 OCR。混成一句「解析不出来」,
   * 人会以为自己的单子不被支持,直接放弃。
   */
  needsYear: boolean;
}

export interface SelfCheck {
  /** A:期初 + Σ交易 = 期末。 */
  balance: 'pass' | 'fail' | 'unknown';
  balanceDelta?: number;
  /** B:日期都在期间内。 */
  period: 'pass' | 'fail' | 'unknown';
  outOfPeriod: CandidateTx[];
  /** C:笔数对得上。 */
  count: 'pass' | 'fail' | 'unknown';
  countClaimed?: number;
  countParsed: number;
}

export interface ParseOptions {
  /**
   * 账户类型。决定「一行只有一个没有符号的金额」时算流入还是流出:
   * 信用卡上裸金额通常是消费(流出),储蓄/支票账户没有这个默认 —— 只能靠列位置。
   */
  accountKind?: 'credit_card' | 'depository';
  /** 页眉抽不到期间时由人填的年份。抽得到就用抽到的,不用这个。 */
  fallbackYear?: number;
}

const roundCents = (n: number): number => Math.round(n * 100) / 100;

/**
 * 解析一份 statement 的所有页。
 *
 * @param pages 每页的行(pdfjs-loader 的 groupItemsIntoRows 产物),按页顺序。
 */
export function parseStatement(
  pages: readonly (readonly PdfLine[])[],
  opts: ParseOptions = {},
): StatementParseResult {
  const allLines = pages.flat();
  const header = extractHeader(allLines);
  const year = header.periodEnd
    ? Number(header.periodEnd.slice(0, 4))
    : (opts.fallbackYear ?? 0);
  // 「月份比期末月大 → 算上一年」这条只对**真的跨年**的单子成立
  // (12/28–01/03 那种)。对 07/01–07/31 的单子用它,一笔 09/09 的错行日期
  // 会被悄悄改成去年,自校验 B 报出来的期间外条目也就指错了年。
  // 所以只有 periodStart 和 periodEnd 不同年时才把 endMonth 传下去。
  const spansYear = !!header.periodStart && !!header.periodEnd
    && header.periodStart.slice(0, 4) !== header.periodEnd.slice(0, 4);
  const endMonth = spansYear ? Number(header.periodEnd!.slice(5, 7)) : undefined;

  // 先扫一遍所有「日期开头的行」,统计金额出现的 x,聚成列。
  // 这一步是版式无关的关键:不知道这家银行的列宽,但知道**同一列的金额 x 相近**。
  // ⚡ 每行的金额 token **只算一次**。天真写法是在挑金额时再调一次 amountTokensOfLine,
  // 而挑金额又要知道全篇的金额列 —— 那就成了 O(行数²),几十页的单子直接卡住。
  // (L2 的配对刚踩过同一个坑,地点卡更早踩过一次。)
  interface Dated { page: number; line: number; l: PdfLine; iso: string; consumed: number; tokens: AmountToken[] }
  const dated: Dated[] = [];
  const skipped: StatementParseResult['skipped'] = [];
  for (let p = 0; p < pages.length; p++) {
    const lines = pages[p];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const d = year > 0 ? leadingDate(l, year, endMonth) : null;
      if (!d) continue;
      const tokens = amountTokensOfLine(l);
      if (!tokens.length) {
        skipped.push({ page: p + 1, line: i + 1, raw: l.text, why: 'no_amount' });
        continue;
      }
      dated.push({ page: p + 1, line: i + 1, l, iso: d.iso, consumed: d.consumed, tokens });
    }
  }

  const balance = detectRunningBalance(dated, header.openingBalance);
  const columns = amountColumns(dated);

  const rows: CandidateTx[] = [];
  for (let di = 0; di < dated.length; di++) {
    const d = dated[di];
    const tokens = d.tokens
      .filter((t) => !balance || Math.abs(t.x - balance.x) > 4);
    if (!tokens.length) {
      skipped.push({ page: d.page, line: d.line, raw: d.l.text, why: 'only_balance_column' });
      continue;
    }
    if (tokens.length > 1) {
      // 去掉余额列之后还剩不止一个金额 —— 分不出哪个是交易额。
      // 与其猜(猜错就是一笔假账),不如摆到「认不出来」里让人看。
      skipped.push({ page: d.page, line: d.line, raw: d.l.text, why: 'ambiguous_amounts' });
      continue;
    }

    const { amount, basis } = pickAmount(tokens[0], columns, balance?.signByRow.get(di), opts.accountKind);
    const description = d.l.cells
      .slice(d.consumed)
      // 过滤要用 **d.tokens**(这一行全部金额)而不是 tokens(已剔掉余额列的那批)——
      // 否则当日余额那个数字会留在描述里,变成「RENT 900.00」。
      .filter((c) => !d.tokens.some((t) => t.x === c.x) && !/^(CR|DR)$/i.test(c.text))
      .map((c) => c.text)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    rows.push({
      id: `p${d.page}:l${d.line}`,
      page: d.page,
      line: d.line,
      raw: d.l.text,
      occurredAt: d.iso,
      description,
      amount: roundCents(amount),
      directionBasis: basis,
    });
  }

  return {
    header, rows, skipped,
    selfCheck: selfCheckStatement(header, rows),
    needsYear: year <= 0,
  };
}

/**
 * 找出「当日余额」列,**并顺带确定每一行的方向**。
 *
 * 很多 statement 每行右侧印一个 running balance。把它当成交易额的话**整份单子全错**,
 * 而且错得不显眼(金额都是真数字,只是意思不对)。
 *
 * 判据是结构性的、可验证的:取最右侧那一列,看它是否满足
 * `上一行余额 ± 本行交易额 = 本行余额`。满足的行占多数才认 —— 不靠「最右边就是余额」
 * 这种版式假设,那对只有一个金额列的单子会误杀。
 *
 * ⚠️ 关键:验证时**加和减各试一次**,命中的那个同时回答了两个问题 ——
 * 「这一列是余额」和「这一行是进还是出」。第一版把后半个答案扔了,于是一份
 * 「单金额列 + 余额列」的单子(最常见的支票账户版式)里,存入和支出全被判成同一个方向。
 * 余额列是这里能拿到的**第二强**的方向证据(仅次于单子自己写的符号),不能浪费。
 */
interface RunningBalance { x: number; signByRow: Map<number, 1 | -1> }

function detectRunningBalance(
  dated: ReadonlyArray<{ tokens: readonly AmountToken[] }>,
  opening?: number,
): RunningBalance | null {
  if (opening === undefined || dated.length < 3) return null;
  const rightmost: number[] = [];
  for (const d of dated) {
    if (d.tokens.length >= 2) rightmost.push(d.tokens[d.tokens.length - 1].x);
  }
  if (rightmost.length < Math.max(3, dated.length * 0.6)) return null;
  const x = rightmost.sort((a, b) => a - b)[Math.floor(rightmost.length / 2)];

  let running = Math.round(opening * 100);
  let hit = 0; let seen = 0;
  const signByRow = new Map<number, 1 | -1>();
  for (let i = 0; i < dated.length; i++) {
    const d = dated[i];
    const bal = d.tokens.find((t) => Math.abs(t.x - x) <= 4);
    const tx = d.tokens.filter((t) => Math.abs(t.x - x) > 4);
    if (!bal || tx.length !== 1) continue;
    seen += 1;
    for (const sign of [1, -1] as const) {
      if (running + sign * Math.round(Math.abs(tx[0].value) * 100) === Math.round(bal.value * 100)) {
        hit += 1;
        signByRow.set(i, sign);
        running = Math.round(bal.value * 100);
        break;
      }
    }
  }
  return seen >= 3 && hit >= seen * 0.8 ? { x, signByRow } : null;
}

/** 给一个裸金额定方向。 */
function pickAmount(
  token: AmountToken,
  columns: readonly number[],
  balanceSign: 1 | -1 | undefined,
  accountKind?: ParseOptions['accountKind'],
): { amount: number; basis: CandidateTx['directionBasis'] } {
  // 单子自己写了符号(括号/负号/CR/DR)—— 以它为准,这比任何推断都可靠。
  if (token.explicitSign) return { amount: token.value, basis: 'explicit_sign' };

  // 余额列验过的方向:上一行余额 ± 这笔 = 这一行余额,只有一个符号对得上。
  // 这不是推断,是算出来的。
  if (balanceSign) return { amount: balanceSign * Math.abs(token.value), basis: 'running_balance' };

  // 借/贷两列的单子:金额落在哪一列就是哪个方向。左列出账是通行排法。
  // 这是**推断**,所以如实标进 directionBasis,让人一眼看出该不该信。
  if (columns.length >= 2) {
    const idx = columns.findIndex((c) => Math.abs(c - token.x) <= 4);
    if (idx >= 0) return { amount: (idx === 0 ? -1 : 1) * Math.abs(token.value), basis: 'column' };
  }

  // 全篇只有一个金额列 —— 列位置提供不了任何信息,只能用账户类型的默认
  // (信用卡上的裸金额是消费 = 流出)。这是最弱的判据,标出来。
  const sign = accountKind === 'credit_card' ? -1 : 1;
  return { amount: sign * Math.abs(token.value), basis: 'account_default' };
}

/** 把全篇金额的 x 聚成列(容差 4pt)。 */
function amountColumns(dated: ReadonlyArray<{ tokens: readonly AmountToken[] }>): number[] {
  const xs: number[] = [];
  for (const d of dated) for (const t of d.tokens) xs.push(t.x);
  xs.sort((a, b) => a - b);
  const cols: number[] = [];
  for (const x of xs) {
    if (!cols.length || Math.abs(cols[cols.length - 1] - x) > 4) cols.push(x);
  }
  return cols;
}

/**
 * 三条自校验。**这比任何置信度分数都硬** —— 它不是「我觉得我对」,
 * 而是「单子自己印的数和我算的数对不对得上」。
 *
 * 抽不到锚点时返回 `unknown` 而不是 `pass`:没检查过就不能说通过。
 * 这条区别很要紧 —— `pass` 会让人直接点「全部接受」。
 */
export function selfCheckStatement(header: StatementHeader, rows: readonly CandidateTx[]): SelfCheck {
  const sum = rows.reduce((s, r) => s + Math.round(r.amount * 100), 0);

  let balance: SelfCheck['balance'] = 'unknown';
  let balanceDelta: number | undefined;
  if (header.openingBalance !== undefined && header.closingBalance !== undefined) {
    const d = Math.round(header.closingBalance * 100) - (Math.round(header.openingBalance * 100) + sum);
    balanceDelta = roundCents(d / 100);
    balance = d === 0 ? 'pass' : 'fail';
  }

  let period: SelfCheck['period'] = 'unknown';
  let outOfPeriod: CandidateTx[] = [];
  if (header.periodStart && header.periodEnd) {
    outOfPeriod = rows.filter((r) => r.occurredAt < header.periodStart! || r.occurredAt > header.periodEnd!);
    period = outOfPeriod.length ? 'fail' : 'pass';
  }

  let count: SelfCheck['count'] = 'unknown';
  if (header.txCountClaimed !== undefined) {
    count = header.txCountClaimed === rows.length ? 'pass' : 'fail';
  }

  return {
    balance, balanceDelta, period, outOfPeriod,
    count, countClaimed: header.txCountClaimed, countParsed: rows.length,
  };
}

/**
 * 这份解析能不能进对账台。
 *
 * `ready`     三条自校验没有一条 fail(unknown 允许 —— 有些单子就是没印期初余额)
 * `review`    有 fail —— 先让人看差在哪,**不许一键全部接受**
 * `need_year` 只差一个年份。**不要报成 unusable** —— 那会让人以为自己的单子
 *             根本不被支持而放弃,实际上填一个年份就好了
 * `unusable`  一条都没解析出来(多半是扫描件,没有文字层)
 */
export function parseVerdict(r: StatementParseResult): 'ready' | 'review' | 'need_year' | 'unusable' {
  if (r.needsYear) return 'need_year';
  if (!r.rows.length) return 'unusable';
  const c = r.selfCheck;
  return (c.balance === 'fail' || c.period === 'fail' || c.count === 'fail') ? 'review' : 'ready';
}
