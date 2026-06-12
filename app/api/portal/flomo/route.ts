import { NextRequest, NextResponse } from 'next/server';
import {
  fetchFlomoMemos,
  isFlomoReadConfigured,
  isFlomoWriteConfigured,
} from '@/lib/portal/flomo-api';

export const dynamic = 'force-dynamic';

function webhookUrl(): string | null {
  const raw =
    process.env.FLOMO_WEBHOOK_URL?.trim() || process.env.FLOMO_API_URL?.trim();
  if (!raw) return null;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 50;

  const readConfigured = isFlomoReadConfigured();
  const writeConfigured = isFlomoWriteConfigured();

  if (!readConfigured) {
    return NextResponse.json({
      ok: false,
      configured: writeConfigured,
      readConfigured: false,
      writeConfigured,
      memos: [],
      error: writeConfigured
        ? '读取需单独配置 FLOMO_API_TOKEN（flomo 设置 → MCP 个人 Token）'
        : '配置 FLOMO_WEBHOOK_URL 可发送；FLOMO_API_TOKEN 可读取历史',
    });
  }

  const result = await fetchFlomoMemos(Number.isFinite(limit) ? limit : 50);
  if (!result.ok) {
    return NextResponse.json(result, { status: result.configured ? 502 : 503 });
  }

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 });
  }
  if (content.length > 5000) {
    return NextResponse.json({ ok: false, error: 'content too long' }, { status: 400 });
  }

  const target = webhookUrl();
  if (!target) {
    return NextResponse.json(
      { ok: false, error: 'FLOMO_WEBHOOK_URL not configured' },
      { status: 503 },
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
      return NextResponse.json(
        { ok: false, error: data?.message || `flomo ${res.status}` },
        { status: 502 },
      );
    }

    if (data?.code !== 0 && data?.code !== undefined) {
      return NextResponse.json(
        { ok: false, error: data?.message || 'flomo rejected' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: data?.message || '已记录',
      slug: data?.memo?.slug,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error';
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
