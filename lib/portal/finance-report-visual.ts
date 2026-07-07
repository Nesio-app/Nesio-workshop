/**
 * 财务月报 · 彩色图文版(财务㉘)。
 *
 * 对标 Monarch/Copilot 报告页与月度财报模板的通行版式:执行摘要 KPI 打头、
 * 分类环形图 + 数值图例、收入 vs 净支出月度趋势条形图、现金流分配条、预算/体检
 * 进度条、投资组合占比条。输出自包含 HTML(内联 SVG/CSS、无外部资源、非 LLM
 * 确定性生成),浏览器「打印 → 存为 PDF」即得彩色 PDF。
 *
 * 用色:环形图/趋势图调色板经 CVD 校验(相邻对 ΔE≥12,deutan 最差对 25.3),
 * 「其他」恒为中性灰(刻意降噪);状态色沿用 warm-coach 规则——红仅真实风险,
 * 超支/涨幅用琥珀。文字一律用墨色/次色,不穿数据色(色相由旁边的色块承载)。
 */
import {
  summarizeMonth, prevYm, categoryBreakdown, topMerchants, detectRecurring, upcomingRecurring,
  formatMoney, assetSummary, accountTypeLabel, loadHoldings,
  type BankTx, type BankAccount,
} from './bank-tx';
import {
  monthlyCashflow, categoryBaseline, subscriptionLoad, incomeBreakdown, portfolioSummary,
} from './finance-features';
import { financeFindings } from './finance-insight';
import { computeFinanceScores } from './finance-risk';
import { loadBudget, hasBudget, budgetProgress } from './finance-budget';
import { categoryLabel, categoryDetailLabel } from './tx-category';

/* 设计 token 的 day 值镜像(独立文档拿不到 app 的 CSS 变量;与 design-system/nesio 同源) */
const INK = '#1e2a3a';
const MUTED = '#5a6d82';
const LINE = '#dfe6ef';
const BG_SOFT = '#f4f8fd';
const ACCENT = '#588ce3';
const GO = '#5a9e7a';
const GO_SOFT = '#d9ece1';
const GENTLE = '#c9923f';
const GENTLE_SOFT = '#f3e4cc';
const RISK = '#cf6b6b';
/* 分类调色板:蓝/橙/绿/紫/玫红/金/青(校验通过的固定顺序,不轮换);灰=「其他」 */
const CAT_COLORS = ['#588ce3', '#e0954a', '#3d9f6e', '#7c6ee6', '#c25d7a', '#c98a2d', '#17a28b'];
const OTHER_GRAY = '#9aa7b8';

const esc = (x: string) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (v: number) => Math.round(v * 10) / 10;

/** 顶部圆角(4px)、底边平直的柱形 path(规范:data-end 圆角、基线方角)。 */
function roundedBar(x: number, y: number, w: number, h: number, color: string): string {
  if (h <= 0.5) return '';
  const r = Math.min(4, w / 2, h);
  return `<path d="M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z" fill="${color}"/>`;
}

/** 环形图(SVG stroke 法,切片间 2px 表面留缝)。 */
function donutSvg(slices: Array<{ label: string; value: number; color: string }>, centerTop: string, centerVal: string): string {
  const R = 54;
  const C = 2 * Math.PI * R;
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return '';
  const GAP = 2;
  let acc = 0;
  const segs: string[] = [];
  for (const s of slices) {
    const len = (s.value / total) * C;
    const draw = Math.max(0, len - (slices.length > 1 ? GAP : 0));
    segs.push(`<circle r="${R}" fill="none" stroke="${s.color}" stroke-width="17" stroke-dasharray="${r1(draw)} ${r1(C - draw)}" stroke-dashoffset="${r1(-acc)}"/>`);
    acc += len;
  }
  return `<svg viewBox="0 0 150 150" width="150" height="150" role="img" aria-label="${esc(centerTop)}">
<g transform="translate(75,75) rotate(-90)">${segs.join('')}</g>
<text x="75" y="70" text-anchor="middle" font-size="9.5" fill="${MUTED}">${esc(centerTop)}</text>
<text x="75" y="88" text-anchor="middle" font-size="15" font-weight="700" fill="${INK}">${esc(centerVal)}</text>
</svg>`;
}

