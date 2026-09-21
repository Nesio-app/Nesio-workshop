/**
 * 财务交易细分类规则(用户标注图 1 / 9 / 10 / 11)。
 *
 * 纯函数:给一笔流水一个「流向 + 主分类 + 细分」。bank-tx 的 txFlow /
 * effectiveCategory* 调用这里;批注覆盖仍优先。
 *
 * 口径摘要:
 *   收入 → 工资 / 金融收入 / 投资收入 / 二手转卖(Venmo) / 亚马逊返现(PayPal)
 *   转账 → 银行互转 / 信用卡还款(成对出现,两端都不进收支 KPI)
 *   基金符号(FDRXX 等)买卖 / YOU SOLD 基金赎回 → 转账,不进退款配对
 */

export type ClassifyFlow = 'expense' | 'refund' | 'rebate' | 'income' | 'transfer';

export interface ClassifyHit {
  flow: ClassifyFlow;
  category: string;
  detail: string;
  /** 为何命中(测试/调试);UI 不展示。 */
  reason: string;
}

/** 货币基金 / 核心仓符号 —— 赎回、分红、内部划转都不进退款配对。 */
export const MONEY_FUND_RE = /\b(FDRXX|SPAXX|FZFXX|SPRXX|FCASH|CORE\s*POSITION|GOVERNMENT\s+(MONEY|CASH|MONI)|FIDELITY\s+GOVERNMENT)\b/i;

/** 基金买卖描述(图 10: YOU SOLD PERSONAL WITHDRAWAL …)—— 不计收入/退款。 */
export const FUND_TRADE_RE = /YOU\s+SOLD|YOU\s+BOUGHT|PERSONAL\s+WITHDRAWAL.*FIDELITY|REDEMPTION\s+FROM\s+CORE|CONVERTED\s+TO|EXCHANGED\b/i;

const SALARY_RE = /PAYROLL|PAYF\b|DIRECT\s+DEPOSIT\s+FIDELITY\s+TEC|SALARY|WAGES|AUTOMATIC\s+PAYMENT.*PAY|DIRECT\s+DEPOSIT\s+PAYF/i;
const DIVIDEND_RE = /\bDIVIDEND\b|DIVIDEN\b|INT\s+BEARING.*DIVID/i;
const INTEREST_RE = /FDIC\s+INSURED\s+DEPOSIT|INTEREST\s+(EARNED|PAID)|INT\s+BEARING(?!.*DIVID)/i;
const REWARD_RE = /CREDIT\s*RWRD|CREDITRWRD|REWARD\s*POINT|CASH\s*BACK|CASHBACK|STATEMENT\s+CREDIT|REBATE/i;
const ATM_FEE_REBATE_RE = /ATM\s+FEE\s+REBATE|ADJUST\s+FEE\s+CHARGED.*REBATE|FEE\s+REBATE/i;
const CONTRIB_RE = /PARTIC(?:IPANT)?\s*CONTR|CONTRIBUTION|401\s*K|ROTH\s*(IRA)?|RHA\b|EMPLOYER\s+CONTR/i;
const CAP_GAIN_RE = /LONG[-\s]?TERM\s+CAP|LT\s+CAP\s+GAIN|CAPITAL\s+GAIN/i;
const VENMO_IN_RE = /\bVENMO\b/i;
const PAYPAL_IN_RE = /\bPAYPAL\b/i;
const ATM_OUT_RE = /\bATM\b|ELAN\s+WEB\s+PYMT|CASH\s+WITHDRAWAL|WITHDRAWAL\s+ATM/i;
const CC_PAY_RE = /AMEX\s+EPAYMENT|AMERICAN\s+EXPRESS.*(?:PMT|PAYMENT|EPAY)|EPAYMENT\s+ACH\s+PMT|CREDIT\s+CARD\s+PAYMENT|AUTOPAY.*(?:AMEX|CHASE|CITI|DISCOVER|CAPITAL\s+ONE)|PAYMENT\s+THANK\s+YOU/i;
const BANK_XFER_RE = /TRANSFERRED\s+(TO|FROM)|ACCOUNT\s+TRANSFER|ONLINE\s+TRANSFER|ZELLE|JPMorgan\s+Cha(?:se)?.*(?:Ext\s*)?Trnsfr|CHASE.*TRANSFER|WIRE\s+TRANSFER|ACH\s+(?:CREDIT|DEBIT).*TRANSFER/i;
const HSA_XFER_RE = /TRANSFERRED\s+FROM\s+VS|HSA\b.*TRANSFER|TRANSFER.*\bHSA\b/i;
const FIDELITY_XFER_NAME_RE = /^FIDELITY$/i;

