import { NextRequest, NextResponse } from 'next/server';
import { getDecNetworkPayload } from '@/lib/portal/dec-data-api.mjs';

export const dynamic = 'force-dynamic';

const FLOW_VIEW_PARAM = 'flow';
const INCLUDE_EXTERNAL_PARAM = 'includeExternal';

function parseFormat(req: NextRequest): 'summary' | 'full' {
  return req.nextUrl.searchParams.get('format') === 'full' ? 'full' : 'summary';
}

function readFlowView(req: NextRequest): boolean {
  return req.nextUrl.searchParams.get('view') === FLOW_VIEW_PARAM;
}

function parseForce(req: NextRequest): boolean {
  const raw = req.nextUrl.searchParams.get('force');
  return raw === '1' || raw === 'true';
}

function parseIncludeExternal(req: NextRequest): boolean {
  const raw = req.nextUrl.searchParams.get(INCLUDE_EXTERNAL_PARAM);
  return raw === '1' || raw === 'true';
}

function buildCacheControl(ttlMs: number) {
  const maxAge = Math.max(5, Math.floor(ttlMs / 1000));
  return `public, s-maxage=${maxAge}, stale-while-revalidate=${Math.max(60, maxAge * 2)}`;
}

export async function GET(req: NextRequest) {
  try {
    const format = parseFormat(req);
    const includeFlow = readFlowView(req);
    const force = parseForce(req);
    const includeExternalConnectionSummary = parseIncludeExternal(req);
    const response = getDecNetworkPayload({
      format,
      includeFlow,
      includeExternalConnectionSummary,
      force,
    });
    const { _bus, ...publicResponse } = response;

    const ttlMs = response.cache?.ttlMs && Number.isFinite(response.cache.ttlMs)
      ? response.cache.ttlMs
      : 15000;

    return NextResponse.json(publicResponse, {
      headers: {
        'Cache-Control': buildCacheControl(ttlMs),
        'X-Cache-Status': response.cache?.status || 'miss',
        'X-Cache-Hit': response.cache?.hit ? '1' : '0',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        implementation: 'module-data-network-v0',
        module: 'module-data-network-v0',
        error: error instanceof Error ? error.message : 'Unknown error',
        createdAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
