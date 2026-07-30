/**
 * ledger-reconcile — 对账与差额诊断的确定性核心(L2)。
 *
 * 设计依据见 docs/design/finance-ledger-plan.md 第 5、6 节。
 *
 * 这一层只回答一个问题:**「你说的数」和「我算的数」差多少,差在哪。**
 * 四种场景是同一个概念,所以这里只有一套函数:
 *
 *   银行 statement → 某账户 · 某日 · 期末余额
 *   信用卡月结单   → 某卡 · 某月 · 消费合计
 *   年终报告/1099  → 某类别 · 某年 · 合计
 *   税单           → 某科目 · 某年 · 合计
 *
 * 三条红线,每条都在下面的函数里有对应实现:
 *
 * ① **查不出的差额不许自动抹平。**(Beancount 的 `pad` 思路)差不平就是差不平,
 *    要么找出未达账项,要么记一笔**看得见的**「对账调整」分录。悄悄补一个数
 *    让它平了,是把问题埋进历史 —— 明年报税时它会带着利息回来。
 *
 * ② **不许只报「差 $X」。** 报一个差额然后让人自己去翻 PDF,等于没做。
 *    `diagnoseDelta` 必须给出:哪一行、为什么、去哪查、怎么改(已经算好)。
 *
 * ③ **凑不出精确解就不提议。** 差额与某个候选修正**完全相等**时才提议,
 *    否则只报前三步。宁可少提议,不许瞎猜 —— 一个「大概是这里」的错误建议,
 *    比没有建议更贵:人会照着改,然后账更乱。
 *
 * 全部纯函数,不碰存储、不碰 React、零 AI。金额一律换算成**分**再比,
 * 避免 0.1 + 0.2 那类浮点毛刺把差额判成非零。
 */

/** 金额换算成分。对账里所有比较都在分上做 —— 浮点数不能用 === 比。 */
export const toCents = (n: number): number => Math.round((Number(n) || 0) * 100);
export const fromCents = (c: number): number => Math.round(c) / 100;

/** 一条「有金额、有日期」的东西。分录和解析出的 statement 行都符合这个形状。 */
export interface AmountItem {
  id: string;
  /** YYYY-MM-DD(或任何可按字典序比较的 ISO 前缀)。 */
  occurredAt: string;
  /** **有符号**:流入为正,流出为负。方向由调用方在入口处统一好,这里不猜。 */
  amount: number;
  merchant?: string;
  voided?: boolean;
}

/** 你提供的那个「权威数字」。 */
export interface Assertion {
  /** balance = 期末余额(需要期初);total = 区间合计(不需要期初)。 */
  kind: 'balance' | 'total';
  periodStart: string;
  periodEnd: string;
  /** kind==='balance' 时必填。 */
  openingBalance?: number;
  /** 断言值:期末余额 或 区间合计。 */
  expected: number;
}

export interface ReconcileResult {
  /** 系统按分录算出来的数。 */
  computed: number;
  /** 你说的数。 */
  expected: number;
  /** expected − computed。正数 = 我这边少了(漏记流入/多记流出)。 */
  delta: number;
  /** 落在区间内、参与计算的条目。 */
  inPeriod: AmountItem[];
  /** 落在区间外的条目(解析自校验 B:日期跑到期间外 = 解析错行了)。 */
  outOfPeriod: AmountItem[];
  /** 差额是否为零(在分的精度上)。 */
  balanced: boolean;
}

const inRange = (d: string, start: string, end: string): boolean => d >= start && d <= end;

/**
 * 对一个断言做账。**作废的条目不计入** —— 那正是作废的意义。
 *
 * 注意 `outOfPeriod` 不是废数据:它是 statement 解析自校验 B 的产物
 * (「解析出的交易日期是否都落在 statement 期间内」)。日期跑到期间外,
 * 通常意味着解析器把上一页的表头当成了交易行,或者年份补错了。
 */
export function reconcileAssertion(items: readonly AmountItem[], a: Assertion): ReconcileResult {
  const live = items.filter((i) => i.voided !== true);
  const inPeriod = live.filter((i) => inRange(i.occurredAt, a.periodStart, a.periodEnd));
  const outOfPeriod = live.filter((i) => !inRange(i.occurredAt, a.periodStart, a.periodEnd));
  const sum = inPeriod.reduce((s, i) => s + toCents(i.amount), 0);
  const computedCents = a.kind === 'balance' ? toCents(a.openingBalance ?? 0) + sum : sum;
  const deltaCents = toCents(a.expected) - computedCents;
  return {
    computed: fromCents(computedCents),
    expected: a.expected,
    delta: fromCents(deltaCents),
    inPeriod,
    outOfPeriod,
    balanced: deltaCents === 0,
  };
}

