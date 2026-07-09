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

type AuthProvider = 'email' | 'google' | 'apple' | 'wechat' | 'phone';
type AuthMode = 'login' | 'register';

const AUTH_PROVIDERS: AuthProvider[] = ['email', 'google', 'apple', 'wechat', 'phone'];
const AUTH_MODES: AuthMode[] = ['login', 'register'];
const DEFAULT_AUTH_CALLBACK_URL = 'https://www.nesio.app/api/auth/callback';

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

// google/apple 走各自的早返回分支,不进这里;此门只处理有 providers 键的三家。
function getProviderGate(req: NextRequest, provider: Exclude<AuthProvider, 'google' | 'apple'>): {
  providerStatus: ProductionRuntimeProviderStatus;
  setupTask?: ProductionRuntimeSetupTask;
} {
  const status = buildProductionRuntimeStatus(process.env, {
    requestHost: req.headers.get('x-forwarded-host') || req.headers.get('host'),
  });
  return {
    providerStatus: status.accountAuth.providers[provider],
    setupTask: status.setupTaskMatrix.find(
      (task) => task.category === 'account_auth' && task.id === provider,
    ),
  };
}

function isLocalAuthHost(host: string): boolean {
  const value = host.toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value.endsWith('.localhost');
}

function normalizeAuthCallbackUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    if (isLocalAuthHost(url.hostname)) return null;
    // Keep production callbacks on the caller's current host because auth
    // cookies are host-only. Rewriting apex <-> www makes the UI look signed out.
    if (url.pathname !== '/api/auth/callback') url.pathname = '/api/auth/callback';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function getSafeAuthFallback(fallback: string): string {
  return normalizeAuthCallbackUrl(process.env.BAOHE_AUTH_REDIRECT_URL)
    || normalizeAuthCallbackUrl(fallback)
    || DEFAULT_AUTH_CALLBACK_URL;
}

function sanitizeRedirectTo(raw: string | undefined, fallback: string): string {
  const safeFallback = getSafeAuthFallback(fallback);
  if (!raw) return safeFallback;
  return normalizeAuthCallbackUrl(raw) || safeFallback;
}

