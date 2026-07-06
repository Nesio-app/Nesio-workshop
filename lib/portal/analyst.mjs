/**
 * 分析师大脑 —— 把 admin 的原始指标 + 治理快照,压成「精简日报 + 重要预警」。
 *
 * 设计要点:**规则层负责判断,LLM 只负责说人话。**
 * 这个文件是纯确定性规则(可测、无网络):算出 alerts[] 与 keyPoints[]。
 * AI 润色是可选增强(见 buildAnalystPrompt);AI 不可用时直接用这里的确定性文本兜底,
 * 所以日报永远有,永远可靠 —— 预警绝不依赖 LLM 记得报。
 *
 * 卡(客户端)和邮件(服务端 cron)都调 buildDailyReport,一个大脑两个出口。
 */

/** @typedef {'go'|'gentle'|'risk'} Severity */
const SEV_RANK = { go: 0, gentle: 1, risk: 2 };
const pct = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`);
const num = (n) => (n == null ? '—' : Number(n).toLocaleString());

/**
 * @param {any} metrics  /api/admin/metrics 的响应
 * @param {any} gov       /api/admin/governance 的响应
 * @param {{date?:string}} [opts]
 * @returns {{date:string,status:Severity,headline:string,keyPoints:string[],
 *            alerts:Array<{severity:Severity,title:string,detail:string,advice:string}>}}
 */
export function buildDailyReport(metrics, gov, opts = {}) {
  const m = metrics || {};
  const g = gov || {};
  const win = m.windows || {};
  const week = win.week || {};
  const dAct = m.deltas ? m.deltas.weekVsPrevWeek : null;
  const ai = (m.ai && m.ai.totals) || {};
  const errs = m.clientErrors || [];
  const fb = m.cardFeedback30d || {};
  const smart = m.smartness || {};
  const snap = g.snapshot || {};
  const gCounts = (g.summary && g.summary.byStatus) || {};
  const bus = snap.dataBus || {};

  const alerts = [];
  const add = (severity, title, detail, advice) => alerts.push({ severity, title, detail, advice });

  // --- 活跃度环比 ---
  const monthEvents = (win.month && win.month.events) || 0;
  if (dAct != null && monthEvents > 20) {
    if (dAct <= -30) add('risk', `活跃度环比掉 ${Math.abs(dAct)}%`, `近 7 天 ${num(week.events)} 事件 / ${num(week.devices)} 设备。`, '看趋势图找到下滑那天,回想当天改了/发生了什么。');
    else if (dAct >= 30) add('go', `活跃度环比涨 ${dAct}%`, `近 7 天 ${num(week.events)} 事件。`, '看 Top 事件是哪个功能带的量,往它上面加东西。');
  }

  // --- AI 健康 & 成本 ---
  if (ai.okRate != null && ai.calls >= 10 && ai.okRate < 0.9) {
    add('risk', `AI 成功率 ${Math.round(ai.okRate * 100)}%`, `${num(ai.calls)} 次调用,成功率偏低。`, '看 admin AI 路由拆分,哪条路由在失败;先查 provider key / 限流 / 超时。');
  }
  if (ai.estCostUsd != null && ai.estCostUsd >= 5) {
    add('gentle', `AI 成本 $${ai.estCostUsd}`, `按当前用量估算。`, '看哪条路由占大头,评估是否加缓存/降模型。');
  }

  // --- 客户端报错 ---
  if (errs.length) {
    const top = errs[0];
    const totalErr = errs.reduce((s, e) => s + (e.count || 0), 0);
    const sev = (top.devices || 0) >= 3 || totalErr >= 20 ? 'risk' : 'gentle';
    add(sev, `客户端报错 ${num(totalErr)} 次`, `最多:「${top.kind || top.message || '未知'}」×${num(top.count)}(${num(top.devices)} 台设备)。`, '先复现 top 报错;它命中的设备越多越优先。');
  }

  // --- 治理回归 ---
  const drifted = gCounts.drifted || 0;
  const dead = gCounts.dead || 0;
  if (drifted > 0) add('gentle', `治理漂移 ${drifted} 项`, '契约声明了、运行时没照做 —— 假约束。', '在 admin 治理版块看「需要动手」,对齐或删。');
  if (dead > 0) add('gentle', `死代码 ${dead} 项`, '接了但零消费的端点/文件。', '零风险净删。');
  if ((snap.driftGuardWarnings || 0) > 0) add('gentle', `注册表告警 ${snap.driftGuardWarnings}`, '模块元数据缺 owner/entry/status/evidence。', '补齐元数据或降级该模块。');

  // --- 卡片反馈质量 ---
  const fbTotal = (fb.useful || 0) + (fb.wrong || 0) + (fb.too_much || 0) + (fb.other || 0);
  if (fbTotal >= 10 && (fb.wrong || 0) / fbTotal > 0.3) {
    add('gentle', `洞察卡「不准」占比 ${Math.round((fb.wrong / fbTotal) * 100)}%`, `${num(fb.wrong)}/${num(fbTotal)} 反馈为不准。`, '看被标不准的卡类型,调对应算法阈值或数据源。');
  }

  // --- 要点(无论有没有预警都给,替代读面板)---
  const keyPoints = [
    `活跃:本周 ${num(week.events)} 事件 / ${num(week.devices)} 设备(环比 ${pct(dAct)})`,
    `AI:${num(ai.calls)} 次调用,约 $${ai.estCostUsd ?? '—'},成功率 ${ai.okRate == null ? '—' : Math.round(ai.okRate * 100) + '%'}`,
    `治理:${gCounts.enforced || 0} 强制 / ${gCounts['report-only'] || 0} 报告 / ${gCounts.dormant || 0} 休眠,漂移 ${drifted} · 死 ${dead}`,
    `数据总线:${num(bus.dataKeyCount)} 键,孤立 ${num(bus.orphanedDataKeyCount)}`,
  ];
  if (fbTotal > 0) keyPoints.push(`洞察卡反馈:有用 ${num(fb.useful)} · 不准 ${num(fb.wrong)} · 太多 ${num(fb.too_much)}`);
  if (smart.score != null) keyPoints.push(`数据完整度评分:${smart.score}${(smart.dims || []).some((d) => d.thin) ? `(有偏薄维度)` : ''}`);

  const status = alerts.reduce((w, a) => (SEV_RANK[a.severity] > SEV_RANK[w] ? a.severity : w), 'go');
  const riskN = alerts.filter((a) => a.severity === 'risk').length;
  const headline = riskN > 0
    ? `⚠ ${riskN} 项需要注意`
    : alerts.some((a) => a.severity === 'gentle')
      ? `${alerts.length} 条温和提示,无紧急项`
      : '一切平稳,无预警';

  return { date: opts.date || new Date().toISOString().slice(0, 10), status, headline, keyPoints, alerts };
}

/** 纯文本/Markdown 渲染(邮件、日志用)。 */
export function renderReportText(r) {
  const lines = [`【Nesio 分析师日报 · ${r.date}】`, r.headline, '', '要点:'];
  for (const p of r.keyPoints) lines.push(`· ${p}`);
  if (r.alerts.length) {
    lines.push('', '预警:');
    for (const a of r.alerts) {
      const tag = { go: '↑', gentle: '•', risk: '⚠' }[a.severity] || '•';
      lines.push(`${tag} ${a.title} —— ${a.detail} 建议:${a.advice}`);
    }
  }
  return lines.join('\n');
}

/** 给 LLM 的润色提示 —— 让它把确定性要点改写得更连贯,但不新增结论、不改数字。 */
export function buildAnalystPrompt(r) {
  return [
    '你是 Nesio 的产品分析师。下面是今天由确定性规则算出的要点与预警(数字已核实)。',
    '请用简体中文写一段 4–6 句的日报:先一句总体判断,再点出最该关注的 1–2 件事,给出可执行建议。',
    '要求:口语、精简、像同事汇报;不得新增规则里没有的结论,不得改动任何数字;不要罗列所有要点,挑重要的说。',
    '',
    `日期:${r.date}`,
    `总体:${r.headline}`,
    '要点:',
    ...r.keyPoints.map((p) => `- ${p}`),
    r.alerts.length ? '预警:' : '',
    ...r.alerts.map((a) => `- [${a.severity}] ${a.title}:${a.detail} 建议:${a.advice}`),
  ].filter(Boolean).join('\n');
}
