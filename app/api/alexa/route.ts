/**
 * POST /api/alexa — Alexa 自定义技能的 HTTPS 端点(智能家居·语音入口)。
 *
 * 让满屋 Echo 变成 Nesio 的语音前端:随口记(CaptureMemory)、随口问(AskMemory)。
 * ⚠️ Alexa **不支持中文**,交互语言为英文(en-US);中文语音需走别的硬件(小爱/天猫精灵)。
 *
 * 校验(个人/开发版够用):
 *   ① applicationId === ALEXA_SKILL_ID(env);② 请求 timestamp 新鲜(≤150s,防重放)。
 *   —— 发布上架还需完整的 SignatureCertChainUrl 证书链校验(见 docs/alexa-skill-setup.md)。
 * 用户归属:账号关联(access token)→ 走 ingest;个人单用户配 NESIO_OWNER_ID(owner 的
 *   Supabase user id)—— 捕获与召回都落在/读自「和 App 同一片记忆」。
 *
 * 召回(AskMemory)= 服务端读云 signals → 文本评分排序 → 云 LLM 一句话念回。
 *   自用不计成本/隐私(用户明示);LLM 挂了确定性兜底把命中记忆原样念回,不静默变哑。
 */
import { NextRequest, NextResponse } from 'next/server';
import { envValue } from '@/lib/portal/env';
import { getCloudConfig, getSignedInUser } from '@/lib/portal/cloud-server-runtime';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';
import { resolveOwnerIdentity, readCloudSignalRowsForIdentity } from '@/lib/platform/runtime/cloud-signals-server';
import { sortRowsForQuery } from '@/lib/portal/cloud/signal-search';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';
import {
  rowsToSnippets,
  buildRecallPrompt,
  fallbackRecallAnswer,
  emptyRecallAnswer,
  sanitizeSpokenAnswer,
} from '@/lib/portal/alexa-answer';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

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

/**
 * 语音召回:读 owner 记忆 → 排序 → LLM 一句话答。返回可直接朗读的英文。
 * 归属:cookie 会话优先(owner 在浏览器里登着),否则 NESIO_OWNER_ID。
 */
async function recallMemory(query: string, accessToken: string): Promise<string> {
  const config = getCloudConfig();
  if (!config.configured) return 'Memory isn’t connected on the server yet.';

  // 账号关联 token 走会话身份;否则回落 owner env 身份。
  let identityKey = '';
  if (accessToken) {
    const session = await getSignedInUser(config);
    identityKey = deriveCloudIdentity(session.user)?.identityKey || '';
  }
  if (!identityKey) identityKey = resolveOwnerIdentity()?.identityKey || '';
  if (!identityKey) {
    return 'Account isn’t linked yet. Open the Nesio app to link, or set the owner id on the server.';
  }

  const read = await readCloudSignalRowsForIdentity(config, identityKey, 200);
  if (!read.ok) return 'I couldn’t reach your memory right now — please try again in a moment.';

  const ranked = sortRowsForQuery(read.rows, query, 5);
  const snippets = rowsToSnippets(ranked, 5);
  if (!snippets.length) return emptyRecallAnswer(query);

  if (!aiProviderAvailable()) return fallbackRecallAnswer(query, snippets);
  try {
    const { text } = await completeText({
      prompt: buildRecallPrompt(query, snippets),
      maxTokens: 160,
      temperature: 0.2,
      route: 'alexa-recall',
    });
    const spoken = sanitizeSpokenAnswer(text);
    return spoken || fallbackRecallAnswer(query, snippets);
  } catch {
    // LLM 挂了不静默:把命中的记忆原样念回。
    return fallbackRecallAnswer(query, snippets);
  }
}

export async function POST(req: NextRequest) {
  let body: AlexaBody;
  try { body = await req.json() as AlexaBody; } catch { return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 }); }

  const bad = verify(body);
  if (bad) return NextResponse.json({ ok: false, error: bad }, { status: bad === 'skill_not_configured' ? 503 : 400 });

  const action = routeAlexa(body);

  if (action.kind === 'welcome') return say('Nessa is here. Say: remember, and then anything you want to keep. Or ask, and then your question.', false, 'Say "remember" followed by a note, or "ask" followed by a question.');
  if (action.kind === 'help') return say('You can say: Nessa, remember the spare keys are in the hallway. Or: Nessa, ask where my passport is.', false, 'Try "remember" or "ask".');
  if (action.kind === 'end') return say('Okay.');
  if (action.kind === 'reject') return say('Sorry, I didn’t catch that. Try "remember" followed by a note.', false, 'Say "remember" and then a note.');

  // 账号关联 token(有则用它归属用户);个人版回落 owner 身份(NESIO_OWNER_ID / INGEST_SHARED_SECRET)。
  const linkToken = body.context?.System?.user?.accessToken || '';

  if (action.kind === 'capture') {
    const ingestSecret = linkToken || envValue('INGEST_SHARED_SECRET');
    if (!ingestSecret) return say('Account isn’t linked yet. Open the Nesio app to link, then try again.');
    try {
      const res = await fetch(`${req.nextUrl.origin}/api/portal/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'alexa', content: action.content, secret: ingestSecret }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; cloudSignalWrite?: { ok?: boolean } };
      // 诚实态:只有真落库了才说「saved」;云写失败别假装成功(否则问一问查不到)。
      const persisted = data.ok && data.cloudSignalWrite?.ok === true;
      return say(persisted ? `Got it. I saved: ${action.content}.` : 'I heard you, but I couldn’t save that just now — please try again in a moment.');
    } catch {
      return say('I couldn’t reach your memory right now — please try again in a moment.');
    }
  }

  // ask:服务端语音召回。
  const answer = await recallMemory(action.query, linkToken);
  return say(answer);
}

export async function GET() {
  // owner 在浏览器里登着 App 时,回显其 identityKey / userId,方便把 NESIO_OWNER_ID 配到服务端。
  let owner: { identityKey: string; userId: string | null } | null = null;
  try {
    const config = getCloudConfig();
    if (config.configured) {
      const session = await getSignedInUser(config);
      const identity = deriveCloudIdentity(session.user);
      if (identity) owner = { identityKey: identity.identityKey, userId: identity.userId };
    }
  } catch { owner = null; }
  return NextResponse.json({
    ok: true,
    service: 'nesio-alexa-skill-endpoint',
    note: 'POST Alexa requests here. Configure ALEXA_SKILL_ID + (INGEST_SHARED_SECRET or account linking) + NESIO_OWNER_ID. English (en-US) only — Alexa has no Chinese.',
    signedInOwner: owner,
    ownerHint: owner ? 'Set NESIO_OWNER_ID to signedInOwner.userId so Alexa capture/recall share this account’s memory.' : 'Sign in to the Nesio app in this browser, then reload to see your owner id.',
  });
}
