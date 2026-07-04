/**
 * POST /api/portal/embed
 * Batch text → embedding vectors for client-side semantic re-ranking
 * (强搜索 / 问一问 memory context). Reuses lib/life-domain/signal-embedding.
 *
 * Body: { texts: string[] }  (max 24 texts, each truncated to 500 chars)
 * Returns: { ok, vectors: (number[] | null)[] }  — null where embedding failed
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies, type UnsafeUnwrappedCookies } from 'next/headers';
import { embedTextRaw } from '@/lib/life-domain/signal-embedding';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

function isAllowed(req: NextRequest): boolean {
  const cookieStore = (cookies() as unknown as UnsafeUnwrappedCookies);
  const hasSession = Boolean(
    cookieStore.get('baohe_auth_access')?.value ||
      cookieStore.get('baohe_auth_refresh')?.value ||
      cookieStore.get('baohe_wechat_openid')?.value,
  );
  const noSupabase = !envValue('SUPABASE_URL') || !envValue('SUPABASE_ANON_KEY');
  const stage5 = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const providedStage5 = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  return hasSession || noSupabase || (Boolean(stage5) && providedStage5 === stage5);
}

const MAX_TEXTS = 24;
const MAX_CHARS = 500;

export async function POST(req: NextRequest) {
  if (!isAllowed(req)) {
    return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });
  }
  if (!envValue('GEMINI_API_KEY')) {
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
