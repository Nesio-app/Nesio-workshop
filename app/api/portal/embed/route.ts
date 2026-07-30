/**
 * POST /api/portal/embed
 * Batch text → embedding vectors for client-side semantic re-ranking
 * (强搜索 / 问一问 memory context). Reuses lib/life-domain/signal-embedding.
 *
 * Body: { texts: string[] }  (max 24 texts, each truncated to 500 chars)
 * Returns: { ok, vectors: (number[] | null)[] }  — null where embedding failed
 */
import { NextRequest, NextResponse } from 'next/server';
import { embedTextRaw } from '@/lib/life-domain/signal-embedding';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { readServerTier } from '@/lib/portal/auth/server-entitlement';
import { resolveAiKey } from '@/lib/portal/ai-keys';
import { reportAiCall } from '@/lib/portal/ai-telemetry';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_TEXTS = 24;
const MAX_CHARS = 500;

export async function POST(req: NextRequest) {
  // 授权门:登录/rate limit/日成本熔断
  const guard = await guardAiRoute(req, 'embed', { limit: 30 });
  if (guard) return guard;

  // 获取当前用户的付费状态
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('baohe_auth_access')?.value || null;
  const userTier = await readServerTier(accessToken);
  const canUsePaidCloudAi = userTier === 'pro';

  const body = await req.json().catch(() => null) as { texts?: unknown } | null;
  const texts = Array.isArray(body?.texts)
    ? body.texts.filter((t): t is string => typeof t === 'string').slice(0, MAX_TEXTS)
    : [];
  if (texts.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_texts' }, { status: 400 });
  }

  // 免费用户返回本地 Tier 0 结果(纯本地模糊匹配,无向量)
  if (!canUsePaidCloudAi) {
    const vectors = texts.map(() => null); // 本地无向量能力,返回 null
    return NextResponse.json(
      { ok: true, vectors, model: 'local_tier0' },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }

  // 问一问修复批:Gemini 或 OpenAI 任一 key 即可(embedTextRaw 内部回退)
  if (!resolveAiKey('gemini') && !resolveAiKey('openai')) {
    return NextResponse.json({ ok: false, error: 'embeddings_unavailable' }, { status: 503 });
  }

  let model = '';
  let firstError = '';
  const startedAt = Date.now();
  let aiSucceeded = false;

  const vectors = await Promise.all(
    texts.map(async (t) => {
      const result = await embedTextRaw(t.slice(0, MAX_CHARS));
      if (result.ok && result.model) model = result.model;
      if (!result.ok && !firstError) firstError = result.error || 'provider_error';
      if (result.ok && result.values) aiSucceeded = true;
      return result.ok && result.values ? result.values : null;
    }),
  );

  // 全军覆没(提供方配额/故障)→ 明确报 502,客户端能区分「key 没配」与「key 好好的但这次没成」
  if (vectors.every((v) => v === null)) {
    reportAiCall('embed', false, startedAt);
    return NextResponse.json({ ok: false, error: firstError || 'provider_error' }, { status: 502 });
  }

  if (aiSucceeded) {
    reportAiCall('embed', true, startedAt);
  }

  return NextResponse.json(
    { ok: true, vectors, model }, // model 供客户端向量缓存做同源校验(换嵌入模型后旧向量不混用)
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
