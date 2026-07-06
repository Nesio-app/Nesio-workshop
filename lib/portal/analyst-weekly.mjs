/**
 * 周报 —— 比日报高一层:把最近 7 天的每日快照聚合成趋势(本周 vs 一周前、均值、变化幅度),
 * 挑出变化最大的几项。纯函数、可测。日报回答「今天怎么样」,周报回答「这一周走势如何」。
 */
import { SIGNAL_LABELS } from './analyst.mjs';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString());

/**
 * @param {Array<{date:string, signals:Record<string,number|null>}>} rows  最近在前(date.desc)
 */
export function buildWeeklyReport(rows, opts = {}) {
  const win = (rows || []).slice(0, 7);
  const days = win.length;
  const latest = (win[0] && win[0].signals) || {};
  const weekAgo = (win[days - 1] && win[days - 1].signals) || {};

  const trends = [];
  for (const [key, label] of Object.entries(SIGNAL_LABELS)) {
    const series = win.map((r) => r.signals && r.signals[key]).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!series.length) continue;
    const cur = typeof latest[key] === 'number' ? latest[key] : null;
    const prev = typeof weekAgo[key] === 'number' ? weekAgo[key] : null;
    const avg = Math.round((series.reduce((s, v) => s + v, 0) / series.length) * 100) / 100;
    const deltaPct = (cur != null && prev != null && prev !== 0) ? Math.round(((cur - prev) / Math.abs(prev)) * 100) : null;
    trends.push({ key, label, latest: cur, weekAgo: prev, avg, deltaPct });
  }

  const notable = trends.filter((t) => t.deltaPct != null).sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct)).slice(0, 3);
  const from = (win[days - 1] && win[days - 1].date) || null;
  const to = (win[0] && win[0].date) || null;
  const headline = days < 3
    ? `本周数据不足(仅 ${days} 天)`
    : notable.length ? `本周关注:${notable[0].label} ${notable[0].deltaPct > 0 ? '+' : ''}${notable[0].deltaPct}%` : '本周各项平稳';

  return { date: opts.date || to, range: { from, to }, days, trends, notable, headline };
}

export function renderWeeklyText(w) {
  const lines = [`【Nesio 分析师周报 · ${w.range.from || '—'} → ${w.range.to || '—'}(${w.days} 天)】`, w.headline, '', '趋势:'];
  for (const t of w.trends) {
    const arrow = t.deltaPct == null ? '·' : t.deltaPct > 0 ? '↑' : t.deltaPct < 0 ? '↓' : '→';
    lines.push(`${arrow} ${t.label}:本周 ${num(t.latest)}(均 ${num(t.avg)})${t.deltaPct == null ? '' : `,较一周前 ${t.deltaPct > 0 ? '+' : ''}${t.deltaPct}%`}`);
  }
  return lines.join('\n');
}

export function buildWeeklyPrompt(w) {
  return [
    '你是 Nesio 的产品分析师。下面是最近一周由确定性规则聚合的趋势(数字已核实)。',
    '请用简体中文写一段 4–6 句周报:先一句本周总体走势,再点出变化最大的 1–2 项及可能原因/建议。',
    '要求:口语、精简;不新增结论,不改数字;讲趋势不罗列全部。',
    '',
    `区间:${w.range.from} → ${w.range.to}(${w.days} 天) · 总体:${w.headline}`,
    '趋势:',
    ...w.trends.map((t) => `- ${t.label}:本周 ${num(t.latest)},均 ${num(t.avg)}${t.deltaPct == null ? '' : `,较一周前 ${t.deltaPct > 0 ? '+' : ''}${t.deltaPct}%`}`),
  ].join('\n');
}
