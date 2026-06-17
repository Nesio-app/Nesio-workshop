import type { NextRequest } from 'next/server';

export type DecAccessRole = 'frontend-readonly' | 'internal-readonly' | 'qa-readonly' | 'ceo-readonly';

export interface DecAccessDecision {
  allowed: boolean;
  status: 200 | 403 | 429;
  reason: string;
  role: DecAccessRole;
  category: string;
  headers: Record<string, string>;
  boundary: DecAccessBoundary;
}

export interface DecAccessBoundary {
  implementation: 'dec-access-boundary-v0';
  mode: 'local-advisory';
  authProvider: 'none';
  readsOnly: true;
  allowsFrontendDirectDb: false;
  writesRealData: false;
  writesNotion: false;
  authorizesExternalServices: false;
  rateLimit: {
    windowMs: number;
    maxRequests: number;
    enforced: true;
    scope: 'process-memory';
  };
  allowedRoles: DecAccessRole[];
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const DEC_ACCESS_ROLES: DecAccessRole[] = [
  'frontend-readonly',
  'internal-readonly',
  'qa-readonly',
  'ceo-readonly',
];

const ROLE_BY_CATEGORY: Record<string, DecAccessRole[]> = {
  catalog: DEC_ACCESS_ROLES,
  network: DEC_ACCESS_ROLES,
  modules: DEC_ACCESS_ROLES,
  external: DEC_ACCESS_ROLES,
  ops: DEC_ACCESS_ROLES,
  artifacts: DEC_ACCESS_ROLES,
  handoffs: DEC_ACCESS_ROLES,
  gates: DEC_ACCESS_ROLES,
  events: DEC_ACCESS_ROLES,
  metrics: ['internal-readonly', 'qa-readonly', 'ceo-readonly'],
};

const RATE_LIMIT_WINDOW_MS = Number.isFinite(Number(process.env.BAOHE_DEC_RATE_LIMIT_WINDOW_MS || '60000'))
  ? Math.max(1000, Number(process.env.BAOHE_DEC_RATE_LIMIT_WINDOW_MS || '60000'))
  : 60000;
const RATE_LIMIT_MAX_REQUESTS = Number.isFinite(Number(process.env.BAOHE_DEC_RATE_LIMIT_MAX_REQUESTS || '120'))
  ? Math.max(10, Number(process.env.BAOHE_DEC_RATE_LIMIT_MAX_REQUESTS || '120'))
  : 120;

const rateBuckets = new Map<string, RateBucket>();

function normalizeRole(value: string | null): DecAccessRole {
  if (value && (DEC_ACCESS_ROLES as string[]).includes(value)) return value as DecAccessRole;
  return 'frontend-readonly';
}

function requestIdentity(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = req.headers.get('x-real-ip')?.trim();
  return forwardedFor || realIp || 'local';
}

function readRole(req: NextRequest): DecAccessRole {
  return normalizeRole(req.headers.get('x-baohe-dec-role') || req.nextUrl.searchParams.get('role'));
}

function pruneExpiredBuckets(now: number) {
  if (rateBuckets.size < 500) return;
  for (const [key, bucket] of Array.from(rateBuckets.entries())) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}

function readBucket(key: string, now: number): RateBucket {
  const existing = rateBuckets.get(key);
  if (existing && existing.resetAt > now) return existing;

  const created = {
    count: 0,
    resetAt: now + RATE_LIMIT_WINDOW_MS,
  };
  rateBuckets.set(key, created);
  pruneExpiredBuckets(now);
  return created;
}

function baseBoundary(category: string): DecAccessBoundary {
  return {
    implementation: 'dec-access-boundary-v0',
    mode: 'local-advisory',
    authProvider: 'none',
    readsOnly: true,
    allowsFrontendDirectDb: false,
    writesRealData: false,
    writesNotion: false,
    authorizesExternalServices: false,
    rateLimit: {
      windowMs: RATE_LIMIT_WINDOW_MS,
      maxRequests: RATE_LIMIT_MAX_REQUESTS,
      enforced: true,
      scope: 'process-memory',
    },
    allowedRoles: ROLE_BY_CATEGORY[category] || DEC_ACCESS_ROLES,
  };
}

export function decAccessBoundaryContract(category = 'catalog'): DecAccessBoundary {
  return baseBoundary(category);
}

export function evaluateDecAccess(req: NextRequest, category = 'catalog'): DecAccessDecision {
  const role = readRole(req);
  const boundary = baseBoundary(category);
  const allowedRoles = new Set(boundary.allowedRoles);
  const now = Date.now();
  const identity = requestIdentity(req);
  const bucketKey = `${identity}:${role}:${category}`;
  const bucket = readBucket(bucketKey, now);
  bucket.count += 1;

  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - bucket.count);
  const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  const commonHeaders = {
    'X-DEC-Access-Mode': boundary.mode,
    'X-DEC-Access-Role': role,
    'X-DEC-Auth-Provider': boundary.authProvider,
    'X-DEC-Frontend-Direct-DB': '0',
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(Math.ceil(bucket.resetAt / 1000)),
  };

  if (!allowedRoles.has(role)) {
    return {
      allowed: false,
      status: 403,
      reason: `DEC category ${category} is not available for role ${role}`,
      role,
      category,
      headers: commonHeaders,
      boundary,
    };
  }

  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      status: 429,
      reason: `DEC local rate limit exceeded; retry after ${resetSeconds}s`,
      role,
      category,
      headers: {
        ...commonHeaders,
        'Retry-After': String(resetSeconds),
      },
      boundary,
    };
  }

  return {
    allowed: true,
    status: 200,
    reason: 'allowed',
    role,
    category,
    headers: commonHeaders,
    boundary,
  };
}
