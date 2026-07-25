/**
 * POST /api/portal/ingest
 * Universal inbound ingestion endpoint.
 * Any data source that lacks a public API (Apple Reminders, Keep, WeChat Reading,
 * Toggl exports, automation tools) can POST raw text/JSON here, optionally via
 * iOS Shortcuts, and Nesio runs it through the analyzer into Life Graph nodes.
 *
 * Body: { source: string, content: string, secret?: string }
 * Returns: { ok, nodes, summary }
 *
 * Production is fail-closed: callers need a signed-in session cookie, the
 * configured ingest secret, the Stage 5 invocation secret, or explicit personal
 * lab mode. Anonymous public parsing is not allowed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createSignal } from '@/lib/life-domain/create-signal';
import { writeCloudSignalsForCurrentUser } from '@/lib/platform/runtime/cloud-signals-server';
import {
  normalizeHealthToSignal,
  normalizeTaskToSignal,
  normalizeVoiceToSignal,
} from '@/lib/life-domain/normalizers';
import { buildSourceExtractionPrompt, parseJsonBlock, SOURCE_HINTS } from '@/lib/extraction/extraction';
import { isRateLimited } from '@/lib/portal/api-auth';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function isIngestAllowed(req: NextRequest, bodySecret?: string): boolean {
  const sharedSecret = envValue('INGEST_SHARED_SECRET');
  if (sharedSecret && bodySecret === sharedSecret) return true;

  const stage5Secret = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const providedStage5Secret = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  if (stage5Secret && providedStage5Secret === stage5Secret) return true;

  const hasSignedInCookie = Boolean(req.cookies.get('baohe_auth_access')?.value);
  if (hasSignedInCookie) return true;

  const accessMode = req.headers.get('x-baohe-access-mode')?.trim() || '';
  const labEnabled = envValue('BAOHE_PERSONAL_LAB_AI_ENABLED').toLowerCase() === 'true';
  return labEnabled && accessMode === 'personal_lab';
}

async function extractNodes(source: string, content: string): Promise<{ nodes: object[]; summary: string }> {
  // Alexa 语音捕获只关心「存没存进云 signals」,不消费抽取出的 nodes/summary —— 那次
  // Gemini 调用纯浪费(~$0.0001 + ~850ms 延迟拖慢语音回应)。走规则兜底,省钱又更快。
  if (!aiProviderAvailable() || source === 'alexa') {
    // Rule-based fallback
    return {
      nodes: [{
        type: source === 'reminder' ? 'commitment' : source === 'keep' ? 'health_state' : source === 'wechat_reading' ? 'preference' : 'object',
        name: content.slice(0, 40),
        attributes: { source, raw: content.slice(0, 200) },
        relations: [],
        tags: [source],
        confidence: 0.65,
        rawInput: content.slice(0, 200),
      }],
      summary: `已记录来自 ${source} 的数据`,
    };
  }

  const prompt = buildSourceExtractionPrompt(source, content);

  try {
    const { text } = await completeText({ prompt, maxTokens: 2048, route: 'ingest' });
    const parsed = parseJsonBlock<{ nodes?: object[]; summary?: string }>(text);
    if (!parsed) throw new Error('unparseable');
    return { nodes: parsed.nodes || [], summary: parsed.summary || '已记录' };
  } catch {
    return {
      nodes: [{ type: 'object', name: content.slice(0, 40), attributes: { source }, relations: [], tags: [source], confidence: 0.6, rawInput: content.slice(0, 200) }],
      summary: '已记录',
    };
  }
}

function normalizeIngestToSignal(source: string, content: string) {
  if (source === 'reminder') {
    return normalizeTaskToSignal({ title: content.slice(0, 80) || '提醒事项', status: 'open' });
  }
  if (source === 'keep') {
    return normalizeHealthToSignal({ title: content.slice(0, 80) || '健康记录', status: content });
  }
  return normalizeVoiceToSignal({ text: content, tags: [source] });
}

export async function POST(req: NextRequest) {
  let body: { source?: string; content?: string; secret?: string };
  try {
    body = await req.json();
  } catch {
    // Allow raw text body (for simple Shortcuts)
    const text = await req.text();
    body = { source: 'shortcuts', content: text };
  }

  if (!isIngestAllowed(req, body.secret)) {
    return NextResponse.json({ ok: false, error: 'ingest_auth_required' }, { status: 401 });
  }
  // 有鉴权但之前无限流:登录/持 secret 后可无节流打 Gemini 抽取。
  if (isRateLimited(req, 'ingest', { limit: 30 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited', retryAfterMs: 30_000 }, { status: 429 });
  }

  const source = (body.source || 'generic').toLowerCase();
  const content = (body.content || '').trim();
  if (!content) {
    return NextResponse.json({ ok: false, error: 'empty_content' }, { status: 400 });
  }

  const { nodes, summary } = await extractNodes(source, content);
  const signal = createSignal(normalizeIngestToSignal(source, content));
  const cloudSignalWrite = await writeCloudSignalsForCurrentUser([signal]);
  return NextResponse.json({
    ok: true,
    source,
    nodes,
    summary,
    count: nodes.length,
    signals: [signal],
    signalIds: [signal.id],
    cloudSignalWrite,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    description: 'Universal ingest endpoint. Authenticated or lab/secret callers can POST { source, content } to extract Memory nodes.',
    sources: Object.keys(SOURCE_HINTS),
    shortcutsUsage: 'In iOS Shortcuts: Get Contents of URL → POST → /api/portal/ingest with JSON { source, content, secret } when an ingest secret is configured.',
  });
}
