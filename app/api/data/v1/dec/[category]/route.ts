import { NextRequest, NextResponse } from 'next/server';
import {
  getDecArtifactsPayload,
  getDecEventsPayload,
  getDecGatesPayload,
  getDecHandoffsPayload,
  getDecExternalBridgePayload,
  getDecModulesPayload,
  getDecNetworkPayload,
  getDecOpsPayload,
  getDecUsageMetricsPayload,
} from '@/lib/portal/dec-data-api.mjs';
import { evaluateDecAccess } from '@/lib/portal/dec-access-boundary';

export const dynamic = 'force-dynamic';

const SUPPORTED_CATEGORIES = ['network', 'modules', 'external', 'ops', 'artifacts', 'handoffs', 'gates', 'events', 'metrics'] as const;

type Category = typeof SUPPORTED_CATEGORIES[number];

function normalizeCategory(value: string | null): Category | null {
  if (!value) return null;
  if ((SUPPORTED_CATEGORIES as readonly string[]).includes(value)) {
    return value as Category;
  }
  return null;
}

function parseFormat(req: NextRequest): 'summary' | 'full' {
  return req.nextUrl.searchParams.get('format') === 'full' ? 'full' : 'summary';
}

function parseForce(req: NextRequest): boolean {
  const raw = req.nextUrl.searchParams.get('force');
  return raw === '1' || raw === 'true';
}

function parseTTL(req: NextRequest): number | undefined {
  const raw = req.nextUrl.searchParams.get('ttl');
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 500 ? parsed : undefined;
}

function readFlowView(req: NextRequest): boolean {
  return req.nextUrl.searchParams.get('view') === 'flow';
}

function parseLimit(req: NextRequest) {
  return req.nextUrl.searchParams.get('limit') || undefined;
}

function parseOffset(req: NextRequest) {
  return req.nextUrl.searchParams.get('offset') || undefined;
}

function parseCursor(req: NextRequest) {
  return req.nextUrl.searchParams.get('cursor') || undefined;
}

function parseNeedsCeo(req: NextRequest) {
  return req.nextUrl.searchParams.get('needsCeo') || undefined;
}

function parseBooleanFlag(req: NextRequest, key: string) {
  return req.nextUrl.searchParams.get(key) || undefined;
}

function cacheTtlMs(cacheValue: unknown): number {
  if (cacheValue && typeof cacheValue === 'object' && 'ttlMs' in cacheValue) {
    const next = (cacheValue as { ttlMs?: unknown }).ttlMs;
    if (typeof next === 'number' && Number.isFinite(next) && next > 0) return next;
  }
  return 15000;
}

function cacheHeaders(ttlMs: number) {
  const maxAge = Math.max(5, Math.floor(ttlMs / 1000));
  return {
    'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=${Math.max(60, maxAge * 2)}`,
  };
}

