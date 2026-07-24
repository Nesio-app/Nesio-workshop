/**
 * POST /api/alexa — Alexa 自定义技能的 HTTPS 端点(智能家居·语音入口)。
 *
 * 让满屋 Echo 变成 Nesio 的语音前端:随口记(CaptureMemory)、随口问(AskMemory)。
 * ⚠️ Alexa **不支持中文**,交互语言为英文(en-US);中文语音需走别的硬件(小爱/天猫精灵)。
 *
 * 校验(个人/开发版够用):
 *   ① applicationId === ALEXA_SKILL_ID(env);② 请求 timestamp 新鲜(≤150s,防重放)。
 *   —— 发布上架还需完整的 SignatureCertChainUrl 证书链校验(见 docs/alexa-skill-setup.md)。
 * 用户归属:账号关联(access token)→ 走 ingest;个人单用户可只配 INGEST_SHARED_SECRET
 *   直接落到 owner 的记忆(捕获转发 /api/portal/ingest,复用抽取+写云管道)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export type AlexaAction =
  | { kind: 'welcome' }
  | { kind: 'capture'; content: string }
  | { kind: 'ask'; query: string }
  | { kind: 'help' }
  | { kind: 'end' }
  | { kind: 'reject'; reason: string };

interface AlexaBody {
  request?: { type?: string; timestamp?: string; intent?: { name?: string; slots?: Record<string, { value?: string }> } };
  session?: { application?: { applicationId?: string } };
  context?: { System?: { application?: { applicationId?: string }; user?: { accessToken?: string } } };
}

/** 纯路由:Alexa 请求 → 意图动作(可单测,无副作用)。 */
export function routeAlexa(body: AlexaBody | null | undefined): AlexaAction {
  const req = body?.request;
  const type = req?.type;
  if (type === 'LaunchRequest') return { kind: 'welcome' };
  if (type === 'SessionEndedRequest') return { kind: 'end' };
  if (type === 'IntentRequest') {
    const name = req?.intent?.name || '';
    const slots = req?.intent?.slots || {};
    const slot = (n: string) => (typeof slots[n]?.value === 'string' ? slots[n]!.value!.trim() : '');
    switch (name) {
      case 'CaptureMemoryIntent': { const c = slot('content'); return c ? { kind: 'capture', content: c } : { kind: 'reject', reason: 'empty_content' }; }
      case 'AskMemoryIntent': { const q = slot('query'); return q ? { kind: 'ask', query: q } : { kind: 'reject', reason: 'empty_query' }; }
      case 'AMAZON.HelpIntent': return { kind: 'help' };
      case 'AMAZON.StopIntent':
      case 'AMAZON.CancelIntent': return { kind: 'end' };
      default: return { kind: 'help' };
    }
  }
  return { kind: 'reject', reason: 'unknown_request' };
}

function say(text: string, endSession = true, reprompt?: string) {
  return NextResponse.json({
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      ...(reprompt ? { reprompt: { outputSpeech: { type: 'PlainText', text: reprompt } } } : {}),
      shouldEndSession: endSession,
    },
  });
}

/** applicationId + 时间戳新鲜度校验。返回错误字符串或 null(通过)。 */
function verify(body: AlexaBody): string | null {
  const expected = envValue('ALEXA_SKILL_ID');
  if (!expected) return 'skill_not_configured';
  const appId = body.context?.System?.application?.applicationId || body.session?.application?.applicationId || '';
  if (appId !== expected) return 'bad_application_id';
  const ts = body.request?.timestamp ? Date.parse(body.request.timestamp) : NaN;
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 150_000) return 'stale_timestamp';
  return null;
}

export async function POST(req: NextRequest) {
  let body: AlexaBody;
  try { body = await req.json() as AlexaBody; } catch { return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 }); }

  const bad = verify(body);
  if (bad) return NextResponse.json({ ok: false, error: bad }, { status: bad === 'skill_not_configured' ? 503 : 400 });

  const action = routeAlexa(body);

  if (action.kind === 'welcome') return say('Nesio is here. Say: remember, and then anything you want to keep. Or ask, and then your question.', false, 'Say "remember" followed by a note, or "ask" followed by a question.');
  if (action.kind === 'help') return say('You can say: Nesio, remember the spare keys are in the hallway. Or: Nesio, ask where my passport is.', false, 'Try "remember" or "ask".');
  if (action.kind === 'end') return say('Okay.');
  if (action.kind === 'reject') return say('Sorry, I didn’t catch that. Try "remember" followed by a note.', false, 'Say "remember" and then a note.');

  // 账号关联 token(有则用它归属用户);个人版回落 INGEST_SHARED_SECRET → owner 记忆。
  const linkToken = body.context?.System?.user?.accessToken || '';
  const ingestSecret = linkToken || envValue('INGEST_SHARED_SECRET');

  if (action.kind === 'capture') {
    if (!ingestSecret) return say('Account isn’t linked yet. Open the Nesio app to link, then try again.');
    try {
      const res = await fetch(`${req.nextUrl.origin}/api/portal/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'alexa', content: action.content, secret: ingestSecret }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean };
      return say(data.ok ? `Got it. I saved: ${action.content}.` : 'I couldn’t save that just now — please try again in a moment.');
    } catch {
      return say('I couldn’t reach your memory right now — please try again in a moment.');
    }
  }

  // ask:语音查询(v2:接云端语义搜索)。先诚实引导到 App,不假装。
  return say(`For now, open the Nesio app to look that up — voice recall is coming next.`);
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'nesio-alexa-skill-endpoint', note: 'POST Alexa requests here. Configure ALEXA_SKILL_ID + INGEST_SHARED_SECRET. English (en-US) only — Alexa has no Chinese.' });
}