export function isMoneyFundTx(name: string, ticker?: string): boolean {
  const blob = `${name || ''} ${ticker || ''}`;
  return MONEY_FUND_RE.test(blob);
}

export function isFundTradeTx(name: string): boolean {
  return FUND_TRADE_RE.test(name || '') || isMoneyFundTx(name);
}

/** 不应进入「退款待配对」的进账(基金赎回 / 内部划转 / 分红利息等)。 */
export const SKIP_REFUND_MATCH_RE = new RegExp(
  `(?:${MONEY_FUND_RE.source})|(?:${FUND_TRADE_RE.source})|(?:${DIVIDEND_RE.source})|(?:${INTEREST_RE.source})|(?:${CONTRIB_RE.source})|(?:REDEMPTION)|(?:DIRECT\\s+DEPOSIT\\s+CHASE\\s+CREDITRWRD)`,
  'i',
);

export function shouldSkipRefundMatch(name: string): boolean {
  return SKIP_REFUND_MATCH_RE.test(name || '');
}

/**
 * 规则命中 → 细分类。返回 null = 交给 Plaid / 默认 txFlow。
 * amount 约定与 Plaid 一致:正=流出,负=进账。
 */
export function classifyBankTx(input: {
  name?: string;
  amount: number;
  category?: string;
  categoryDetail?: string;
  accountName?: string;
  accountType?: string;
  invSubtype?: string;
}): ClassifyHit | null {
  const name = input.name || '';
  const cat = (input.category || '').toUpperCase();
  const detail = (input.categoryDetail || '').toUpperCase();
  const inv = `${input.invSubtype || ''}`.toLowerCase();
  const acct = `${input.accountName || ''} ${input.accountType || ''}`.toLowerCase();
  const inflow = input.amount < 0;
  const outflow = input.amount > 0;

  // ── 基金买卖 / 核心仓(图 3 / 10)──
  if (isFundTradeTx(name) || (inv && /buy|sell|rebalance/.test(inv) && !/dividend|interest|contribution|deposit/.test(inv))) {
    return { flow: 'transfer', category: 'TRANSFER_OUT', detail: 'TRANSFER_FUND_TRADE', reason: 'fund_trade' };
  }
  if (isMoneyFundTx(name) && /REDEMPTION|WITHDRAWAL|SOLD|CONVERTED/.test(name)) {
    return { flow: 'transfer', category: inflow ? 'TRANSFER_IN' : 'TRANSFER_OUT', detail: 'TRANSFER_FUND_TRADE', reason: 'money_fund_move' };
  }

  // ── ATM(图 9 #10)──
  if (outflow && ATM_OUT_RE.test(name) && !ATM_FEE_REBATE_RE.test(name)) {
    return { flow: 'expense', category: 'BANK_FEES', detail: 'BANK_FEES_ATM_WITHDRAWAL', reason: 'atm_out' };
  }

  // ── ATM 手续费报销(图 9 #11)──
  if (inflow && ATM_FEE_REBATE_RE.test(name)) {
    return { flow: 'income', category: 'INCOME', detail: 'INCOME_FINANCE_REBATE', reason: 'atm_fee_rebate' };
  }

  // ── 信用卡还款(图 11 #1)──
  if (CC_PAY_RE.test(name) || (/LOAN_PAYMENT|CREDIT_CARD/.test(cat) && /PMT|PAYMENT|EPAY/.test(name))) {
    return { flow: 'transfer', category: 'LOAN_PAYMENTS', detail: 'TRANSFER_CC_PAYMENT', reason: 'cc_payment' };
  }

  // ── HSA 互转(图 11 #4)──
  if (HSA_XFER_RE.test(name)) {
    return {
      flow: 'transfer',
      category: inflow ? 'TRANSFER_IN' : 'TRANSFER_OUT',
      detail: 'TRANSFER_BANK',
      reason: 'hsa_transfer',
    };
  }

  // ── 银行互转(图 11 #2/#3, Fidelity 进出储蓄卡)──
  if (BANK_XFER_RE.test(name) || FIDELITY_XFER_NAME_RE.test(name.trim())) {
    return {
      flow: 'transfer',
      category: inflow ? 'TRANSFER_IN' : 'TRANSFER_OUT',
      detail: 'TRANSFER_BANK',
      reason: 'bank_transfer',
    };
  }

  // ── 投资缴存 / 长线资本利得(图 1 投资收入)──
  if (CONTRIB_RE.test(name) || CONTRIB_RE.test(detail) || /contribution|deposit/.test(inv)) {
    if (inflow || /401|roth|hsa|rha|partic/.test(`${name} ${detail} ${acct} ${inv}`)) {
      return { flow: 'income', category: 'INCOME', detail: 'INCOME_INVEST_CONTRIB', reason: 'retirement_contrib' };
    }
  }
  if (CAP_GAIN_RE.test(name) || CAP_GAIN_RE.test(detail) || /long.?term.?cap/.test(inv)) {
    return { flow: 'income', category: 'INCOME', detail: 'INCOME_INVEST_CAP_GAIN', reason: 'cap_gain' };
  }

  // ── 进账细分 ──
  if (inflow) {
    if (SALARY_RE.test(name) || /INCOME_WAGES|INCOME_SALARY/.test(detail) || detail === 'SALARY') {
      return { flow: 'income', category: 'INCOME', detail: 'INCOME_WAGES', reason: 'salary' };
    }
    if (DIVIDEND_RE.test(name) || /DIVIDEND/.test(detail) || /dividend/.test(inv)) {
      return { flow: 'income', category: 'INCOME', detail: 'INCOME_DIVIDENDS', reason: 'dividend' };
    }
    if (INTEREST_RE.test(name) || /INTEREST/.test(detail) || /interest/.test(inv)) {
      return { flow: 'income', category: 'INCOME', detail: 'INCOME_INTEREST_EARNED', reason: 'interest' };
    }
    if (REWARD_RE.test(name)) {
      return { flow: 'income', category: 'INCOME', detail: 'INCOME_FINANCE_REWARD', reason: 'reward' };
    }
    // Venmo 转入 → 二手转卖;PayPal 转入 → 亚马逊返现(图 1 / 图 9 #12)
    if (VENMO_IN_RE.test(name) && /TRANSFER|DEPOSIT|PAYMENT|FROM/i.test(name)) {
      return { flow: 'income', category: 'INCOME', detail: 'INCOME_RESALE_VENMO', reason: 'venmo_resale' };
    }
    if (PAYPAL_IN_RE.test(name) && /TRANSFER|DEPOSIT|INST\s+XFER/i.test(name)) {
      // PayPal 流出是支出;流入按亚马逊返现
      return { flow: 'income', category: 'INCOME', detail: 'INCOME_AMZN_CASHBACK', reason: 'paypal_cashback' };
    }
    if (/INCOME/.test(cat)) {
      // 已有 INCOME 主类但细分空 → 金融收入兜底(利息/分红已在上面)
      if (!detail || detail === 'INCOME_OTHER_INCOME') {
        return { flow: 'income', category: 'INCOME', detail: 'INCOME_FINANCE_OTHER', reason: 'income_finance_fallback' };
      }
    }
  }

  // PayPal 流出
  if (outflow && PAYPAL_IN_RE.test(name) && /INST\s+XFER|TRANSFER|PAYMENT/i.test(name)) {
    return { flow: 'expense', category: 'GENERAL_MERCHANDISE', detail: 'GENERAL_MERCHANDISE_ONLINE', reason: 'paypal_out' };
  }

  return null;
}

