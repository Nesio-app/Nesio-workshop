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
import { evaluateHealthFindings, type ClinicalFinding } from './health-clinical';
import { computeRiskScores, type RiskScore } from './health-risk';
import { loadBankTx, loadBankAccounts, prevYm, ymOf, formatMoney } from './bank-tx';
import { financeFindings, type FinanceFinding } from './finance-insight';
import { computeFinanceScores } from './finance-risk';
import { findFinanceGuidelines } from './finance-guidelines';
import { loadPlaceTrail } from './place-trail';
import { placeFindings, type PlaceFinding } from './place-insight';
import { inventoryFindings, type InventoryFinding } from './inventory';
import { getLifeGraph } from './life-graph';
import { moodFindings, type MoodFinding } from './mood-insight';

export type InsightDomain = 'health' | 'finance' | 'location' | 'inventory' | 'mood';
export type InsightSeverity = 'flag' | 'attention';

export interface DomainInsight {
  domain: InsightDomain;
  severity: InsightSeverity;
  title: string;   // zh(检索/叙事用)
  detail: string;  // zh(带出处)
}

/**
 * 单一判定源(Cross-Insight Reader 的核心)—— 跑各域确定性引擎一次,筛出「值得提示」的原始
 * finding:健康 = flag/attention 的 findings + high/moderate 的 risks;财务引擎本身只出 flag/attention。
 * Today(经 guidance 适配器 → 七层仲裁)与 问一问/简报(经 gatherDomainInsights 文本投影)都从这里取。
 * 呈现口径可不同,但**判定与筛选只有这一处**——阈值改一次两边一起动,不再各写一遍导致漂移。
 */
export interface DomainFindingSet {
  health: { findings: ClinicalFinding[]; risks: RiskScore[] };
  finance: FinanceFinding[];
  location: PlaceFinding[];
  inventory: InventoryFinding[];
  mood: MoodFinding[];
}

const isSurfaceableFinding = (f: ClinicalFinding) => f.severity === 'flag' || f.severity === 'attention';
const isSurfaceableRisk = (s: RiskScore) => s.category === 'high' || s.category === 'moderate';

export function computeDomainFindings(): DomainFindingSet {
  let health: DomainFindingSet['health'] = { findings: [], risks: [] };
  let finance: FinanceFinding[] = [];
  let location: PlaceFinding[] = [];

  // 健康:②模式(evaluateHealthFindings)+ ③风险(computeRiskScores),各自筛「值得提示」
  try {
    const hm = loadHealthMetrics();
    if (hm) {
      health = {
        findings: evaluateHealthFindings({ glucose: hm.glucose, sleepStages: hm.sleepStages, metrics: hm.metrics }).filter(isSurfaceableFinding),
        risks: computeRiskScores({ metrics: hm.metrics, glucose: hm.glucose, profile: hm.profile }).filter(isSurfaceableRisk),
      };
    }
  } catch { /* 域数据缺失/解析失败不影响其余域 */ }

  // 财务:异常/涨价/现金流/账单(引擎已只出值得提示的)
  try {
    const txs = loadBankTx();
    if (txs.length) finance = financeFindings(txs, loadBankAccounts());
  } catch { /* ignore */ }

  // 地图:活动范围/习惯断档(引擎自带追踪存活门 + 冷启动沉默,只出 attention)
  try {
    const visits = loadPlaceTrail();
    if (visits.length) location = placeFindings({ visits, now: new Date() });
  } catch { /* ignore */ }

  // 收纳:效期判定(已过期=flag,30 天内=attention;物品即 life-graph object 节点)
  let inventory: InventoryFinding[] = [];
  try {
    inventory = inventoryFindings();
  } catch { /* ignore */ }

  // 心情:情绪持续偏低 CUSUM(记录太少沉默,情绪域从严只出 attention)
  let mood: MoodFinding[] = [];
  try {
    mood = moodFindings({ nodes: getLifeGraph(), now: new Date() });
  } catch { /* ignore */ }

  return { health, finance, location, inventory, mood };
}