// ── 未达账项:两边各自多了什么 ──────────────────────────────────────────────

export interface MatchPair { statement: AmountItem; ledger: AmountItem; dayGap: number }

export interface MatchResult {
  matched: MatchPair[];
  /** 只在银行有 → 我漏记了。 */
  onlyInStatement: AmountItem[];
  /** 只在我账上有 → 重复 / 记错。 */
  onlyInLedger: AmountItem[];
}

const dayGap = (a: string, b: string): number => {
  const t = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
  const d = Math.abs(t(a) - t(b));
  return Number.isFinite(d) ? Math.round(d / 86400000) : Number.POSITIVE_INFINITY;
};

/** 商户名相似度:归一化后看谁包含谁。不做模糊编辑距离 —— 那会把不同商户配到一起。 */
const merchantNorm = (s?: string): string =>
  (s || '').toUpperCase().replace(/[^A-Z0-9一-龥]+/g, '');
const merchantHit = (a?: string, b?: string): boolean => {
  const x = merchantNorm(a); const y = merchantNorm(b);
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x);
};

/**
 * 把 statement 行配到账本分录上。
 *
 * 配对判据故意保守:**金额必须分分不差**,日期在容差内。
 * 为什么不放宽金额:金额是这里唯一不会被版式/时区搅乱的东西。
 * 放宽它 → 配错 → 「已对账」标记打在错的一对上 → 后面再也查不出来。
 *
 * 日期容差默认 3 天:入账日和交易日经常差一两天(周末更久),
 * 但 Plaid 的 pending→posted 已经在 ingest 那层过滤掉了,不用为它加宽。
 *
 * 一对一贪心:先配日期最近的,商户名对得上的优先。同一条分录不会被配两次。
 *
 * ⚡ **按分金额分桶,不做全表内积。** 天真写法是两层 for 把每一行和每一条分录都
 * 比一遍;全年对账(上万条分录 × 上千行)就是上千万次迭代,在主线程上直接卡住。
 * 这个坑本仓踩过 —— 地点卡的 placeCoords 用 O(节点 × 上万点) 扫,点一下 app 就死。
 * 而金额本来就是**必须完全相等**的硬条件,拿它当桶键,内积只发生在同额条目之间。
 */
export function matchStatementRows(
  statement: readonly AmountItem[],
  ledger: readonly AmountItem[],
  opts: { dateToleranceDays?: number } = {},
): MatchResult {
  const tol = opts.dateToleranceDays ?? 3;
  const liveLedger = ledger.filter((l) => l.voided !== true);
  const byCents = new Map<number, AmountItem[]>();
  for (const l of liveLedger) {
    const k = toCents(l.amount);
    const bucket = byCents.get(k);
    if (bucket) bucket.push(l); else byCents.set(k, [l]);
  }
  const cands: Array<{ s: AmountItem; l: AmountItem; gap: number; name: boolean }> = [];
  for (const s of statement) {
    for (const l of byCents.get(toCents(s.amount)) || []) {
      const gap = dayGap(s.occurredAt, l.occurredAt);
      if (gap > tol) continue;
      cands.push({ s, l, gap, name: merchantHit(s.merchant, l.merchant) });
    }
  }
  // 商户名对得上的先配(它比日期更能区分「同一天同金额的两笔」),再按日期差。
  cands.sort((a, b) => (Number(b.name) - Number(a.name)) || (a.gap - b.gap));

  const usedS = new Set<string>(); const usedL = new Set<string>();
  const matched: MatchPair[] = [];
  for (const c of cands) {
    if (usedS.has(c.s.id) || usedL.has(c.l.id)) continue;
    usedS.add(c.s.id); usedL.add(c.l.id);
    matched.push({ statement: c.s, ledger: c.l, dayGap: c.gap });
  }
  return {
    matched,
    onlyInStatement: statement.filter((s) => !usedS.has(s.id)),
    onlyInLedger: liveLedger.filter((l) => !usedL.has(l.id)),
  };
}

// ── 差额诊断:不许只报「差 $X」 ─────────────────────────────────────────────

