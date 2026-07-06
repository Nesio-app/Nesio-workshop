/**
 * 分析师大脑 —— 把 admin 指标 + 治理快照压成「精简日报 + 重要预警」,并且**会学**。
 *
 * 三条原则:
 *  1. 规则层负责判断,LLM 只负责说人话(buildAnalystPrompt)。预警绝不依赖 LLM 记得报。
 *  2. 基线学习(无监督):有历史时用 z-score 判异常(学这个 app 自己的水位);
 *     冷启动无历史时退回固定阈值,攒够天数自动切换。每条预警带 explain + basis 说明依据。
 *  3. 反馈学习(有监督):用户给预警点「有用/没用/误报」,据此静音老被忽略的类型、把在乎的排前面。
 *     risk 级永不静音(安全底线)。
 *
 * 卡(客户端只读)和邮件/cron(服务端)都调 buildDailyReport,一个大脑两个出口。
 */
import { anomaly, explainBaseline } from './analyst-baseline.mjs';

const SEV_RANK = { go: 0, gentle: 1, risk: 2 };
const pct = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`);
const num = (n) => (n == null ? '—' : Number(n).toLocaleString());

/** 把一天的指标+治理抽成一条扁平数值记录 —— 既做每日快照存库,也做基线的历史序列。 */
export function extractSignals(metrics, gov) {
  const m = metrics || {}, g = gov || {};
  const win = m.windows || {}, week = win.week || {}, month = win.month || {};
  const ai = (m.ai && m.ai.totals) || {};
  const errs = m.clientErrors || [];
  const snap = g.snapshot || {}, bus = snap.dataBus || {};
  const gc = (g.summary && g.summary.byStatus) || {};
  const fb = m.cardFeedback30d || {};
  const fbTotal = (fb.useful || 0) + (fb.wrong || 0) + (fb.too_much || 0) + (fb.other || 0);
  return {
    weekEvents: week.events ?? null,
    weekDevices: week.devices ?? null,
    monthEvents: month.events ?? null,
    aiCalls: ai.calls ?? null,
    aiCost: ai.estCostUsd ?? null,
    aiOkRate: ai.okRate ?? null,
    errTotal: errs.reduce((s, e) => s + (e.count || 0), 0),
    orphanedKeys: bus.orphanedDataKeyCount ?? null,
    drifted: gc.drifted ?? 0,
    dead: gc.dead ?? 0,
    driftWarn: snap.driftGuardWarnings ?? 0,
    fbWrongRate: fbTotal >= 1 ? (fb.wrong || 0) / fbTotal : null,
  };
}

/** 汇总反馈记录 → 每类预警的 { useful, dismiss, wrong, total, usefulRate, muted }。 */
export function summarizeFeedback(records) {
  const byType = {};
  for (const r of records || []) {
    const t = r.alertType || r.type;
    if (!t) continue;
    const b = byType[t] || (byType[t] = { useful: 0, dismiss: 0, wrong: 0, total: 0 });
    if (r.reaction === 'useful') b.useful++;
    else if (r.reaction === 'wrong') b.wrong++;
    else b.dismiss++;
    b.total++;
  }
  for (const t in byType) {
    const b = byType[t];
    b.usefulRate = b.total ? b.useful / b.total : null;
    // 攒够 4 条且有用率 < 25% → 静音(你老是忽略/标误报的类型,别再烦你)。
    b.muted = b.total >= 4 && b.useful / b.total < 0.25;
  }
  return byType;
}

function seriesFrom(history, key) {
  return (history || []).map((h) => (h ? h[key] : null)).filter((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * @param {any} metrics /api/admin/metrics 响应
 * @param {any} gov /api/admin/governance 响应
 * @param {{history?:any[], feedbackRecords?:any[], date?:string, k?:number, minSamples?:number}} [opts]
 */
export function buildDailyReport(metrics, gov, opts = {}) {
  const m = metrics || {}, g = gov || {};
  const today = extractSignals(m, g);
  const history = opts.history || [];
  const feedback = summarizeFeedback(opts.feedbackRecords);
  const k = opts.k ?? 3;
  const minSamples = opts.minSamples ?? 10;

  const gc = (g.summary && g.summary.byStatus) || {};
  const errs = m.clientErrors || [];
  const fb = m.cardFeedback30d || {};
  const ai = (m.ai && m.ai.totals) || {};

  const alerts = [];
  const add = (type, severity, title, detail, advice, explain, basis) =>
    alerts.push({ type, severity, title, detail, advice, explain, basis });

  // ---- 活跃度:基线优先,冷启动退回环比 ±30% ----
  if ((today.monthEvents || 0) > 20) {
    const a = anomaly(today.weekEvents, seriesFrom(history, 'weekEvents'), { k, minSamples });
    if (!a.cold && a.isAnomaly) {
      if (a.direction === 'down') add('activity_drop', 'risk', '活跃度异常下滑', `本周 ${num(today.weekEvents)} 事件 / ${num(today.weekDevices)} 设备。`, '看趋势图找到下滑那天,回想当天改了/发生了什么。', explainBaseline(today.weekEvents, a), 'learned');
      else add('activity_spike', 'go', '活跃度异常上涨', `本周 ${num(today.weekEvents)} 事件。`, '看 Top 事件是哪个功能带的量,往它上加东西。', explainBaseline(today.weekEvents, a), 'learned');
    } else if (a.cold) {
      const d = m.deltas ? m.deltas.weekVsPrevWeek : null;
      if (d != null && d <= -30) add('activity_drop', 'risk', `活跃度环比掉 ${Math.abs(d)}%`, `本周 ${num(today.weekEvents)} 事件。`, '看趋势图找到下滑那天。', explainBaseline(today.weekEvents, a), 'static');
      else if (d != null && d >= 30) add('activity_spike', 'go', `活跃度环比涨 ${d}%`, `本周 ${num(today.weekEvents)} 事件。`, '看 Top 事件带量的功能。', explainBaseline(today.weekEvents, a), 'static');
    }
  }

  // ---- AI 成功率:绝对底线永远在(<90% 就是坏),叠加基线下滑 ----
  if (today.aiOkRate != null && (today.aiCalls || 0) >= 10) {
    if (today.aiOkRate < 0.9) {
      add('ai_okrate', 'risk', `AI 成功率 ${Math.round(today.aiOkRate * 100)}%`, `${num(today.aiCalls)} 次调用,低于 90% 底线。`, '看 AI 路由拆分谁在失败;先查 key/限流/超时。', '绝对底线:成功率 <90%', 'static');
    } else {
      const a = anomaly(today.aiOkRate, seriesFrom(history, 'aiOkRate'), { k, minSamples });
      if (!a.cold && a.isAnomaly && a.direction === 'down') add('ai_okrate', 'gentle', 'AI 成功率异常回落', `当前 ${Math.round(today.aiOkRate * 100)}%。`, '虽未破 90%,但明显低于常态,提前查查。', explainBaseline(Math.round(today.aiOkRate * 100), a, '%'), 'learned');
    }
  }

  // ---- AI 成本:基线优先(成本骤升),冷启动退回 $5 ----
  if (today.aiCost != null) {
    const a = anomaly(today.aiCost, seriesFrom(history, 'aiCost'), { k, minSamples });
    if (!a.cold && a.isAnomaly && a.direction === 'up') add('ai_cost', 'gentle', 'AI 成本异常上升', `约 $${today.aiCost}。`, '看哪条路由占大头,评估加缓存/降模型。', explainBaseline(today.aiCost, a, '$'), 'learned');
    else if (a.cold && today.aiCost >= 5) add('ai_cost', 'gentle', `AI 成本 $${today.aiCost}`, '按当前用量估算。', '看哪条路由占大头。', '冷启动:固定阈值 $5', 'static');
  }

  // ---- 客户端报错:基线优先(报错量骤升),叠加绝对严重度 ----
  if (errs.length) {
    const top = errs[0];
    const a = anomaly(today.errTotal, seriesFrom(history, 'errTotal'), { k, minSamples });
    const absSevere = (top.devices || 0) >= 3 || today.errTotal >= 20;
    const spiked = !a.cold && a.isAnomaly && a.direction === 'up';
    if (absSevere || spiked) {
      add('client_errors', absSevere ? 'risk' : 'gentle', `客户端报错 ${num(today.errTotal)} 次`, `最多:「${top.kind || top.message || '未知'}」×${num(top.count)}(${num(top.devices)} 台)。`, '先复现 top 报错;命中设备越多越优先。', spiked ? explainBaseline(today.errTotal, a) : '绝对严重度:多设备或量大', spiked ? 'learned' : 'static');
    }
  }

  // ---- 治理回归:存在即报(计数型,非水位型);孤立键用基线看「比平时多」 ----
  if ((gc.drifted || 0) > 0) add('gov_drift', 'gentle', `治理漂移 ${gc.drifted} 项`, '契约声明了、运行时没照做——假约束。', 'admin 治理版块看「需要动手」,对齐或删。', '治理回归:出现漂移项', 'static');
  if ((gc.dead || 0) > 0) add('gov_dead', 'gentle', `死代码 ${gc.dead} 项`, '接了但零消费的端点/文件。', '零风险净删。', '治理回归:出现死代码', 'static');
  if ((today.driftWarn || 0) > 0) add('gov_warn', 'gentle', `注册表告警 ${today.driftWarn}`, '模块元数据缺 owner/entry/status。', '补齐元数据或降级模块。', '治理回归:注册表告警', 'static');
  {
    const a = anomaly(today.orphanedKeys, seriesFrom(history, 'orphanedKeys'), { k, minSamples });
    if (!a.cold && a.isAnomaly && a.direction === 'up') add('orphaned_keys', 'gentle', '孤立 data-key 异常增多', `当前 ${num(today.orphanedKeys)} 个。`, '新加的 data-key 没接线;补消费方或删声明。', explainBaseline(today.orphanedKeys, a), 'learned');
  }

  // ---- 洞察卡「不准」占比 ----
  {
    const fbTotal = (fb.useful || 0) + (fb.wrong || 0) + (fb.too_much || 0) + (fb.other || 0);
    if (fbTotal >= 10 && (fb.wrong || 0) / fbTotal > 0.3) add('card_wrong', 'gentle', `洞察卡「不准」占比 ${Math.round((fb.wrong / fbTotal) * 100)}%`, `${num(fb.wrong)}/${num(fbTotal)} 反馈为不准。`, '看被标不准的卡类型,调阈值或数据源。', '固定阈值:不准率 >30%', 'static');
  }

  // ---- 反馈学习:附上每类的历史反馈;静音老被忽略的(risk 永不静音);按严重度+有用率排序 ----
  for (const a of alerts) a.learned = feedback[a.type] || null;
  const surfaced = alerts.filter((a) => !(a.learned && a.learned.muted && a.severity !== 'risk'));
  surfaced.sort((x, y) => {
    const s = SEV_RANK[y.severity] - SEV_RANK[x.severity];
    if (s) return s;
    return (y.learned?.usefulRate ?? 0.5) - (x.learned?.usefulRate ?? 0.5);
  });

  // ---- 要点(无论有没有预警都给)----
  const week = (m.windows && m.windows.week) || {};
  const dAct = m.deltas ? m.deltas.weekVsPrevWeek : null;
  const smart = m.smartness || {};
  const fbTotal = (fb.useful || 0) + (fb.wrong || 0) + (fb.too_much || 0) + (fb.other || 0);
  const keyPoints = [
    `活跃:本周 ${num(week.events)} 事件 / ${num(week.devices)} 设备(环比 ${pct(dAct)})`,
    `AI:${num(ai.calls)} 次,约 $${ai.estCostUsd ?? '—'},成功率 ${ai.okRate == null ? '—' : Math.round(ai.okRate * 100) + '%'}`,
    `治理:${gc.enforced || 0} 强制 / ${gc['report-only'] || 0} 报告 / ${gc.dormant || 0} 休眠,漂移 ${gc.drifted || 0} · 死 ${gc.dead || 0}`,
    `数据总线:${num(today.orphanedKeys)} 孤立键`,
  ];
  if (fbTotal > 0) keyPoints.push(`洞察卡反馈:有用 ${num(fb.useful)} · 不准 ${num(fb.wrong)} · 太多 ${num(fb.too_much)}`);
  if (smart.score != null) keyPoints.push(`数据完整度评分:${smart.score}`);

  const status = surfaced.reduce((wv, a) => (SEV_RANK[a.severity] > SEV_RANK[wv] ? a.severity : wv), 'go');
  const riskN = surfaced.filter((a) => a.severity === 'risk').length;
  const mutedN = alerts.length - surfaced.length;
  const learnedN = surfaced.filter((a) => a.basis === 'learned').length;
  const headline = riskN > 0
    ? `⚠ ${riskN} 项需要注意`
    : surfaced.length ? `${surfaced.length} 条提示,无紧急项` : '一切平稳,无预警';

  return {
    date: opts.date || new Date().toISOString().slice(0, 10),
    status, headline, keyPoints, alerts: surfaced,
    learning: { historyDays: history.length, learnedAlerts: learnedN, mutedByFeedback: mutedN, feedbackTypes: Object.keys(feedback).length },
    signals: today,
  };
}

/** 纯文本渲染(邮件、日志)。 */
export function renderReportText(r) {
  const lines = [`【Nesio 分析师日报 · ${r.date}】`, r.headline, '', '要点:'];
  for (const p of r.keyPoints) lines.push(`· ${p}`);
  if (r.alerts.length) {
    lines.push('', '预警:');
    for (const a of r.alerts) {
      const tag = { go: '↑', gentle: '•', risk: '⚠' }[a.severity] || '•';
      lines.push(`${tag} ${a.title} —— ${a.detail} 建议:${a.advice}${a.explain ? `(依据:${a.explain})` : ''}`);
    }
  }
  if (r.learning) lines.push('', `[学习] 历史 ${r.learning.historyDays} 天 · 基线判定 ${r.learning.learnedAlerts} 条 · 按你反馈静音 ${r.learning.mutedByFeedback} 条`);
  return lines.join('\n');
}

/** 给 LLM 的润色提示 —— 改文风、不改数字、不新增结论。 */
export function buildAnalystPrompt(r) {
  return [
    '你是 Nesio 的产品分析师。下面是今天由确定性规则(含基线学习)算出的要点与预警,数字与依据均已核实。',
    '请用简体中文写一段 4–6 句日报:先一句总体判断,再点出最该关注的 1–2 件事并给可执行建议。',
    '要求:口语、精简、像同事汇报;不得新增规则外的结论,不得改动任何数字;挑重要的说,不要罗列全部。',
    '',
    `日期:${r.date} · 总体:${r.headline}`,
    '要点:', ...r.keyPoints.map((p) => `- ${p}`),
    r.alerts.length ? '预警:' : '',
    ...r.alerts.map((a) => `- [${a.severity}] ${a.title}:${a.detail} 依据:${a.explain || '—'} 建议:${a.advice}`),
  ].filter(Boolean).join('\n');
}
