import { NextRequest, NextResponse } from 'next/server';
import {
  buildProductionRuntimeStatus,
  type ProductionRuntimeSetupTask,
} from '@/lib/portal/production-runtime';

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

function envValue(key: string): string {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

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

function callbackUrl(req: NextRequest): string {
  const configured = envValue('GOOGLE_CALENDAR_REDIRECT_URI');
  if (configured) return configured;
  const url = new URL(req.url);
  return `${url.origin}/api/portal/calendar/oauth/callback`;
}

function getGoogleCalendarSetupTask(req: NextRequest): ProductionRuntimeSetupTask | undefined {
  const status = buildProductionRuntimeStatus(process.env, {
    requestHost: req.headers.get('host'),
  });
  return status.setupTaskMatrix.find(
    (task) => task.id === 'google_calendar' && task.category === 'third_party',
  );
}

export async function GET(req: NextRequest) {
  const clientId = envValue('GOOGLE_CLIENT_ID');
  const clientSecretConfigured = Boolean(envValue('GOOGLE_CLIENT_SECRET'));
  const setupTask = getGoogleCalendarSetupTask(req);

  if (setupTask?.blockedReason || !clientId || !clientSecretConfigured) {
    return safeJson(
      {
        ok: false,
        error: setupTask?.blockedReason === 'canonical_domain_mismatch'
          ? 'canonical_domain_mismatch'
          : 'provider_not_configured',
        provider: 'google_calendar',
        missingEnv: [
          ...(!clientId ? ['GOOGLE_CLIENT_ID'] : []),
          ...(!clientSecretConfigured ? ['GOOGLE_CLIENT_SECRET'] : []),
        ],
        setupTask,
      },
      503,
    );
  }

  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl(req));
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', GOOGLE_CALENDAR_SCOPE);
  authorizeUrl.searchParams.set('access_type', 'offline');
  authorizeUrl.searchParams.set('prompt', 'consent');
  authorizeUrl.searchParams.set('state', 'nesio_google_calendar');

  return NextResponse.redirect(authorizeUrl);
}