async function requestSupabaseOtp(payload: { email?: string; phone?: string; redirectTo: string; authMode: AuthMode }) {
  const supabaseUrl = normalizeSupabaseRuntimeUrl(process.env.SUPABASE_URL || '');
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      status: 503,
      error: 'missing_supabase_config',
    };
  }

  const shouldCreateUser = payload.authMode === 'register';
  const response = await fetch(`${supabaseUrl}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(payload.email ? { email: payload.email } : { phone: payload.phone }),
      create_user: shouldCreateUser,
      should_create_user: shouldCreateUser,
      options: payload.email
        ? {
            email_redirect_to: payload.redirectTo,
          }
        : undefined,
    }),
  });

  if (!response.ok) {
    let error = 'supabase_otp_failed';
    try {
      const data = await response.json() as { msg?: string; message?: string; error?: string; error_description?: string };
      const text = `${data.msg || ''} ${data.message || ''} ${data.error || ''} ${data.error_description || ''}`.toLowerCase();
      if (text.includes('not found') || text.includes('not exist')) error = 'user_not_found';
      if (text.includes('already') && text.includes('registered')) error = 'user_already_exists';
    } catch { /* keep generic error */ }
    return {
      ok: false,
      status: response.status,
      error,
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
      authMode?: string;
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
    const authMode: AuthMode = AUTH_MODES.includes(body.authMode as AuthMode) ? body.authMode as AuthMode : 'login';
    logAuthStartAudit('auth_start_request', {
      auditId,
      provider: provider || null,
      authMode,
      dryRun: body.dryRun === true,
      hasEmail: Boolean(body.email?.trim()),
      hasPhone: Boolean(body.phone?.trim()),
    });

    if (!provider || !AUTH_PROVIDERS.includes(provider)) {
      logAuthStartAudit('auth_start_failure', { auditId, provider: provider || null, reason: 'unsupported_provider' });
      return safeJson({ ok: false, error: 'unsupported_provider', supportedProviders: AUTH_PROVIDERS, auditId }, 400);
    }

    const redirectTo = sanitizeRedirectTo(body.redirectTo, getAuthRedirectUrl(req.url));
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
      logAuthStartAudit('auth_start_success', { auditId, provider, authMode, action: 'redirect' });
      return safeJson({
        ok: true,
        provider,
        authMode,
        accountMode: authMode === 'register' ? 'create_or_sign_in' : 'sign_in_or_provider_match',
        auditId,
        action: 'redirect',
        url: getSupabaseAuthorizeUrl('google', redirectTo),
      });
    }

    // Sign in with Apple(App Store Guideline 4.8 强制:提供第三方登录就必须提供 Apple 登录)。
    // 走 Supabase Apple OAuth,和 Google 同一 authorize 端点;上架前需在 Supabase 配好
    // Apple Service ID + secret。同样只需 SUPABASE_URL + ANON_KEY,绕过 canonical-domain 门。
    if (provider === 'apple') {
      const supabaseUrl = normalizeSupabaseRuntimeUrl(process.env.SUPABASE_URL || '');
      const supabaseKey = process.env.SUPABASE_ANON_KEY?.trim();
      if (!supabaseUrl || !supabaseKey) {
        logAuthStartAudit('auth_start_failure', { auditId, provider, reason: 'missing_supabase_config' });
        return safeJson({ ok: false, error: 'provider_not_configured', provider, auditId }, 503);
      }
      logAuthStartAudit('auth_start_success', { auditId, provider, authMode, action: 'redirect' });
      return safeJson({
        ok: true,
        provider,
        authMode,
        accountMode: authMode === 'register' ? 'create_or_sign_in' : 'sign_in_or_provider_match',
        auditId,
        action: 'redirect',
        url: getSupabaseAuthorizeUrl('apple', redirectTo),
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
        logAuthStartAudit('auth_start_success', { auditId, provider, authMode, action: 'otp_dry_run' });
        return safeJson({
          ok: true,
          provider,
          authMode,
          auditId,
          action: 'otp_dry_run',
          dryRun: true,
          noExternalOtpSent: true,
        });
      }
      const result = await requestSupabaseOtp({ email, redirectTo, authMode });
      logAuthStartAudit(result.ok ? 'auth_start_success' : 'auth_start_failure', {
        auditId,
        provider,
        authMode,
        action: result.action || null,
        reason: result.ok ? 'otp_sent' : (result.error || 'otp_failed'),
        status: result.status,
      });
      return safeJson({ ...result, provider, authMode, auditId }, result.status);
    }

    if (!phone) {
      logAuthStartAudit('auth_start_failure', { auditId, provider, reason: 'missing_phone' });
      return safeJson({ ok: false, error: 'missing_phone', auditId }, 400);
    }
    if (body.dryRun === true) {
      logAuthStartAudit('auth_start_success', { auditId, provider, authMode, action: 'otp_dry_run' });
      return safeJson({
        ok: true,
        provider,
        authMode,
        auditId,
        action: 'otp_dry_run',
        dryRun: true,
        noExternalOtpSent: true,
      });
    }
    const result = await requestSupabaseOtp({ phone, redirectTo, authMode });
    logAuthStartAudit(result.ok ? 'auth_start_success' : 'auth_start_failure', {
      auditId,
      provider,
      authMode,
      action: result.action || null,
      reason: result.ok ? 'otp_sent' : (result.error || 'otp_failed'),
      status: result.status,
    });
    return safeJson({ ...result, provider, authMode, auditId }, result.status);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    logAuthStartAudit('auth_start_failure', { auditId, provider: null, reason: 'auth_start_exception' });
    return safeJson({ ok: false, error: 'auth_start_exception', auditId, message }, 500);
  }
}
