/**
 * POST /api/portal/gmail/draft-reply
 * AI-drafts a reply the user can edit before sending. Does NOT send anything —
 * it only returns text into the compose box. The user always reviews, edits,
 * and clicks 发送 themselves (send happens via /api/portal/gmail/send).
 *
 * Body: { from?, subject?, snippet?, article?, intent?, tone? }
 * Returns: { ok, draft } | { ok:false, error, detail? }
 *
 * Uses the shared completeText() channel (Claude → Gemini fallback) so it works
 * on whatever provider this deployment has — not a single hard-coded Gemini model.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isRateLimited } from '@/lib/portal/api-auth';
import { hasNesioSession } from '@/lib/portal/gmail-access';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TONE_HINT: Record<string, string> = {
  polite: '礼貌、得体、尊重对方。',
  concise: '简洁、直接、只说要点,尽量短。',
  warm: '热情、亲切、有温度。',
  decline: '委婉但明确地拒绝或推辞,保留关系。',
  followup: '跟进/催促,礼貌地推动对方回复或行动。',
};

const SYSTEM = [
  '你是用户的邮件助手,帮 TA 起草一封回复。要求:',
  '1. 用与原邮件相同的语言写(中文邮件就用中文,英文就用英文)。',
  '2. 以用户第一人称写,自然、像真人。',
  '3. 只输出回复正文本身 —— 不要写主题行,不要加「以下是回复」之类的说明,不要用占位符如 [你的名字]。',
  '4. 不要编造事实、数字或承诺;需要用户补充的地方,用一句自然的话带过。',
].join('\n');

export async function POST(req: NextRequest) {
  if (!(await hasNesioSession())) {
    return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });
  }
  if (isRateLimited(req, 'gmail-draft-reply', { limit: 15 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited', retryAfterMs: 30_000 }, { status: 429 });
  }

  if (!aiProviderAvailable()) {
    return NextResponse.json({ ok: false, error: 'ai_not_configured' }, { status: 503 });
  }

  let payload: { from?: string; subject?: string; snippet?: string; article?: string; intent?: string; tone?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const from = (payload.from || '').trim();
  const subject = (payload.subject || '').trim();
  const original = (payload.article || payload.snippet || '').trim().slice(0, 4000);
  const intent = (payload.intent || '').trim().slice(0, 500);
  const toneHint = TONE_HINT[payload.tone || ''] || '';

  if (!original && !subject) {
    return NextResponse.json({ ok: false, error: 'no_context' }, { status: 400 });
  }

  const prompt = [
    '── 原邮件 ──',
    from ? `发件人:${from}` : '',
    subject ? `主题:${subject}` : '',
    original ? `正文:\n${original}` : '',
    '',
    toneHint ? `语气要求:${toneHint}` : '',
    intent ? `用户希望这封回复表达:${intent}` : '用户没有特别说明,请根据原邮件给出一封得体的默认回复。',
    '',
    '现在只输出回复正文:',
  ].filter(Boolean).join('\n');

  try {
    const { text } = await completeText({ prompt, system: SYSTEM, maxTokens: 900 });
    const draft = text.trim();
    if (!draft) {
      return NextResponse.json({ ok: false, error: 'empty_draft' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, draft }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown';
    console.error('[draft-reply] ai_failed:', detail);
    return NextResponse.json({ ok: false, error: 'ai_failed', detail }, { status: 502 });
  }
}
