/**
 * 分析师周报。
 *   GET  —— Vercel Cron 每周触发(Authorization: Bearer CRON_SECRET)。
 *   POST —— /admin「本周总结」按钮(requireAdmin)。
 *
 * 从 analyst_daily 读最近 14 天带日期快照 → buildWeeklyReport 聚合趋势 →
 * 可选 AI 润色 → Resend 发邮件。不写库(只读聚合)。未配 Supabase → 数据不足提示。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/portal/admin-gate';
import { buildWeeklyReport, renderWeeklyText, buildWeeklyPrompt } from '@/lib/portal/analyst-weekly.mjs';
import { loadHistoryWithDates } from '@/lib/portal/analyst-store';
import { aiProviderAvailable, completeText } from '@/lib/portal/ai-complete';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

function isCronAuthorized(req: NextRequest): boolean {
  const cron = envValue('CRON_SECRET');
  if (!cron) return false;
  return (req.headers.get('authorization') || '') === `Bearer ${cron}`;
}

async function runWeekly(req: NextRequest) {
  const rows = await loadHistoryWithDates(14);
  const report = buildWeeklyReport(rows);

  let narrative = '';
  if (aiProviderAvailable()) {
    try {
      const { text } = await completeText({ prompt: buildWeeklyPrompt(report), maxTokens: 400, route: 'analyst-weekly' });
      narrative = (text || '').trim();
    } catch { /* 兜底 */ }
  }
  const emailBody = (narrative ? `${narrative}\n\n———\n` : '') + renderWeeklyText(report);

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
        body: JSON.stringify({ from, to, subject: `Nesio 分析师周报 · ${report.range.from || ''}→${report.range.to || ''} · ${report.headline}`, text: emailBody }),
      });
      emailed = r.ok;
      if (!r.ok) emailError = `resend_${r.status}`;
    } catch {
      emailError = 'resend_network';
    }
  } else {
    emailError = 'email_not_configured';
  }

  return NextResponse.json({ ok: true, emailed, emailError, report, narrative: narrative || null });
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const blocked = requireAdmin(req, 'admin-analyst-weekly');
    if (blocked) return blocked;
  }
  return runWeekly(req);
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const blocked = requireAdmin(req, 'admin-analyst-weekly');
    if (blocked) return blocked;
  }
  return runWeekly(req);
}
