import { NextRequest, NextResponse } from 'next/server';
import {
  fetchFlomoMemos,
  FLOMO_READ_SETUP_HINT,
  isFlomoReadConfigured,
  isFlomoWriteConfigured,
} from '@/lib/portal/flomo-api';
import { providerActionCopy } from '@/lib/portal/provider-action-copy-catalog.mjs';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      ...body,
    },
    { status },
  );
}

function webhookUrl(): string | null {
  const raw =
    process.env.FLOMO_WEBHOOK_URL?.trim() || process.env.FLOMO_API_URL?.trim();
  if (!raw) return null;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

export async function GET(req: NextRequest) {
  // 私据路由:此前无鉴权 → 任何访问部署 URL 的人都能读你的 flomo memo。
  const guard = await guardAiRoute(req, 'flomo-read');
  if (guard) return guard;

  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 48;

  const readConfigured = isFlomoReadConfigured();
  const writeConfigured = isFlomoWriteConfigured();

  if (!readConfigured) {
    return safeJson({
      ok: false,
      configured: writeConfigured,
      readConfigured: false,
      writeConfigured,
      memos: [],
      error: FLOMO_READ_SETUP_HINT,
    });
  }

  const result = await fetchFlomoMemos(Number.isFinite(limit) ? limit : 48);
  if (!result.ok) {
    return safeJson(result as unknown as Record<string, unknown>, result.configured ? 502 : 503);
  }

  return safeJson(result as unknown as Record<string, unknown>);
}

export async function POST(req: NextRequest) {
  // 私据路由:此前无鉴权 → 任何人都能以你的身份往你的 flomo webhook 发帖。
  const guard = await guardAiRoute(req, 'flomo-write');
  if (guard) return guard;

  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return safeJson({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const content = body.content?.trim();
  if (!content) {
    return safeJson({ ok: false, error: 'content required' }, 400);
  }
  if (content.length > 5000) {
    return safeJson({ ok: false, error: 'content too long' }, 400);
  }

  const target = webhookUrl();
  if (!target) {
    return safeJson(
      { ok: false, error: 'FLOMO_WEBHOOK_URL not configured' },
      503,
    );
  }

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      cache: 'no-store',
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return safeJson(
        { ok: false, error: data?.message || `flomo ${res.status}` },
        502,
      );
    }

    if (data?.code !== 0 && data?.code !== undefined) {
      return safeJson(
        { ok: false, error: data?.message || 'flomo rejected' },
        502,
      );
    }

    return safeJson({
      ok: true,
      message: data?.message || providerActionCopy('flomoRecorded'),
      slug: data?.memo?.slug,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error';
    return safeJson({ ok: false, error: msg }, 502);
  }
}