/** 汇聚当前所有域的「值得提示」判定(红旗/可关注),红旗优先。是 computeDomainFindings 的文本投影。 */
export function gatherDomainInsights(): DomainInsight[] {
  const { health, finance, location, inventory, mood } = computeDomainFindings();
  const out: DomainInsight[] = [];

  for (const f of health.findings) {
    out.push({ domain: 'health', severity: f.severity as InsightSeverity, title: f.title[0], detail: `${f.detail[0]} · 依据 ${f.source}` });
  }
  for (const s of health.risks) {
    out.push({ domain: 'health', severity: s.category === 'high' ? 'flag' : 'attention', title: `${s.label[0]} · ${s.value}`, detail: `${s.detail[0]} · 依据 ${s.source}` });
  }
  for (const f of finance) {
    out.push({ domain: 'finance', severity: f.severity, title: f.title[0], detail: f.detail[0] });
  }
  // 财务㉔:月初一周内提示上月月报已就绪(已存入记忆的才提;简报/问一问同源)
  try {
    const now = new Date();
    if (now.getDate() <= 7) {
      const lastYm = prevYm(ymOf(now));
      const node = getLifeGraph().find((n) => n.attributes?.kind === 'finance-monthly-report' && n.attributes?.ym === lastYm);
      if (node) {
        const net = typeof node.attributes?.net === 'number' ? formatMoney(node.attributes.net as number) : '';
        const saved = typeof node.attributes?.saved === 'number' ? node.attributes.saved as number : null;
        out.push({
          domain: 'finance', severity: 'attention',
          title: `${lastYm} 财务月报已就绪`,
          detail: `${net ? `净支出 ${net}` : ''}${saved != null ? ` · 结余 ${saved < 0 ? '-' : ''}${formatMoney(Math.abs(saved))}` : ''} · 财务页可下载,问一问可检索全文`,
        });
      }
    }
  } catch { /* ignore */ }

  // 财务⑮:L3 体检分项(与健康 risks 同法,只有 moderate/high 值得提示;info/low 留在财务页)
  try {
    for (const s of computeFinanceScores(loadBankTx(), loadBankAccounts())) {
      if (s.category !== 'high' && s.category !== 'moderate') continue;
      out.push({ domain: 'finance', severity: s.category === 'high' ? 'flag' : 'attention', title: `${s.label[0]} · ${s.value}`, detail: `${s.detail[0]} · 依据 ${s.source}` });
    }
  } catch { /* ignore */ }
  for (const f of location) {
    out.push({ domain: 'location', severity: f.severity as InsightSeverity, title: f.title[0], detail: f.detail[0] });
  }
  for (const f of inventory) {
    out.push({ domain: 'inventory', severity: f.severity, title: f.title[0], detail: f.detail[0] });
  }
  for (const f of mood) {
    out.push({ domain: 'mood', severity: f.severity as InsightSeverity, title: f.title[0], detail: f.detail[0] });
  }

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
  const label: Record<InsightDomain, string> = { health: '健康', finance: '财务', location: '活动', inventory: '收纳', mood: '心情' };
  const lines = insights.map((i) => `• [${label[i.domain]}] ${i.title} —— ${i.detail}`);
  // 财务⑮:按当前财务判定的主题检索策展标准要点(带出处),让 AI 引用真标准而非编造
  try {
    const { finance } = computeDomainFindings();
    const topics = [...finance.map((f) => f.id), ...computeFinanceScores(loadBankTx(), loadBankAccounts()).map((s) => s.id)];
    for (const g of findFinanceGuidelines(topics).slice(0, 3)) {
      lines.push(`• [标准] ${g.text[0]}(出处:${g.source})`);
    }
  } catch { /* ignore */ }
  return `\n【当前健康/财务洞察】(来自你的数据,由确定性引擎算出;可据此回答与健康指标/支出/订阅/现金流有关的问题,禁止在此之外虚构数字)\n${lines.join('\n')}`;
}
