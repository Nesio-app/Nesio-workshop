/**
 * POST /api/portal/gmail/draft-reply
 * AI-drafts a reply the user can edit before sending. Does NOT send anything —
 * it only returns text into the compose box. The user always reviews, edits,
 * and clicks 发送 themselves (send happens via /api/portal/gmail/send).
 *
 * Body: { from?, subject?, snippet?, article?, intent?, tone? }
 * Returns: { ok, draft } | { ok:false, error }
 */
import { NextRequest, NextResponse } from 'next/server';
import { hasNesioSession } from '@/lib/portal/gmail-access';

export const dynamic = 'force-dynamic';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

const TONE_HINT: Record<string, string> = {
  polite: '礼貌、得体、尊重对方。',
  concise: '简洁、直接、只说要点,尽量短。',
  warm: '热情、亲切、有温度。',
  decline: '委婉但明确地拒绝或推辞,保留关系。',
  followup: '跟进/催促,礼貌地推动对方回复或行动。',
};

export async function POST(req: NextRequest) {
  if (!(await hasNesioSession())) {
    return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });
  }

  const geminiKey = envValue('GEMINI_API_KEY') || envValue('GOOGLE_GENERATIVE_AI_API_KEY');
  if (!geminiKey) {
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
    '你是用户的邮件助手,帮 TA 起草一封回复。',
    '要求:',
    '1. 用与原邮件相同的语言写(中文邮件就用中文,英文就用英文)。',
    '2. 以用户第一人称写,自然、像真人。',
    '3. 只输出回复正文本身 —— 不要写主题行,不要加「以下是回复」之类的说明,不要用占位符如 [你的名字]。',
    '4. 不要编造事实、数字或承诺;需要用户补充的地方,用一句自然的话带过。',
    toneHint ? `5. 语气:${toneHint}` : '',
    '',
    '── 原邮件 ──',
    from ? `发件人:${from}` : '',
    subject ? `主题:${subject}` : '',
    original ? `正文:\n${original}` : '',
    '',
    intent ? `用户希望这封回复表达:${intent}` : '用户没有特别说明,请根据原邮件给出一封得体的默认回复。',
    '',
    '现在只输出回复正文:',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 800 },
      }),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: 'ai_failed', status: res.status }, { status: 502 });
    }
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const draft = (data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '').trim();
    if (!draft) {
      return NextResponse.json({ ok: false, error: 'empty_draft' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, draft }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'ai_failed' }, { status: 502 });
  }
}
