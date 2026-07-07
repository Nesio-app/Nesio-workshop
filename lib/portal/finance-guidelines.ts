/**
 * 财务指南语料库 + 检索(财务⑮,对标 health-guidelines):
 * 策展的通行标准要点,按 finding/score 的 id 前缀做主题键检索(非向量,可审计),
 * 注入「问一问」的 <guidelines> 块让 AI 引用真出处而非编造。纯函数、无网络。
 */

export interface FinanceGuidelineSnippet {
  topic: string;            // 与 finding/score 的 id 前缀对应
  text: [string, string];   // [zh, en]
  source: string;
  url: string;
}

const CORPUS: FinanceGuidelineSnippet[] = [
  {
    topic: 'finance-score-emergency-fund',
    text: ['通行共识:应急金以 3–6 个月生活支出为参考目标;从一个小目标(如 $500)起步也有效。', 'Common guideline: aim for 3–6 months of living expenses in emergency savings; starting with a small goal (e.g. $500) works too.'],
    source: 'Fidelity Viewpoints / St. Louis Fed Page One Economics', url: 'https://www.fidelity.com/viewpoints/personal-finance/save-for-an-emergency',
  },
  {
    topic: 'finance-score-savings-rate',
    text: ['50/30/20 法则:约 50% 收入用于必需、30% 用于想要、20% 归储蓄与还债;20% 是储蓄率的常用参考线。', 'The 50/30/20 rule: ~50% needs, 30% wants, 20% savings & debt paydown; 20% is the common savings-rate reference.'],
    source: 'NerdWallet(50/30/20 budget rule)', url: 'https://www.nerdwallet.com/article/finance/nerdwallet-budget-calculator',
  },
  {
    topic: 'finance-score-subscription-load',
    text: ['订阅审计实践:定期盘点全部订阅(月化后合计),占收入比例过高(如 >10%)时优先取消不再使用的。', 'Subscription audit practice: periodically monthly-ize all recurring charges; if they exceed ~10% of income, cancel unused ones first.'],
    source: '订阅管理实践(Rocket Money 口径,策展)', url: 'https://help.rocketmoney.com/en/articles/2185531-managing-your-bills-and-subscriptions',
  },
  {
    topic: 'finance-cat-drift',
    text: ['对个人历史基线的稳健偏离(median/MAD,modified z-score ≈3.5 为阈)比「环比百分比」更能区分真实异常与正常波动。', 'Robust deviation vs your own baseline (median/MAD, modified z-score threshold ≈3.5) separates real anomalies from normal variance better than raw percent change.'],
    source: '稳健统计异常检测惯例(modified z-score)', url: 'https://www.apriorit.com/dev-blog/anomaly-detection-with-statistical-methods',
  },
  {
    topic: 'finance-fee-audit',
    text: ['多数银行费用(透支/ATM/月费)可通过一次客服申请减免或改变习惯避免;灰色费用对受影响用户年均约 $350。', 'Most bank fees (overdraft/ATM/monthly) can be waived on request or avoided; gray charges average ~$350/yr for affected users.'],
    source: 'BillGuard 灰色费用研究(回顾)', url: 'https://www.debt.org/credit/cards/grey-charges/',
  },
  {
    topic: 'finance-new-recur',
    text: ['免费试用自动转付费是最常见的灰色扣费:新出现的定期扣款值得在前 1–2 期内确认是否知情。', 'Free trials auto-converting to paid are the most common gray charge: verify any newly matured recurring charge within its first cycles.'],
    source: '订阅试用转付费(FTC/消费者实践)', url: 'https://finhelp.io/glossary/understanding-your-rights-with-subscription-trial-scams/',
  },
  {
    topic: 'finance-hike',
    text: ['订阅价格常以小步慢涨(cost creep)方式上调;对定期扣款做金额基线比对可在第一期涨价时发现。', 'Subscription prices often rise in small increments (cost creep); baselining recurring amounts catches the first raised cycle.'],
    source: 'BillGuard cost-creep 检测(回顾)', url: 'https://www.finextra.com/blogposting/8303/11-types-of-grey-charges',
  },
  {
    topic: 'finance-balance-risk',
    text: ['直接法现金流预测:用已知的账单流出与发薪流入逐日滚动余额,能提前发现「余额不够账单」的日期并提前挪款。', 'Direct-method cash forecasting rolls known bill outflows and payroll inflows daily to surface the date balance falls short — in time to move funds.'],
    source: '直接法现金流预测(通行做法)', url: 'https://ramp.com/blog/business-banking/cash-flow-projection',
  },
  {
    topic: 'finance-savings-rate',
    text: ['连续入不敷出优先从单一类目温和调整,比全面紧缩更可持续;50/30/20 可作分配参考。', 'For sustained overspend, trimming one category gently is more sustainable than across-the-board cuts; 50/30/20 is a useful allocation reference.'],
    source: 'NerdWallet(50/30/20 budget rule)', url: 'https://www.nerdwallet.com/article/finance/nerdwallet-budget-calculator',
  },
];

/** 按 finding/score id(或其前缀)检索指南要点;一个主题只回第一条,保持注入紧凑。 */
export function findFinanceGuidelines(topics: string[]): FinanceGuidelineSnippet[] {
  const out: FinanceGuidelineSnippet[] = [];
  const seen = new Set<string>();
  for (const t of topics) {
    const hit = CORPUS.find((c) => t.startsWith(c.topic));
    if (hit && !seen.has(hit.topic)) { seen.add(hit.topic); out.push(hit); }
  }
  return out;
}
