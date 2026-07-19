/**
 * 分析师日报生成 + 投递。
 *   GET  —— Vercel Cron 每日触发(Authorization: Bearer CRON_SECRET)。
 *   POST —— /admin「发送到邮箱」按钮(requireAdmin)。
 *
 * 流程:服务端自调 /api/admin/metrics + /api/admin/governance(用 env 的 admin secret 授权)
 *   → 规则大脑 buildDailyReport(确定性)→ 可选 AI 润色(失败/未配置则用确定性文本兜底)
 *   → Resend REST 发邮件(未配置 RESEND_API_KEY/ANALYST_EMAIL_TO 则 emailed:false)。
 *
 * 邮件所需环境变量(都没配也不报错,只是不发):
 *   RESEND_API_KEY, ANALYST_EMAIL_TO, 可选 ANALYST_EMAIL_FROM。
 * Cron 授权:CRON_SECRET。服务端自调授权:NESIO_ADMIN_SECRET。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/portal/admin-gate';
import { renderReportText, buildAnalystPrompt } from '@/lib/portal/analyst.mjs';
import { aiProviderAvailable, completeText } from '@/lib/portal/ai-complete';
import { computeDailyReport } from '@/lib/portal/analyst-runtime';
import { saveDaily } from '@/lib/portal/analyst-store';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

function isCronAuthorized(req: NextRequest): boolean {
  const cron = envValue('CRON_SECRET');
  if (!cron) return false;
  return (req.headers.get('authorization') || '') === `Bearer ${cron}`;
}

async function runAnalyst(req: NextRequest) {
  const { report, signals, sourcesOk } = await computeDailyReport(req.nextUrl.origin, envValue('NESIO_ADMIN_SECRET'));

  // 存今日快照 —— 明天起就有历史给基线学习。数据源失败时**不存**,否则把「故障=0」的
  // 假快照灌进 analyst_daily,永久污染 client_errors 等基线(修 analyst-runtime:33)。
  const saved = sourcesOk ? await saveDaily(report.date, signals) : false;

  // 可选 AI 润色:只改文风,不改数字/结论;失败或未配置 → 确定性文本兜底。
  let narrative = '';
  if (aiProviderAvailable()) {
    try {
      const { text } = await completeText({ prompt: buildAnalystPrompt(report), maxTokens: 400, route: 'analyst-run' });
      narrative = (text || '').trim();
    } catch { /* 兜底 */ }
  }
  const emailBody = (narrative ? `${narrative}\n\n———\n` : '') + renderReportText(report);

  let emailed = false;
  let emailError: string | undefined;
  const key = envValue('RESEND_API_KEY');
  const to = envValue('ANALYST_EMAIL_TO');
  const from = envValue('ANALYST_EMAIL_FROM') || 'Nesio 分析师 <onboarding@resend.dev>';
  if (key && to) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject: `Nesio 分析师日报 · ${report.date} · ${report.headline}`, text: emailBody }),
      });
      emailed = r.ok;
      if (!r.ok) emailError = `resend_${r.status}`;
    } catch {
      emailError = 'resend_network';
    }
  } else {
    emailError = 'email_not_configured';
  }

  return NextResponse.json({ ok: true, emailed, emailError, saved, report, narrative: narrative || null });
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const blocked = requireAdmin(req, 'admin-analyst-run');
    if (blocked) return blocked;
  }
  return runAnalyst(req);
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const blocked = requireAdmin(req, 'admin-analyst-run');
    if (blocked) return blocked;
  }
  return runAnalyst(req);
}