/** 收入 vs 净支出 双系列柱形图(近 6 个月,hairline 网格 + 干净刻度)。 */
function trendSvg(rows: Array<{ ym: string; income: number; net: number }>, zh: boolean): string {
  if (rows.length < 2) return '';
  const W = 640; const H = 190;
  const padL = 52; const padR = 8; const padT = 12; const padB = 24;
  const plotW = W - padL - padR; const plotH = H - padT - padB;
  const rawMax = Math.max(1, ...rows.map((r) => Math.max(r.income, r.net)));
  // 干净刻度:1/2/2.5/5 × 10^k 向上取
  const pow = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceMax = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((m) => m >= rawMax) ?? rawMax;
  const y = (v: number) => padT + plotH * (1 - v / niceMax);
  const parts: string[] = [];
  for (const frac of [0, 0.5, 1]) {
    const gy = r1(y(niceMax * frac));
    parts.push(`<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="${LINE}" stroke-width="1"/>`);
    parts.push(`<text x="${padL - 6}" y="${gy + 3.5}" text-anchor="end" font-size="9" fill="${MUTED}">$${Math.round(niceMax * frac).toLocaleString('en-US')}</text>`);
  }
  const band = plotW / rows.length;
  const bw = Math.min(20, band / 3);
  rows.forEach((row, i) => {
    const cx = padL + band * i + band / 2;
    parts.push(roundedBar(r1(cx - bw - 1), r1(y(row.income)), bw, r1(plotH - (y(row.income) - padT)), GO));
    parts.push(roundedBar(r1(cx + 1), r1(y(row.net)), bw, r1(plotH - (y(row.net) - padT)), ACCENT));
    parts.push(`<text x="${r1(cx)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="${MUTED}">${esc(row.ym.slice(2).replace('-', '/'))}</text>`);
  });
  const legend = zh
    ? `<span class="lg"><i style="background:${GO}"></i>收入</span><span class="lg"><i style="background:${ACCENT}"></i>净支出</span>`
    : `<span class="lg"><i style="background:${GO}"></i>Income</span><span class="lg"><i style="background:${ACCENT}"></i>Net spend</span>`;
  return `<div class="legend">${legend}</div><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img">${parts.join('')}</svg>`;
}

/** 水平占比条(预算进度/体检分数/组合结构共用;fill 数组按序渲染,2px 留缝)。 */
function hbar(fills: Array<{ pct: number; color: string }>, track = BG_SOFT): string {
  const segs = fills
    .filter((f) => f.pct > 0)
    .map((f) => `<i style="width:${Math.min(100, r1(f.pct))}%;background:${f.color}"></i>`)
    .join('');
  return `<span class="hbar" style="background:${track}">${segs}</span>`;
}

