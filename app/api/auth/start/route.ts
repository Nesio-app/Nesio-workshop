import { NextRequest, NextResponse } from 'next/server';
import {
  buildProductionRuntimeStatus,
  getAuthRedirectUrl,
  getSupabaseAuthorizeUrl,
  getWechatAuthorizeUrl,
  normalizeSupabaseRuntimeUrl,
  type ProductionRuntimeProviderStatus,
  type ProductionRuntimeSetupTask,
} from '@/lib/portal/production-runtime';

type AuthProvider = 'email' | 'google' | 'wechat' | 'phone';

const AUTH_PROVIDERS: AuthProvider[] = ['email', 'google', 'wechat', 'phone'];

function createAuthStartAuditId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `auth-start-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logAuthStartAudit(
  event: 'auth_start_request' | 'auth_start_success' | 'auth_start_failure',
  payload: Record<string, string | number | boolean | null>,
) {
  const safePayload = {
    surface: 'auth_start',
    ...payload,
  };
  if (event === 'auth_start_failure') {
    console.warn(event, safePayload);
    return;
  }
  console.info(event, safePayload);
}

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      ...body,
    },
    {
      status,
      headers: { 'Access-Control-Allow-Origin': '*' },
    },
  );
}

function getProviderGate(req: NextRequest, provider: AuthProvider): {
  providerStatus: ProductionRuntimeProviderStatus;
  setupTask?: ProductionRuntimeSetupTask;
} {
  const status = buildProductionRuntimeStatus(process.env, {
    requestHost: req.headers.get('host'),
  });
  return {
    providerStatus: status.accountAuth.providers[provider],
    setupTask: status.setupTaskMatrix.find(
      (task) => task.category === 'account_auth' && task.id === provider,
    ),
  };
}

async function requestSupabaseOtp(payload: { email?: string; phone?: string; redirectTo: string }) {
  const supabaseUrl = normalizeSupabaseRuntimeUrl(process.env.SUPABASE_URL || '');
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      status: 503,
      error: 'missing_supabase_config',
    };
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...payload,
      create_user: true,
      options: payload.email
        ? {
            email_redirect_to: payload.redirectTo,
          }
        : undefined,
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: 'supabase_otp_failed',
    };
  }

  return {
    ok: true,
    status: 200,
    action: 'otp_sent',
  };
}

export async function POST(req: NextRequest) {
  const auditId = createAuthStartAuditId();
  try {
    let body: {
      provider?: string;
      email?: string;
      phone?: string;
      redirectTo?: string;
      dryRun?: boolean;
    };

    try {
      body = await req.json();
    } catch {
      logAuthStartAudit('auth_start_failure', { auditId, provider: null, reason: 'invalid_json' });
      return safeJson({ ok: false, error: 'invalid_json', auditId }, 400);
    }

    const provider = body.provider as AuthProvider | undefined;
    logAuthStartAudit('auth_start_request', {
      auditId,
      provider: provider || null,
      dryRun: body.dryRun === true,
      hasEmail: Boolean(body.email?.trim()),
      hasPhone: Boolean(body.phone?.trim()),
    });

    if (!provider || !AUTH_PROVIDERS.includes(provider)) {
      logAuthStartAudit('auth_start_failure', { auditId, provider: provider || null, reason: 'unsupported_provider' });
      return safeJson({ ok: false, error: 'unsupported_provider', supportedProviders: AUTH_PROVIDERS, auditId }, 400);
    }

    const redirectTo = body.redirectTo || getAuthRedirectUrl(req.url);
    const email = body.email?.trim() || '';
    const phone = body.phone?.trim() || '';

  // Google OAuth: bypass canonical-domain check — only requires SUPABASE_URL + ANON_KEY
    if (provider === 'google') {
      const supabaseUrl = normalizeSupabaseRuntimeUrl(process.env.SUPABASE_URL || '');
      const supabaseKey = process.env.SUPABASE_ANON_KEY?.trim();
      if (!supabaseUrl || !supabaseKey) {
        logAuthStartAudit('auth_start_failure', { auditId, provider, reason: 'missing_supabase_config' });
        return safeJson({ ok: false, error: 'provider_not_configured', provider, auditId }, 503);
      }
      logAuthStartAudit('auth_start_success', { auditId, provider, action: 'redirect' });
      return safeJson({
        ok: true,
        provider,
        auditId,
        action: 'redirect',
        url: getSupabaseAuthorizeUrl('google', redirectTo),
      });
    }

    const { providerStatus, setupTask } = getProviderGate(req, provider);
    if (setupTask?.blockedReason || !providerStatus.enabled) {
      logAuthStartAudit('auth_start_failure', {
        auditId,
        provider,
        reason: setupTask?.blockedReason || 'provider_not_configured',
      });
      return safeJson(
        {
          ok: false,
          error: setupTask?.blockedReason === 'canonical_domain_mismatch'
            ? 'canonical_domain_mismatch'
            : 'provider_not_configured',
          provider,
          auditId,
          status: providerStatus,
          setupTask,
        },
        503,
      );
    }

    if (provider === 'wechat') {
      logAuthStartAudit('auth_start_success', { auditId, provider, action: 'redirect' });
      return safeJson({
        ok: true,
        provider,
        auditId,
        action: 'redirect',
        url: getWechatAuthorizeUrl(redirectTo),
      });
    }

    if (provider === 'email') {
      if (!email) {
        logAuthStartAudit('auth_start_failure', { auditId, provider, reason: 'missing_email' });
        return safeJson({ ok: false, error: 'missing_email', auditId }, 400);
      }
      if (body.dryRun === true) {
        logAuthStartAudit('auth_start_success', { auditId, provider, action: 'otp_dry_run' });
        return safeJson({
          ok: true,
          provider,
          auditId,
          action: 'otp_dry_run',
          dryRun: true,
          noExternalOtpSent: true,
        });
      }
      const result = await requestSupabaseOtp({ email, redirectTo });
      logAuthStartAudit(result.ok ? 'auth_start_success' : 'auth_start_failure', {
        auditId,
        provider,
        action: result.action || null,
        reason: result.ok ? 'otp_sent' : (result.error || 'otp_failed'),
        status: result.status,
      });
      return safeJson({ ...result, provider, auditId }, result.status);
    }

    if (!phone) {
      logAuthStartAudit('auth_start_failure', { auditId, provider, reason: 'missing_phone' });
      return safeJson({ ok: false, error: 'missing_phone', auditId }, 400);
    }
    if (body.dryRun === true) {
      logAuthStartAudit('auth_start_success', { auditId, provider, action: 'otp_dry_run' });
      return safeJson({
        ok: true,
        provider,
        auditId,
        action: 'otp_dry_run',
        dryRun: true,
        noExternalOtpSent: true,
      });
    }
    const result = await requestSupabaseOtp({ phone, redirectTo });
    logAuthStartAudit(result.ok ? 'auth_start_success' : 'auth_start_failure', {
      auditId,
      provider,
      action: result.action || null,
      reason: result.ok ? 'otp_sent' : (result.error || 'otp_failed'),
      status: result.status,
    });
    return safeJson({ ...result, provider, auditId }, result.status);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    logAuthStartAudit('auth_start_failure', { auditId, provider: null, reason: 'auth_start_exception' });
    return safeJson({ ok: false, error: 'auth_start_exception', auditId, message }, 500);
  }
}
