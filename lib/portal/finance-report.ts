/**
 * 财务月报(财务㉓)—— 把三层体系(L1 特征 / L2 判定 / L3 体检)+ 预算 + 资产聚合成
 * 报告级 Markdown:可下载、可存入记忆(问一问可检索引用)。全部确定性、非 LLM、
 * 数字与页面各处同口径;口径说明随报告落款,非投资建议。
 */
import {
  summarizeMonth, prevYm, ymOf, categoryBreakdown, topMerchants, detectRecurring, upcomingRecurring,
  formatMoney, assetSummary, accountTypeLabel, internalAdjustmentIds, loadHoldings,
  type BankTx, type BankAccount,
} from './bank-tx';
import { incomeBreakdown, categoryBaseline, subscriptionLoad, detectIncome, portfolioSummary } from './finance-features';
import { financeFindings } from './finance-insight';
import { computeFinanceScores } from './finance-risk';
import { loadBudget, hasBudget, budgetProgress } from './finance-budget';
import { categoryLabel, categoryDetailLabel } from './tx-category';
import { updateLifeNode, getLifeGraph } from './life-graph';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';

export interface MonthlyReport {
  ym: string;
  title: string;
  markdown: string;
  summary: { income: number; net: number; saved: number; txCount: number; accounts: number; topCategory: string };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function buildMonthlyReport(
  txs: BankTx[], accounts: BankAccount[], ym: string, dict: string = 'zh', now: Date = new Date(),
): MonthlyReport {
  const zh = dict !== 'en';
  const monthTxs = txs.filter((t) => (t.date || '').slice(0, 7) === ym);
  const s = summarizeMonth(txs, ym);
  const prev = summarizeMonth(txs, prevYm(ym));
  const cats = categoryBreakdown(txs, ym);
  const merchants = topMerchants(txs, ym, 8);
  const recurring = detectRecurring(txs);
  const load = subscriptionLoad(txs, recurring);
  const upcoming = upcomingRecurring(txs, 7);
  const findings = financeFindings(txs, accounts, ym);
  const scores = computeFinanceScores(txs, accounts, now);
  const income = detectIncome(txs);
  const incomeMix = incomeBreakdown(txs, ym);
  const assets = assetSummary(accounts);
  const budget = loadBudget();
  const adjPairs = internalAdjustmentIds(monthTxs).size / 2;
  const monthMid = new Date(`${ym}-15T00:00:00`);

  const L = (a: string, b: string) => (zh ? a : b);
  const lines: string[] = [];
  const title = L(`${ym} 财务月报`, `Finance monthly report · ${ym}`);
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(L(`生成于 ${now.toISOString().slice(0, 10)} · 数据只存本机 · 确定性规则生成(非 LLM)`, `Generated ${now.toISOString().slice(0, 10)} · on-device data · deterministic rules (no LLM)`));

  // ── 本月速览 ──
  const saved = Math.round((s.income - s.net) * 100) / 100;
  lines.push('', `## ${L('本月速览', 'At a glance')}`, '');
  lines.push(`- ${L('收入', 'Income')}:${formatMoney(s.income, s.currency)}`);
  lines.push(`- ${L('净支出', 'Net spend')}:${formatMoney(s.net, s.currency)}(${L('支出', 'gross')} ${formatMoney(s.gross, s.currency)} − ${L('退款/返还', 'refunds/credits')} ${formatMoney(s.refunds, s.currency)})`);
  lines.push(`- ${L('结余', 'Saved')}:${saved < 0 ? '-' : ''}${formatMoney(Math.abs(saved), s.currency)}${s.income > 0 ? `(${L('储蓄率', 'savings rate')} ${pct(saved / s.income)})` : ''}`);
  if (prev.net >= 50) {
    const d = Math.round(((s.net - prev.net) / prev.net) * 100);
    lines.push(`- ${L('净支出环比', 'Net spend vs last month')}:${d > 0 ? '+' : ''}${d}%(${L('上月', 'last month')} ${formatMoney(prev.net, s.currency)})`);
  }
  lines.push(`- ${L('交易笔数', 'Transactions')}:${s.count} · ${L('账户数', 'accounts')}:${accounts.length}`);

  // ── 收入构成 ──
  if (incomeMix.length) {
    lines.push('', `## ${L('收入构成', 'Income mix')}`, '');
    for (const m of incomeMix) {
      lines.push(`- ${categoryDetailLabel(m.detail, dict) || L('其他收入', 'Other income')}:${formatMoney(m.total, s.currency)}`);
    }
    if (income) lines.push(`- ${L('发薪流', 'Income streams')}:${income.streams.map((st) => `${st.name}(${L(`约每 ${st.cadenceDays} 天`, `~every ${st.cadenceDays}d`)} ${formatMoney(st.avgAmount, s.currency)})`).join('; ')}`);
  }

  // ── 支出分类(vs 个人基线)──
  if (cats.length) {
    lines.push('', `## ${L('支出分类', 'Spending by category')}`, '');
    lines.push(L('| 分类 | 金额 | 占比 | 环比 | 对比习惯 |', '| Category | Amount | Share | MoM | vs usual |'));
    lines.push('| --- | --- | --- | --- | --- |');
    for (const c of cats) {
      const b = categoryBaseline(txs, c.category, monthMid);
      const vsUsual = b && b.median > 0
        ? `${c.total > b.median ? '+' : ''}${Math.round(((c.total - b.median) / b.median) * 100)}% ${L(`(习惯约 ${formatMoney(b.median, s.currency)})`, `(usual ~${formatMoney(b.median, s.currency)})`)}`
        : L('基线不足', 'no baseline');
      const mom = c.deltaPct != null ? `${c.deltaPct > 0 ? '+' : ''}${c.deltaPct}%` : c.isNew ? L('新增', 'new') : '—';
      lines.push(`| ${categoryLabel(c.category, dict)} | ${formatMoney(c.total, s.currency)} | ${c.pct}% | ${mom} | ${vsUsual} |`);
    }
  }

  // ── 商户 Top ──
  if (merchants.length) {
    lines.push('', `## ${L('商户 Top', 'Top merchants')}`, '');
    for (const m of merchants) lines.push(`- ${m.name}:${formatMoney(m.total, s.currency)} · ${m.count} ${L('笔', 'tx')}`);
  }

  // ── 定期与订阅 ──
  if (recurring.length) {
    lines.push('', `## ${L('定期与订阅', 'Recurring & subscriptions')}`, '');
    lines.push(L(`月化合计约 ${formatMoney(load.monthly, s.currency)}(${load.count} 项)`, `~${formatMoney(load.monthly, s.currency)}/mo across ${load.count} items`));
    for (const r of recurring.slice(0, 12)) {
      lines.push(`- ${r.name}:${L(r.cadenceLabel[0], r.cadenceLabel[1])} ${formatMoney(r.avgAmount, r.currency)} · ${L(`下次约 ${r.nextEstimate}`, `next ~${r.nextEstimate}`)}`);
    }
    if (upcoming.items.length) lines.push(L(`未来 7 天预计扣款 ${formatMoney(upcoming.total, s.currency)}(${upcoming.items.length} 笔)`, `Next 7 days: ~${formatMoney(upcoming.total, s.currency)} (${upcoming.items.length})`));
  }

  // ── 风险与提示(L2)──
  if (findings.length) {
    lines.push('', `## ${L('提示与风险', 'Notes & risks')}`, '');
    for (const f of findings) lines.push(`- ${f.severity === 'flag' ? '🔴 ' : ''}${zh ? f.title[0] : f.title[1]} —— ${zh ? f.detail[0] : f.detail[1]}`);
  }

  // ── 财务体检(L3)──
  if (scores.length) {
    lines.push('', `## ${L('财务体检', 'Financial checkup')}`, '');
    for (const sc of scores) lines.push(`- ${zh ? sc.label[0] : sc.label[1]}:**${sc.value}**(${sc.category})—— ${zh ? sc.detail[0] : sc.detail[1]} · ${L('依据', 'per')} ${sc.source}`);
  }

  // ── 预算执行 ──
  if (hasBudget(budget)) {
    const bp = budgetProgress(txs, ym, budget);
    lines.push('', `## ${L('预算执行', 'Budget')}`, '');
    if (bp.total) lines.push(L(`总预算 ${formatMoney(bp.total.budget, s.currency)},已用 ${formatMoney(bp.total.spent, s.currency)},${bp.total.left >= 0 ? `还可以花 ${formatMoney(bp.total.left, s.currency)}` : `超出 ${formatMoney(-bp.total.left, s.currency)}(月中调整来得及)`}`, `Budget ${formatMoney(bp.total.budget, s.currency)}, spent ${formatMoney(bp.total.spent, s.currency)}, ${bp.total.left >= 0 ? `left ${formatMoney(bp.total.left, s.currency)}` : `over by ${formatMoney(-bp.total.left, s.currency)}`}`));
    for (const c of bp.perCategory) {
      lines.push(`- ${categoryLabel(c.category, dict)}:${formatMoney(c.spent, s.currency)} / ${formatMoney(c.budget, s.currency)}${c.ratio > 1 ? L('(超出)', ' (over)') : ''}`);
    }
  }

  // ── 资产小结 ──
  if (accounts.length) {
    lines.push('', `## ${L('资产小结', 'Assets')}`, '');
    const loanSeg = assets.loanOwed > 0 ? L(` · 贷款 ${formatMoney(assets.loanOwed)}`, ` · loans ${formatMoney(assets.loanOwed)}`) : '';
    lines.push(L(`存款 ${formatMoney(assets.deposits)} · 投资 ${formatMoney(assets.investments)} · 信用卡欠款 ${formatMoney(assets.creditOwed)}${loanSeg} · 净资产 ${assets.net < 0 ? '-' : ''}${formatMoney(Math.abs(assets.net))}`, `Cash ${formatMoney(assets.deposits)} · investments ${formatMoney(assets.investments)} · card debt ${formatMoney(assets.creditOwed)}${loanSeg} · net ${formatMoney(assets.net)}`));
    for (const a of accounts) {
      const tl = accountTypeLabel(a);
      const bal = a.balance != null ? formatMoney(a.balance, a.currency) : L('余额未知', 'balance n/a');
      lines.push(`- ${[a.institution, a.name].filter(Boolean).join(' · ')}(${zh ? tl[0] : tl[1]}${a.mask ? ` ····${a.mask}` : ''}):${['credit', 'loan'].includes((a.type || '').toLowerCase()) ? L(`欠款 ${bal}`, `owes ${bal}`) : bal}`);
    }
  }

  // ── 投资持仓(财务㉗;与预算同法,模块内自读本机 store,无持仓不出分节)──
  const portfolio = portfolioSummary(loadHoldings());
  if (portfolio) {
    lines.push('', `## ${L('投资持仓', 'Investments')}`, '');
    const g = portfolio.gain;
    lines.push(L(
      `总市值 ${formatMoney(portfolio.totalValue)}${g !== null ? ` · 浮动盈亏 ${g >= 0 ? '+' : '-'}${formatMoney(Math.abs(g))}${portfolio.gainPct !== null ? `(${portfolio.gainPct >= 0 ? '+' : ''}${portfolio.gainPct}%)` : ''}` : ''} · ${portfolio.positions.length} 只持仓`,
      `Market value ${formatMoney(portfolio.totalValue)}${g !== null ? ` · unrealized ${g >= 0 ? '+' : '-'}${formatMoney(Math.abs(g))}${portfolio.gainPct !== null ? ` (${portfolio.gainPct >= 0 ? '+' : ''}${portfolio.gainPct}%)` : ''}` : ''} · ${portfolio.positions.length} positions`));
    lines.push(L(`组合结构:${portfolio.byType.map((t) => `${t.label} ${t.pct}%`).join(' · ')}`, `Allocation: ${portfolio.byType.map((t) => `${t.label} ${t.pct}%`).join(' · ')}`));
    for (const p of portfolio.positions.slice(0, 15)) {
      const pg = p.gain !== null ? `${p.gain >= 0 ? '+' : '-'}${formatMoney(Math.abs(p.gain))}` : L('成本未知', 'cost n/a');
      lines.push(`- ${p.ticker ? `${p.ticker} · ` : ''}${p.name}:${formatMoney(p.value)}(${p.pct}%)· ${pg}`);
    }
    if (portfolio.concentrated) {
      lines.push(L(
        `${portfolio.concentrated.ticker || portfolio.concentrated.name} 占组合 ${portfolio.concentrated.pct}%,波动会更贴着这一只走,有空可以想想要不要分散一点。`,
        `${portfolio.concentrated.ticker || portfolio.concentrated.name} is ${portfolio.concentrated.pct}% of the portfolio; volatility will track it closely — worth thinking about.`));
    }
  }

  // ── 口径说明 ──
  lines.push('', `## ${L('口径说明', 'Methodology')}`, '');
  lines.push(`- ${L('净支出 = 支出 − 退款/返还;收入、转账、信用卡还款不计入收支。', 'Net spend = gross − refunds/credits; income, transfers and card payments are excluded.')}`);
  lines.push(`- ${L('退款需有对应商户的购买记录,否则按转账处理(证据门)。', 'Refunds require prior purchase evidence from the same merchant; otherwise treated as transfers.')}`);
  if (adjPairs > 0) lines.push(`- ${L(`本月折叠了 ${adjPairs} 组银行内部调整对(同日同额一正一负,净额为零)。`, `${adjPairs} internal bank adjustment pair(s) collapsed (net zero).`)}`);
  lines.push(`- ${L('「对比习惯」以近 6 个完整月中位数为基线;体检分项均附标准出处。', '"vs usual" uses the median of the last 6 full months; checkup items cite their sources.')}`);
  lines.push(`- ${L('本报告由确定性规则生成,数据只存本机,不构成投资建议。', 'Deterministic rules, on-device data, not investment advice.')}`);

  return {
    ym,
    title,
    markdown: lines.join('\n'),
    summary: {
      income: s.income,
      net: s.net,
      saved,
      txCount: s.count,
      accounts: accounts.length,
      topCategory: cats[0]?.category || '',
    },
  };
}

/** 存入记忆(life-graph):同月月报已存在则更新,不产生重复节点。返回 created/updated。 */
export function persistReportToMemory(r: MonthlyReport): 'created' | 'updated' {
  const existing = getLifeGraph().find(
    (n) => n.source === 'system' && n.attributes?.kind === 'finance-monthly-report' && n.attributes?.ym === r.ym,
  );
  const attributes = {
    kind: 'finance-monthly-report',
    ym: r.ym,
    income: r.summary.income,
    net: r.summary.net,
    saved: r.summary.saved,
    txCount: r.summary.txCount,
    epistemic: 'system_summary',
    generator: 'rule:finance-report',
  };
  if (existing) {
    updateLifeNode(existing.id, { name: r.title, attributes, rawInput: r.markdown });
    return 'updated';
  }
  ingestLifeNode({
    type: 'event',
    name: r.title,
    attributes,
    source: 'system',
    confidence: 1,
    relations: [],
    tags: zhTags,
    rawInput: r.markdown,
  });
  return 'created';
}

const zhTags = ['财务', '月报'];

/* ---------- 财务㉔:月初自动存记忆 + 打印导出 ---------- */

const AUTO_KEY = 'nesio-fin-report-auto-v1';

/**
 * 月初自动补生成**上月**月报并存入记忆:每设备每月一次(localStorage 标记幂等),
 * 上月没有交易则跳过。由财务页挂载时调用——不开财务页就等下次打开时补,无损。
 */
export function autoPersistLastMonthReport(
  txs: BankTx[], accounts: BankAccount[], now: Date = new Date(), dict: string = 'zh',
): 'created' | 'updated' | 'skipped' {
  if (typeof window === 'undefined' || !txs.length) return 'skipped';
  const lastYm = prevYm(ymOf(now));
  try { if (localStorage.getItem(AUTO_KEY) === lastYm) return 'skipped'; } catch { /* ignore */ }
  if (!txs.some((t) => (t.date || '').slice(0, 7) === lastYm)) return 'skipped';
  const outcome = persistReportToMemory(buildMonthlyReport(txs, accounts, lastYm, dict, now));
  try { localStorage.setItem(AUTO_KEY, lastYm); } catch { /* ignore */ }
  return outcome;
}

/**
 * 打印友好 HTML(浏览器「打印 → 存为 PDF」即得 PDF,零依赖)。
 * 只转换报告自产的 Markdown 子集:h1/h2、列表、表格、粗体、段落;内容全程转义。
 */
export function reportHtml(r: MonthlyReport): string {
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (x: string) => esc(x).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const out: string[] = [];
  let inList = false;
  let inTable = false;
  const closeBlocks = () => {
    if (inList) { out.push('</ul>'); inList = false; }
    if (inTable) { out.push('</table>'); inTable = false; }
  };
  for (const raw of r.markdown.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('| ')) {
      if (/^\|[\s\-|]+\|$/.test(line.replace(/ /g, ''))) continue; // 分隔行
      if (!inTable) { closeBlocks(); out.push('<table>'); inTable = true; }
      const cells = line.split('|').slice(1, -1).map((c) => inline(c.trim()));
      out.push(`<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`);
      continue;
    }
    if (inTable) { out.push('</table>'); inTable = false; }
    if (line.startsWith('## ')) { closeBlocks(); out.push(`<h2>${inline(line.slice(3))}</h2>`); continue; }
    if (line.startsWith('# ')) { closeBlocks(); out.push(`<h1>${inline(line.slice(2))}</h1>`); continue; }
    if (line.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    closeBlocks();
    if (line) out.push(`<p>${inline(line)}</p>`);
  }
  closeBlocks();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>
body{font:14px/1.65 -apple-system,"Noto Sans SC",sans-serif;color:#1e2a3a;max-width:720px;margin:0 auto;padding:28px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px;border-bottom:1px solid #dfe6ef;padding-bottom:3px}
ul{margin:4px 0;padding-left:18px}li{margin:2px 0}p{margin:4px 0;color:#5a6d82;font-size:12.5px}
table{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0}td{border:1px solid #d8e0ea;padding:4px 8px}
tr:first-child td{font-weight:600;background:#f4f8fd}
@media print{body{padding:0}}
</style></head><body>${out.join('\n')}</body></html>`;
}