/** 收入细分 → 三大桶(分类环形「收入」维聚合用)。 */
export type IncomeBucket = 'wages' | 'finance' | 'invest' | 'resale' | 'amzn' | 'other';

export function incomeDetailBucket(detail: string): IncomeBucket {
  const d = (detail || '').toUpperCase();
  if (d === 'INCOME_WAGES' || /SALARY|WAGE|PAYROLL/.test(d)) return 'wages';
  if (d === 'INCOME_RESALE_VENMO') return 'resale';
  if (d === 'INCOME_AMZN_CASHBACK') return 'amzn';
  if (/INVEST_CONTRIB|INVEST_CAP|RETIREMENT|401|ROTH|HSA/.test(d)) return 'invest';
  if (/DIVIDEND|INTEREST|FINANCE_REWARD|FINANCE_REBATE|FINANCE_OTHER|TAX_REFUND|REBATE|REWARD|CASHBACK/.test(d)) return 'finance';
  return 'other';
}

export const INCOME_BUCKET_LABELS: Record<IncomeBucket, [string, string]> = {
  wages: ['工资', 'Wages'],
  finance: ['金融收入', 'Financial income'],
  invest: ['投资收入', 'Investment income'],
  resale: ['二手转卖', 'Resale (Venmo)'],
  amzn: ['亚马逊返现', 'Amazon cashback'],
  other: ['其他收入', 'Other income'],
};

export const TRANSFER_DETAIL_LABELS: Record<string, [string, string]> = {
  TRANSFER_BANK: ['银行互转', 'Bank transfer'],
  TRANSFER_CC_PAYMENT: ['信用卡还款', 'Card payment'],
  TRANSFER_FUND_TRADE: ['基金划转', 'Fund move'],
};
