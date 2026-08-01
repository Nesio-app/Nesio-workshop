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
import { isRateLimited, isPortalRequestAuthorized, safeEqual } from '@/lib/portal/api-auth';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function isIngestAllowed(req: NextRequest, bodySecret?: string): Promise<boolean> {
  const sharedSecret = envValue('INGEST_SHARED_SECRET');
  if (sharedSecret && bodySecret && safeEqual(bodySecret, sharedSecret)) return true; // 常量时间比较,防计时侧信道

  const stage5Secret = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const providedStage5Secret = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  if (stage5Secret && providedStage5Secret === stage5Secret) return true;

  // 本地/实验 env-flag 旁路。
  const accessMode = req.headers.get('x-baohe-access-mode')?.trim() || '';
  const labEnabled = envValue('BAOHE_PERSONAL_LAB_AI_ENABLED').toLowerCase() === 'true';
  if (labEnabled && accessMode === 'personal_lab') return true;

  // 安全(denial-of-wallet 收口):**验真会话**(Supabase 验 access / HMAC 验签 refresh|openid /
  // Stage5 / 无 Supabase 放行),不再只看 baohe_auth_access 存在。伪造 cookie → 拒。
  return isPortalRequestAuthorized(req);
}

async function extractNodes(source: string, content: string): Promise<{ nodes: object[]; summary: string }> {
  // Alexa 语音捕获只关心「存没存进云 signals」,不消费抽取出的 nodes/summary —— 那次
  // Gemini 调用纯浪费(~$0.0001 + ~850ms 延迟拖慢语音回应)。走规则兜底,省钱又更快。
  if (!aiProviderAvailable() || source === 'alexa') {
    // Rule-based fallback
    return {
      nodes: [{
        type: source === 'reminder' ? 'task' : source === 'keep' ? 'Mind' : source === 'wechat_reading' ? 'Mind' : 'Thing',
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
      nodes: [{ type: 'Thing', name: content.slice(0, 40), attributes: { source }, relations: [], tags: [source], confidence: 0.6, rawInput: content.slice(0, 200) }],
      summary: '已记录',
    };
  }
}

function normalizeIngestToSignal(source: string, content: string) {
  // normalizeTaskToSignal/normalizeHealthToSignal 内部把 source 写死成泛泛的
  // 'task'/'health' —— 这里再按 type(task.*/health.* 前缀,与 source 无关地推断
  // LifeNodeType,见 create-signal.lifeNodeType)覆盖回真实来源,Apple 提醒事项/
  // Keep 运动数据才认得出是哪个连接器,不会跟其它 task/health 信号混在一起。
  if (source === 'reminder') {
    return { ...normalizeTaskToSignal({ title: content.slice(0, 80) || '提醒事项', status: 'open' }), source: 'reminder' as const };
  }
  if (source === 'keep') {
    return { ...normalizeHealthToSignal({ title: content.slice(0, 80) || '健康记录', status: content }), source: 'keep' as const };
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

  if (!(await isIngestAllowed(req, body.secret))) {
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