export type FixKind =
  | 'add_missing'      // 银行有、我没有 → 补录这一笔
  | 'void_duplicate'   // 我有、银行没有 → 这笔重复/记错,作废
  | 'reread_amount'    // 解析把金额读错了 → 按原文里的另一个数读
  | 'add_two'          // 差额恰好等于两笔之和 → 补录这两笔
  | 'none';            // 凑不出精确解 —— 不提议

export interface DeltaFix {
  kind: FixKind;
  /** 涉及的条目 id(add_two 会有两个)。 */
  targetIds: string[];
  /** 「怎么改」的机器可读参数;UI 据此渲染「就这么改」按钮。 */
  to?: number;
  /** 应用这个修正之后的差额。只有精确解才会被提议,所以恒为 0。 */
  resultingDelta: number;
}

export interface Diagnosis {
  delta: number;
  /** ① 哪里错:定位到的具体条目(可能为空 —— 那就只剩 ③ 的线索)。 */
  locus: AmountItem[];
  /** ② 为什么:命中的判据。给 UI 直接用,不让它自己编文案。 */
  reason:
    | 'balanced'
    | 'missing_in_ledger'
    | 'extra_in_ledger'
    | 'amount_misread'
    | 'missing_two'
    | 'unexplained';
  /** ③ 去哪查:相关但没配上的条目(疑似对应项)。 */
  suspects: AmountItem[];
  /** ④ 怎么改:已经算好的具体改法。凑不出精确解时 kind==='none'。 */
  fix: DeltaFix;
}

/**
 * 从一行原始文本里抠出所有像金额的数。
 * 用途:解析器把 `1,234.56` 的千分位逗号当成了列分隔、只读到 `1` 时,
 * 差额恰好是 `1234.56 - 1 = 1233.56` —— 这时能精确指出「这一行读错了」。
 */
export function amountCandidatesFromRaw(raw: string): number[] {
  const out: number[] = [];
  for (const m of raw.matchAll(/\(?\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})\s*\)?/g)) {
    const neg = m[0].includes('(');
    const v = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(v)) out.push(neg ? -v : v);
  }
  return out;
}

/**
 * 走完四步诊断。**只有精确解才提议**(红线③)。
 *
 * `rawById` 可选:传了才能诊断「金额读错」——因为那要回到 PDF 原文去找
 * 这一行里还有哪些数。没传就退化成前三种诊断,而不是瞎猜。
 */