export async function GET(req: NextRequest, { params }: { params: { category: string } }) {
  const category = normalizeCategory(params?.category);
  const format = parseFormat(req);
  const includeFlow = readFlowView(req);
  const force = parseForce(req);
  const ttlMs = parseTTL(req);
    const nextParams = {
    format,
    includeFlow,
    force,
    limit: parseLimit(req),
    offset: parseOffset(req),
    cursor: parseCursor(req),
    kind: req.nextUrl.searchParams.get('kind') || undefined,
    state: req.nextUrl.searchParams.get('state') || undefined,
    owner: req.nextUrl.searchParams.get('owner') || undefined,
    status: req.nextUrl.searchParams.get('status') || undefined,
    needsCeo: parseNeedsCeo(req),
    category: req.nextUrl.searchParams.get('category') || undefined,
    signature: req.nextUrl.searchParams.get('signature') || undefined,
    search: req.nextUrl.searchParams.get('search') || undefined,
    artifactPath: req.nextUrl.searchParams.get('artifactPath') || undefined,
    module: req.nextUrl.searchParams.get('module') || undefined,
      type: req.nextUrl.searchParams.get('type') || req.nextUrl.searchParams.get('eventType') || undefined,
      summary: req.nextUrl.searchParams.get('summary') || undefined,
      includeZero: parseBooleanFlag(req, 'includeZero'),
      ...(ttlMs ? { ttlMs } : {}),
      summaryTop: req.nextUrl.searchParams.get('top') || undefined,
    };

  if (!category) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'Unsupported DEC category',
        supported: SUPPORTED_CATEGORIES,
        requested: params?.category,
      },
      {
        status: 400,
      },
    );
  }

  const access = evaluateDecAccess(req, category);
  if (!access.allowed) {
    return NextResponse.json(
      {
        ok: false,
        category,
        reason: access.reason,
        accessBoundary: access.boundary,
      },
      {
        status: access.status,
        headers: access.headers,
      },
    );
  }

  try {
    let payload: unknown;
    if (category === 'network') {
      const response = getDecNetworkPayload(nextParams);
      const { _bus, ...publicPayload } = response;
      payload = publicPayload;
    } else if (category === 'modules') {
      payload = getDecModulesPayload({
        format,
        force,
        ...(ttlMs ? { ttlMs } : {}),
      });
    } else if (category === 'external') {
      payload = getDecExternalBridgePayload({
        force,
        ...(ttlMs ? { ttlMs } : {}),
      });
    } else if (category === 'artifacts') {
      payload = getDecArtifactsPayload({
        options: {
          kind: nextParams.kind,
          state: nextParams.state,
          owner: nextParams.owner,
          search: nextParams.search,
          needsCeo: nextParams.needsCeo,
          limit: nextParams.limit,
          offset: nextParams.offset,
          cursor: nextParams.cursor,
        },
        force,
        ...(ttlMs ? { ttlMs } : {}),
      });
    } else if (category === 'handoffs') {
      payload = getDecHandoffsPayload({
        options: {
          status: nextParams.status,
          owner: nextParams.owner,
          artifactPath: nextParams.artifactPath,
          needsCeo: nextParams.needsCeo,
          limit: nextParams.limit,
          offset: nextParams.offset,
          cursor: nextParams.cursor,
        },
        force,
        ...(ttlMs ? { ttlMs } : {}),
      });
    } else if (category === 'gates') {
      payload = getDecGatesPayload({
        options: {
          status: nextParams.status,
          owner: nextParams.owner,
          category: nextParams.category,
          artifactPath: nextParams.artifactPath,
          needsCeo: nextParams.needsCeo,
          limit: nextParams.limit,
          offset: nextParams.offset,
          cursor: nextParams.cursor,
        },
        force,
        ...(ttlMs ? { ttlMs } : {}),
      });
    } else if (category === 'events') {
      payload = getDecEventsPayload({
        options: {
          module: nextParams.module,
          type: nextParams.type,
          artifactPath: nextParams.artifactPath,
          limit: nextParams.limit,
          offset: nextParams.offset,
          cursor: nextParams.cursor,
        },
        force,
        ...(ttlMs ? { ttlMs } : {}),
      });
    } else if (category === 'metrics') {
      const includeZero = nextParams.includeZero === '1' || nextParams.includeZero === 'true';
      const summary = nextParams.summary === '1' || nextParams.summary === 'true';
      const summaryTop = nextParams.summaryTop ? Number(nextParams.summaryTop) : undefined;
      payload = getDecUsageMetricsPayload({
        signature: nextParams.signature,
        includeZero,
        summary,
        ...(summaryTop ? { top: summaryTop } : {}),
      });
    } else {
      payload = getDecOpsPayload({
        force,
        ...(ttlMs ? { ttlMs } : {}),
      });
    }

    const ttl = cacheTtlMs((payload as { cache?: unknown }).cache);
    return NextResponse.json(payload, {
      headers: {
        ...access.headers,
        ...cacheHeaders(ttl),
        'X-Cache-Status': (payload as { cache?: { status?: string } }).cache?.status || 'miss',
        'X-Cache-Hit': (payload as { cache?: { hit?: boolean } }).cache?.hit ? '1' : '0',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        category,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      {
        status: 500,
        headers: access.headers,
      },
    );
  }
}