/** 财务月报 · 彩色图文 HTML(自包含;打印即 PDF)。 */
export function reportRichHtml(
  txs: BankTx[], accounts: BankAccount[], ym: string, dict: string = 'zh', now: Date = new Date(),
): string {
  const zh = dict !== 'en';
  const L = (a: string, b: string) => (zh ? a : b);
  const s = summarizeMonth(txs, ym);
  const prev = summarizeMonth(txs, prevYm(ym));
  const cats = categoryBreakdown(txs, ym);
  const merchants = topMerchants(txs, ym, 8);
  const recurring = detectRecurring(txs);
  const load = subscriptionLoad(txs, recurring);
  const upcoming = upcomingRecurring(txs, 7);
  const findings = financeFindings(txs, accounts, ym);
  const scores = computeFinanceScores(txs, accounts, now);
  const incomeMix = incomeBreakdown(txs, ym);
  const cashflow = monthlyCashflow(txs, 6);
  const assets = assetSummary(accounts);
  const budget = loadBudget();
  const portfolio = portfolioSummary(loadHoldings());
  const monthMid = new Date(`${ym}-15T00:00:00`);
  const saved = Math.round((s.income - s.net) * 100) / 100;
  const money = (v: number) => formatMoney(v, s.currency);
  const title = L(`${ym} 财务月报`, `Finance monthly report · ${ym}`);
  const B: string[] = [];

  // ── 执行摘要:KPI 打头(最关键指标放最前,单页速览) ──
  const deltaHtml = prev.net >= 50
    ? (() => {
        const d = Math.round(((s.net - prev.net) / prev.net) * 100);
        const up = d > 0;
        return `<span class="delta" style="color:${up ? GENTLE : GO}">${up ? '▲' : '▼'} ${Math.abs(d)}% ${L('vs 上月', 'vs last mo')}</span>`;
      })()
    : '';
  B.push(`<div class="kpis">
<div class="kpi"><span class="kl">${L('收入', 'Income')}</span><span class="kv">${esc(money(s.income))}</span></div>
<div class="kpi"><span class="kl">${L('净支出', 'Net spend')}</span><span class="kv">${esc(money(s.net))}</span>${deltaHtml}</div>
<div class="kpi"><span class="kl">${L('结余', 'Saved')}</span><span class="kv">${saved < 0 ? '-' : ''}${esc(money(Math.abs(saved)))}</span>${s.income > 0 ? `<span class="delta" style="color:${saved >= 0 ? GO : GENTLE}">${L('储蓄率', 'savings rate')} ${Math.round((saved / s.income) * 100)}%</span>` : ''}</div>
</div>`);

  // ── 现金流分配条:收入 → 支出/结余(Sankey 的单层等价物) ──
  if (s.income > 0 && saved >= 0) {
    const spendPct = Math.min(100, (s.net / s.income) * 100);
    B.push(`<section><h2>${L('现金流', 'Cash flow')}</h2>
${hbar([{ pct: spendPct, color: ACCENT }, { pct: 100 - spendPct, color: GO }])}
<div class="legend"><span class="lg"><i style="background:${ACCENT}"></i>${L('花掉', 'Spent')} ${esc(money(s.net))}</span><span class="lg"><i style="background:${GO}"></i>${L('留下', 'Kept')} ${esc(money(saved))}</span></div></section>`);
  }

  // ── 支出分类:环形图 + 数值图例(前 6 + 其他;对比个人基线) ──
  if (cats.length) {
    const top = cats.slice(0, 6);
    const restTotal = cats.slice(6).reduce((sum, c) => sum + c.total, 0);
    const slices = top.map((c, i) => ({ label: categoryLabel(c.category, dict), value: c.total, color: CAT_COLORS[i] }));
    if (restTotal > 0) slices.push({ label: L('其他', 'Other'), value: restTotal, color: OTHER_GRAY });
    const legendRows = top.map((c, i) => {
      const b = categoryBaseline(txs, c.category, monthMid);
      const d = b && b.median > 0 ? Math.round(((c.total - b.median) / b.median) * 100) : null;
      const vs = d !== null && Math.abs(d) >= 1 ? `${d > 0 ? '+' : ''}${d}% ${L('vs 习惯', 'vs usual')}` : '';
      return `<tr><td><i class="sw" style="background:${CAT_COLORS[i]}"></i>${esc(categoryLabel(c.category, dict))}</td><td class="num">${esc(money(c.total))}</td><td class="num">${c.pct}%</td><td class="muted">${esc(vs)}</td></tr>`;
    }).join('');
    const restRow = restTotal > 0 ? `<tr><td><i class="sw" style="background:${OTHER_GRAY}"></i>${L('其他', 'Other')}</td><td class="num">${esc(money(restTotal))}</td><td class="num">${r1((restTotal / Math.max(1, s.net)) * 100)}%</td><td></td></tr>` : '';
    B.push(`<section><h2>${L('支出分类', 'Spending by category')}</h2><div class="donutrow">
${donutSvg(slices, L('净支出', 'Net spend'), money(s.net))}
<table class="clean">${legendRows}${restRow}</table>
</div></section>`);
  }

  // ── 月度趋势:收入 vs 净支出 ──
  if (cashflow.length >= 2) {
    B.push(`<section><h2>${L('月度趋势', 'Monthly trend')}</h2>${trendSvg(cashflow, zh)}</section>`);
  }

  // ── 收入构成(小表,不加装饰条——占比用文字) ──
  if (incomeMix.length) {
    const mixTotal = incomeMix.reduce((sum, m) => sum + m.total, 0);
    const rows = incomeMix.map((m) => `<tr><td>${esc(categoryDetailLabel(m.detail, dict) || L('其他收入', 'Other income'))}</td><td class="num">${esc(money(m.total))}</td><td class="muted num">${r1((m.total / Math.max(1, mixTotal)) * 100)}%</td></tr>`).join('');
    B.push(`<section><h2>${L('收入构成', 'Income mix')}</h2><table class="clean">${rows}</table></section>`);
  }

  // ── 商户 Top(干净数值表;金额列右对齐自证大小,不再加条) ──
  if (merchants.length) {
    const rows = merchants.map((m) => `<tr><td class="mname">${esc(m.name)}</td><td class="num">${esc(money(m.total))}</td><td class="muted num">${m.count}${L(' 笔', '×')}</td></tr>`).join('');
    B.push(`<section><h2>${L('商户 Top', 'Top merchants')}</h2><table class="clean">${rows}</table></section>`);
  }

  // ── 定期与订阅 ──
  if (recurring.length) {
    const rows = recurring.slice(0, 12).map((r) => `<tr><td>${esc(r.name)}</td><td class="muted">${esc(zh ? r.cadenceLabel[0] : r.cadenceLabel[1])}</td><td class="num">${esc(formatMoney(r.avgAmount, r.currency))}</td><td class="muted">${L('下次约 ', 'next ~')}${esc(r.nextEstimate.slice(5).replace('-', '/'))}</td></tr>`).join('');
    B.push(`<section><h2>${L('定期与订阅', 'Recurring & subscriptions')}</h2>
<p class="lede">${L(`月化合计约 ${money(load.monthly)}(${load.count} 项)`, `~${money(load.monthly)}/mo across ${load.count} items`)}${upcoming.items.length ? L(` · 未来 7 天预计扣款 ${money(upcoming.total)}`, ` · next 7 days ~${money(upcoming.total)}`) : ''}</p>
<table class="clean">${rows}</table></section>`);
  }

  // ── 提示与风险(红点仅真实风险,其余琥珀) ──
  if (findings.length) {
    const rows = findings.map((f) => `<li><i class="dot" style="background:${f.severity === 'flag' ? RISK : GENTLE}"></i><strong>${esc(zh ? f.title[0] : f.title[1])}</strong> —— ${esc(zh ? f.detail[0] : f.detail[1])}</li>`).join('');
    B.push(`<section><h2>${L('提示与风险', 'Notes & risks')}</h2><ul class="dots">${rows}</ul></section>`);
  }

  // ── 财务体检:值 + 档位色点(不画假刻度条——各项量纲不同,条宽会误导) ──
  if (scores.length) {
    const tone = (cat: string) => (cat === 'high' ? RISK : cat === 'moderate' ? GENTLE : GO);
    const rows = scores.map((sc) => `<div class="score"><div class="scoretop"><span><i class="dot" style="position:static;display:inline-block;vertical-align:-.5px;margin-right:6px;background:${tone(sc.category)}"></i>${esc(zh ? sc.label[0] : sc.label[1])}</span><strong>${esc(sc.value)}</strong></div>
<p class="muted small">${esc(zh ? sc.detail[0] : sc.detail[1])} · ${esc(sc.source)}</p></div>`).join('');
    B.push(`<section><h2>${L('财务体检', 'Financial checkup')}</h2>${rows}</section>`);
  }

  // ── 预算执行:分类进度条(超支琥珀,不用红) ──
  if (hasBudget(budget)) {
    const bp = budgetProgress(txs, ym, budget);
    const totalLine = bp.total
      ? `<p class="lede">${L(`总预算 ${money(bp.total.budget)} · 已用 ${money(bp.total.spent)} · ${bp.total.left >= 0 ? `还可以花 ${money(bp.total.left)}` : `超出 ${money(-bp.total.left)}(月中调整来得及)`}`, `Budget ${money(bp.total.budget)} · spent ${money(bp.total.spent)} · ${bp.total.left >= 0 ? `left ${money(bp.total.left)}` : `over by ${money(-bp.total.left)}`}`)}</p>${hbar([{ pct: bp.total.ratio * 100, color: bp.total.ratio > 1 ? GENTLE : ACCENT }])}`
      : '';
    const rows = bp.perCategory.map((c) => `<div class="score"><div class="scoretop"><span>${esc(categoryLabel(c.category, dict))}</span><span class="muted">${esc(money(c.spent))} / ${esc(money(c.budget))}${c.ratio > 1 ? L('(超出)', ' (over)') : ''}</span></div>${hbar([{ pct: c.ratio * 100, color: c.ratio > 1 ? GENTLE : ACCENT }])}</div>`).join('');
    B.push(`<section><h2>${L('预算执行', 'Budget')}</h2>${totalLine}${rows}${bp.otherSpent > 0 ? `<p class="muted small">${L(`未设预算的分类还花了 ${money(bp.otherSpent)}。`, `Unbudgeted categories: ${money(bp.otherSpent)}.`)}</p>` : ''}</section>`);
  }

  // ── 投资持仓:组合结构条 + 持仓表 ──
  if (portfolio) {
    const alloc = portfolio.byType.map((t, i) => ({ pct: t.pct, color: CAT_COLORS[i % CAT_COLORS.length] }));
    const allocLegend = portfolio.byType.map((t, i) => `<span class="lg"><i style="background:${CAT_COLORS[i % CAT_COLORS.length]}"></i>${esc(t.label)} ${t.pct}%</span>`).join('');
    const rows = portfolio.positions.slice(0, 15).map((p) => {
      const gain = p.gain !== null
        ? `<span style="color:${p.gain >= 0 ? GO : GENTLE};font-weight:600">${p.gain >= 0 ? '+' : '-'}${esc(money(Math.abs(p.gain)))}</span>`
        : `<span class="muted">${L('成本未知', 'cost n/a')}</span>`;
      return `<tr><td>${p.ticker ? `<strong>${esc(p.ticker)}</strong> · ` : ''}${esc(p.name)}</td><td class="muted">${esc(p.typeLabel)}</td><td class="num">${esc(money(p.value))}</td><td class="num">${p.pct}%</td><td class="num">${gain}</td></tr>`;
    }).join('');
    const g = portfolio.gain;
    B.push(`<section><h2>${L('投资持仓', 'Investments')}</h2>
<p class="lede">${L(`总市值 ${money(portfolio.totalValue)}`, `Market value ${money(portfolio.totalValue)}`)}${g !== null ? ` · <span style="color:${g >= 0 ? GO : GENTLE};font-weight:600">${g >= 0 ? '+' : '-'}${esc(money(Math.abs(g)))}${portfolio.gainPct !== null ? ` (${portfolio.gainPct >= 0 ? '+' : ''}${portfolio.gainPct}%)` : ''}</span>` : ''}</p>
${hbar(alloc)}<div class="legend">${allocLegend}</div>
<table class="clean">${rows}</table>
${portfolio.concentrated ? `<p class="muted small">${esc(L(`${portfolio.concentrated.ticker || portfolio.concentrated.name} 占组合 ${portfolio.concentrated.pct}%,波动会更贴着这一只走,有空可以想想要不要分散一点。`, `${portfolio.concentrated.ticker || portfolio.concentrated.name} is ${portfolio.concentrated.pct}% of the portfolio — worth a think.`))}</p>` : ''}</section>`);
  }

  // ── 资产小结 ──
  if (accounts.length) {
    const tiles = [
      [L('存款', 'Cash'), money(assets.deposits)],
      ...(assets.investments > 0 ? [[L('投资', 'Investments'), money(assets.investments)]] : []),
      [L('信用卡欠款', 'Card debt'), money(assets.creditOwed)],
      [L('净资产', 'Net worth'), `${assets.net < 0 ? '-' : ''}${money(Math.abs(assets.net))}`],
    ].map(([k, v]) => `<div class="kpi"><span class="kl">${esc(k)}</span><span class="kv sm">${esc(v)}</span></div>`).join('');
    const rows = accounts.map((a) => {
      const tl = accountTypeLabel(a);
      const bal = a.balance != null ? formatMoney(a.balance, a.currency) : L('余额未知', 'n/a');
      return `<tr><td>${esc([a.institution, a.name].filter(Boolean).join(' · '))}</td><td class="muted">${esc(zh ? tl[0] : tl[1])}${a.mask ? ` ····${esc(a.mask)}` : ''}</td><td class="num">${(a.type || '').toLowerCase() === 'credit' ? L('欠款 ', 'owes ') : ''}${esc(bal)}</td></tr>`;
    }).join('');
    B.push(`<section><h2>${L('资产小结', 'Assets')}</h2><div class="kpis">${tiles}</div><table class="clean">${rows}</table></section>`);
  }

  // ── 口径说明 ──
  B.push(`<section><h2>${L('口径说明', 'Methodology')}</h2><ul class="fine">
<li>${L('净支出 = 支出 − 退款/返还;收入、转账、信用卡还款不计入收支。', 'Net spend = gross − refunds/credits; income, transfers and card payments excluded.')}</li>
<li>${L('「vs 习惯」以近 6 个完整月中位数为基线;体检分项均附标准出处。', '"vs usual" uses the median of the last 6 full months; checkup items cite sources.')}</li>
<li>${L('本报告由确定性规则在本机生成,不构成投资建议。', 'Deterministic rules, on-device data, not investment advice.')}</li>
</ul></section>`);

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:14px/1.6 -apple-system,"Noto Sans SC",sans-serif;color:${INK};max-width:760px;margin:0 auto;padding:28px;background:#fff}
h1{font-size:22px;margin:0}
.sub{color:${MUTED};font-size:11.5px;margin:2px 0 18px}
h2{font-size:14px;margin:0 0 10px;color:${INK};letter-spacing:.02em}
h2::before{content:"";display:inline-block;width:4px;height:13px;border-radius:2px;background:${ACCENT};margin-right:7px;vertical-align:-2px}
section{margin:0 0 22px;break-inside:avoid}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.kpi{flex:1;min-width:130px;background:${BG_SOFT};border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.kl{font-size:11px;color:${MUTED}}
.kv{font-size:22px;font-weight:700}.kv.sm{font-size:17px}
.delta{font-size:11px;font-weight:600}
.hbar{display:flex;gap:2px;height:12px;border-radius:6px;overflow:hidden;margin:6px 0}
.hbar i{display:block;height:100%;border-radius:2px}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:${MUTED};margin:6px 0}
.lg i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:-.5px}
.donutrow{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.donutrow table{flex:1;min-width:280px}
table.clean{border-collapse:collapse;width:100%;font-size:12.5px}
table.clean td{padding:5px 8px;border-bottom:1px solid ${LINE};vertical-align:middle}
table.clean tr:last-child td{border-bottom:none}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.mname{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px;vertical-align:-1px}
.muted{color:${MUTED}}.small{font-size:11.5px;margin:4px 0 0}
.lede{color:${MUTED};font-size:12.5px;margin:0 0 8px}
ul.dots{list-style:none;padding:0;margin:0;font-size:12.5px}
ul.dots li{margin:6px 0;padding-left:16px;position:relative}
.dot{position:absolute;left:0;top:5px;width:8px;height:8px;border-radius:50%}
.score{margin:10px 0}
.scoretop{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:2px}
ul.fine{color:${MUTED};font-size:11px;padding-left:16px;margin:0}
ul.fine li{margin:3px 0}
@media print{body{padding:0}section{break-inside:avoid}}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="sub">${L(`生成于 ${now.toISOString().slice(0, 10)} · 数据只存本机 · 确定性规则生成(非 LLM)`, `Generated ${now.toISOString().slice(0, 10)} · on-device data · deterministic rules (no LLM)`)}</p>
${B.join('\n')}
</body></html>`;
}