export function diagnoseDelta(
  result: ReconcileResult,
  match: MatchResult,
  rawById: Readonly<Record<string, string>> = {},
): Diagnosis {
  const d = toCents(result.delta);
  const none: DeltaFix = { kind: 'none', targetIds: [], resultingDelta: result.delta };
  if (d === 0) {
    return { delta: 0, locus: [], reason: 'balanced', suspects: [], fix: { ...none, kind: 'none', resultingDelta: 0 } };
  }

  // ① 差额恰好等于某笔「只在银行有」的金额 → 我漏记了这一笔。
  //    补录它会让 computed 增加 amount,所以要 amount === delta。
  const missing = match.onlyInStatement.filter((s) => toCents(s.amount) === d);
  if (missing.length === 1) {
    return {
      delta: result.delta,
      locus: missing,
      reason: 'missing_in_ledger',
      suspects: match.onlyInLedger,
      fix: { kind: 'add_missing', targetIds: [missing[0].id], resultingDelta: 0 },
    };
  }

  // ② 差额恰好等于某笔「只在我账上有」的相反数 → 这笔重复/记错了。
  //    作废它会让 computed 减少 amount,所以要 amount === −delta。
  const extra = match.onlyInLedger.filter((l) => toCents(l.amount) === -d);
  if (extra.length === 1) {
    return {
      delta: result.delta,
      locus: extra,
      reason: 'extra_in_ledger',
      suspects: match.onlyInStatement,
      fix: { kind: 'void_duplicate', targetIds: [extra[0].id], resultingDelta: 0 },
    };
  }

  // ③ 差额恰好等于某一行「原文里另一个金额」与「解析出的金额」之差 → 这一行读错了。
  //
  // 扫描池就是「这次配对里出现过的 statement 行」——配上的和没配上的都要看:
  // 一行金额读错了,它照样可能凑巧配上账本里另一笔同额的。
  //
  // ⚠️ 自查笔记:我一度以为还得把 `result.inPeriod` 也塞进来(理由是解析器自校验
  // 那一场被求和的是行本身)。反证过 —— **不需要**:那一场的行同样会出现在
  // onlyInStatement 里(它们配不上任何账本分录),塞了等于白塞;而真正的对账场里
  // inPeriod 是账本分录,根本没有 PDF 原文可查。别再加回去。
  for (const s of [...match.onlyInStatement, ...match.matched.map((m) => m.statement)]) {
    const raw = rawById[s.id];
    if (!raw) continue;
    for (const mag of amountCandidatesFromRaw(raw)) {
      // 读错的是**数字**,不是方向 —— 方向来自列位置/括号/CR-DR,是另一套判据。
      // 所以候选值先沿用这一行已判定的方向;原文里自带符号的(括号负数)再按原样试一次。
      const signed = (s.amount < 0 ? -1 : 1) * Math.abs(mag);
      const tries = signed === mag ? [signed] : [signed, mag];
      for (const cand of tries) {
        if (toCents(cand) - toCents(s.amount) === d) {
          return {
            delta: result.delta,
            locus: [s],
            reason: 'amount_misread',
            suspects: match.onlyInLedger,
            fix: { kind: 'reread_amount', targetIds: [s.id], to: cand, resultingDelta: 0 },
          };
        }
      }
    }
  }

  // ④ 差额恰好等于两笔「只在银行有」之和 → 这两笔都漏了。
  //    只在候选不多时才做两两枚举 —— 上百条时组合爆炸,而且巧合配对的概率
  //    随规模上升,配出来的「精确解」反而不可信。
  const pool = match.onlyInStatement;
  if (pool.length >= 2 && pool.length <= 40) {
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (toCents(pool[i].amount) + toCents(pool[j].amount) === d) {
          return {
            delta: result.delta,
            locus: [pool[i], pool[j]],
            reason: 'missing_two',
            suspects: match.onlyInLedger,
            fix: { kind: 'add_two', targetIds: [pool[i].id, pool[j].id], resultingDelta: 0 },
          };
        }
      }
    }
  }

  // 凑不出精确解:只报前三步,不提议。这不是失败 —— 报「我查到这些线索但不确定」
  // 比报一个错的建议诚实得多。人照着错建议改,账会更乱。
  return {
    delta: result.delta,
    locus: [],
    reason: 'unexplained',
    suspects: [...match.onlyInStatement, ...match.onlyInLedger],
    fix: none,
  };
}

// ── 查不出的差额:记一笔看得见的调整 ────────────────────────────────────────

export const RECONCILE_ADJUSTMENT_MERCHANT = '对账调整';

/**
 * 差额查不出时的**唯一**正当处置:记一笔看得见的调整分录(Beancount `pad` 思路)。
 *
 * 它是一条**真的分录**,不是一个隐藏的修正系数 —— 会出现在交易列表里、
 * 会进合计、能被点开看到「这是 2026-07 对账时查不出的 $3.20」。
 *
 * 返回 null 的情况:差额为 0(没什么可调的)。调用方必须显式处理,
 * 不许「反正返回了个对象就写进去」——那会在平账的月份也塞一条 $0 的噪音。
 *
 * 返回的是**候选属性**,不是完整分录:`direction` / `currency` / `accountId`
 * 由写入层按该账户补齐(方向可从 amount 的符号推出)。这一层不碰存储,
 * 也就不该假装知道账户是哪一个。
 */
export function reconciliationAdjustment(
  result: ReconcileResult,
  periodEnd: string,
  note: string,
): { amount: number; occurredAt: string; merchant: string; note: string; ledgerSource: string } | null {
  if (toCents(result.delta) === 0) return null;
  return {
    // 调整额 = 差额本身:加上它之后 computed 就等于 expected。
    amount: result.delta,
    occurredAt: periodEnd,
    merchant: RECONCILE_ADJUSTMENT_MERCHANT,
    note,
    ledgerSource: 'reconcile',
  };
}

/**
 * 对账能不能就此打「已对账」并锁定该期间。
 *
 * `clean`      差额为零且没有跑到期间外的条目 → 可以锁。
 * `adjustable` 差额不为零但已诊断出精确解或已记调整 → 由人决定。
 * `attention`  有条目落在期间外 → **先别锁**:这通常是解析错行,
 *              锁了之后错的日期就固化进已关账期间,再改要走冲正。
 */
export function reconcileVerdict(result: ReconcileResult): 'clean' | 'adjustable' | 'attention' {
  if (result.outOfPeriod.length) return 'attention';
  return result.balanced ? 'clean' : 'adjustable';
}
