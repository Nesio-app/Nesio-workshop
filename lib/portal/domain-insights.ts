/**
 * 统一域洞察读出口(v0)—— 各输出面(问一问 / 简报 / Today)从这一处取「当前健康/财务判定」,
 * 而不是各自回底层数据重算。是 docs/design/system-layers.md「Cross-Insight Reader」的务实雏形:
 * 先把「谁在算洞察」收成一处,再谈跨层 JOIN。
 *
 * 目前汇聚:健康(②模式 evaluateHealthFindings + ③风险 computeRiskScores)、
 * 财务(异常支出/订阅涨价/现金流/未来账单 financeFindings)。
 * 新增一个域 = 在 gatherDomainInsights 里加一个 try 分支(该域数据缺失不影响其余)。
 *
 * 纯读、确定性、local-first;不落库(findings 是即时派生)。
 */
import { loadHealthMetrics } from './health-store';
import { evaluateHealthFindings } from './health-clinical';
import { computeRiskScores } from './health-risk';
import { loadBankTx, loadBankAccounts } from './bank-tx';
import { financeFindings } from './finance-insight';

export type InsightDomain = 'health' | 'finance';
export type InsightSeverity = 'flag' | 'attention';

export interface DomainInsight {
  domain: InsightDomain;
  severity: InsightSeverity;
  title: string;   // zh(检索/叙事用)
  detail: string;  // zh(带出处)
}

/** 汇聚当前所有域的「值得提示」判定(红旗/可关注),红旗优先。达标/正常项不收。 */
export function gatherDomainInsights(): DomainInsight[] {
  const out: DomainInsight[] = [];

  // 健康:②模式 + ③风险
  try {
    const hm = loadHealthMetrics();
    if (hm) {
      for (const f of evaluateHealthFindings({ glucose: hm.glucose, sleepStages: hm.sleepStages, metrics: hm.metrics })) {
        if (f.severity === 'flag' || f.severity === 'attention') {
          out.push({ domain: 'health', severity: f.severity, title: f.title[0], detail: `${f.detail[0]} · 依据 ${f.source}` });
        }
      }
      for (const s of computeRiskScores({ metrics: hm.metrics, glucose: hm.glucose, profile: hm.profile })) {
        if (s.category === 'high' || s.category === 'moderate') {
          out.push({ domain: 'health', severity: s.category === 'high' ? 'flag' : 'attention', title: `${s.label[0]} · ${s.value}`, detail: `${s.detail[0]} · 依据 ${s.source}` });
        }
      }
    }
  } catch { /* 域数据缺失/解析失败不影响其余域 */ }

  // 财务:异常/涨价/现金流/账单
  try {
    const txs = loadBankTx();
    if (txs.length) {
      for (const f of financeFindings(txs, loadBankAccounts())) {
        out.push({ domain: 'finance', severity: f.severity, title: f.title[0], detail: f.detail[0] });
      }
    }
  } catch { /* ignore */ }

  const rank = (s: InsightSeverity) => (s === 'flag' ? 0 : 1);
  return out.sort((a, b) => rank(a.severity) - rank(b.severity));
}

/**
 * 供检索/叙事拼接的纯文本块(问一问回答上下文 / 简报用)。空则返回 ''。
 * 让「问一问」能据实回答「我这个月哪类花超了 / 有没有订阅涨价 / 血糖达标吗」等 —— 此前它只读
 * 记忆图节点,看不到即时算的健康/财务判定,只能说「没这方面记录」。
 */
export function domainInsightsContextBlock(max = 8): string {
  const insights = gatherDomainInsights().slice(0, max);
  if (!insights.length) return '';
  const label: Record<InsightDomain, string> = { health: '健康', finance: '财务' };
  const lines = insights.map((i) => `• [${label[i.domain]}] ${i.title} —— ${i.detail}`);
  return `\n【当前健康/财务洞察】(来自你的数据,由确定性引擎算出;可据此回答与健康指标/支出/订阅/现金流有关的问题,禁止在此之外虚构数字)\n${lines.join('\n')}`;
}
