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
import { isPortalRequestAuthorized, isRateLimited } from '@/lib/portal/api-auth';
import { resolveAiKey } from '@/lib/portal/ai-keys';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_TEXTS = 24;
const MAX_CHARS = 500;

export async function POST(req: NextRequest) {
  if (!(await isPortalRequestAuthorized(req))) {
    return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });
  }
  if (isRateLimited(req, 'embed', { limit: 30 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }
  if (!resolveAiKey('gemini')) {
    return NextResponse.json({ ok: false, error: 'embeddings_unavailable' }, { status: 503 });
  }

  const body = await req.json().catch(() => null) as { texts?: unknown } | null;
  const texts = Array.isArray(body?.texts)
    ? body.texts.filter((t): t is string => typeof t === 'string').slice(0, MAX_TEXTS)
    : [];
  if (texts.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_texts' }, { status: 400 });
  }

  const vectors = await Promise.all(
    texts.map(async (t) => {
      const result = await embedTextRaw(t.slice(0, MAX_CHARS));
      return result.ok && result.values ? result.values : null;
    }),
  );

  return NextResponse.json(
    { ok: true, vectors },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
