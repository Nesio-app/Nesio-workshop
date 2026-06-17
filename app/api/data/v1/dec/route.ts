import { NextRequest, NextResponse } from 'next/server';
import { evaluateDecAccess } from '@/lib/portal/dec-access-boundary';

export const dynamic = 'force-dynamic';

const DEC_CATEGORIES = [
  {
    category: 'network',
    path: '/api/data/v1/dec/network',
    intent: ['module registry', 'data graph', 'route availability'],
    query: ['view=flow', 'format=summary|full', 'force=1', 'ttl=<ms>'],
    returns: ['modules', 'data contracts', 'shell routes'],
    readOnly: true,
  },
  {
    category: 'modules',
    path: '/api/data/v1/dec/modules',
    intent: ['module inventory', 'owned/consumed data snapshot'],
    query: ['format=summary|full', 'force=1', 'ttl=<ms>'],
    returns: ['module list', 'module summary', 'shell route snapshot'],
    readOnly: true,
  },
  {
    category: 'external',
    path: '/api/data/v1/dec/external',
    intent: ['external bridge state', 'integration readiness'],
    query: ['force=1', 'ttl=<ms>'],
    returns: ['external modules', 'connection status', 'risk notes'],
    readOnly: true,
  },
  {
    category: 'ops',
    path: '/api/data/v1/dec/ops',
    intent: ['ops queue overview', 'handoff/gate counts'],
    query: ['force=1', 'ttl=<ms>'],
    returns: ['handoff/gate counts', 'artifact queue status'],
    readOnly: true,
  },
  {
    category: 'artifacts',
    path: '/api/data/v1/dec/artifacts',
    intent: ['artifact list paging', 'queue filters'],
    query: ['kind', 'state', 'owner', 'needsCeo', 'search', 'limit', 'offset', 'cursor', 'force=1', 'ttl=<ms>'],
    returns: ['artifact rows', 'paging info'],
    readOnly: true,
  },
  {
    category: 'handoffs',
    path: '/api/data/v1/dec/handoffs',
    intent: ['handoff list paging', 'queue filters'],
    query: ['status', 'owner', 'artifactPath', 'needsCeo', 'limit', 'offset', 'cursor', 'force=1', 'ttl=<ms>'],
    returns: ['handoff rows', 'paging info'],
    readOnly: true,
  },
  {
    category: 'gates',
    path: '/api/data/v1/dec/gates',
    intent: ['gate decision list paging', 'queue filters'],
    query: ['status', 'owner', 'artifactPath', 'category', 'needsCeo', 'limit', 'offset', 'cursor', 'force=1', 'ttl=<ms>'],
    returns: ['gate rows', 'paging info'],
    readOnly: true,
  },
  {
    category: 'events',
    path: '/api/data/v1/dec/events',
    intent: ['recent event feed', 'module/audit filters'],
    query: ['module', 'eventType', 'artifactPath', 'limit', 'offset', 'cursor', 'force=1', 'ttl=<ms>'],
    returns: ['event rows', 'paging info'],
    readOnly: true,
  },
  {
    category: 'metrics',
    path: '/api/data/v1/dec/metrics',
    intent: ['endpoint usage', 'cache hit/miss trend'],
    query: ['summary=1', 'includeZero=1', 'top=<n>', 'signature=<category>'],
    returns: ['metric list', 'category summary', 'top-by-calls'],
    readOnly: true,
  },
];

export async function GET(req: NextRequest) {
  const access = evaluateDecAccess(req, 'catalog');
  if (!access.allowed) {
    return NextResponse.json(
      {
        ok: false,
        reason: access.reason,
        accessBoundary: access.boundary,
      },
      {
        status: access.status,
        headers: access.headers,
      },
    );
  }

  return NextResponse.json({
    ok: true,
    implementation: 'dec-catalog-v0',
    generatedAt: new Date().toISOString(),
    basePath: '/api/data/v1/dec',
    requestPattern: '/api/data/v1/dec/{category}',
    paging: {
      defaultLimit: 25,
      maxLimit: 200,
      maxOffset: 2000,
      preferredStrategy: 'cursor',
      cursorSupportedCategories: ['artifacts', 'handoffs', 'gates', 'events'],
    },
    accessBoundary: access.boundary,
    boundaries: {
      readsRealData: false,
      writesRealData: false,
      writesNotion: false,
      sendsNotifications: false,
      authorizesExternalServices: false,
      executesActions: false,
      productionDeploy: false,
    },
    categories: DEC_CATEGORIES,
  }, {
    headers: access.headers,
  });
}
