import { NextRequest, NextResponse } from 'next/server';
import {
  buildProductionRuntimeStatus,
  getAuthRedirectUrl,
  getSupabaseAuthorizeUrl,
  getWechatAuthorizeUrl,
  type ProductionRuntimeProviderStatus,
} from '@/lib/portal/production-runtime';

type AuthProvider = 'email' | 'google' | 'wechat' | 'phone';

const AUTH_PROVIDERS: AuthProvider[] = ['email', 'google', 'wechat', 'phone'];

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

function getProviderStatus(provider: AuthProvider): ProductionRuntimeProviderStatus {
  const status = buildProductionRuntimeStatus();
  return status.accountAuth.providers[provider];
}

async function requestSupabaseOtp(payload: { email?: string; phone?: string; redirectTo: string }) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
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
  let body: {
    provider?: string;
    email?: string;
    phone?: string;
    redirectTo?: string;
  };

  try {
    body = await req.json();
  } catch {
    return safeJson({ ok: false, error: 'invalid_json' }, 400);
  }

  const provider = body.provider as AuthProvider | undefined;
  if (!provider || !AUTH_PROVIDERS.includes(provider)) {
    return safeJson({ ok: false, error: 'unsupported_provider', supportedProviders: AUTH_PROVIDERS }, 400);
  }

  const providerStatus = getProviderStatus(provider);
  if (!providerStatus.enabled) {
    return safeJson(
      {
        ok: false,
        error: 'provider_not_configured',
        provider,
        status: providerStatus,
      },
      503,
    );
  }

  const redirectTo = body.redirectTo || getAuthRedirectUrl(req.url);

  if (provider === 'google') {
    return safeJson({
      ok: true,
      provider,
      action: 'redirect',
      url: getSupabaseAuthorizeUrl('google', redirectTo),
    });
  }

  if (provider === 'wechat') {
    return safeJson({
      ok: true,
      provider,
      action: 'redirect',
      url: getWechatAuthorizeUrl(redirectTo),
    });
  }

  if (provider === 'email') {
    if (!body.email) return safeJson({ ok: false, error: 'missing_email' }, 400);
    const result = await requestSupabaseOtp({ email: body.email, redirectTo });
    return safeJson({ ...result, provider }, result.status);
  }

  if (!body.phone) return safeJson({ ok: false, error: 'missing_phone' }, 400);
  const result = await requestSupabaseOtp({ phone: body.phone, redirectTo });
  return safeJson({ ...result, provider }, result.status);
}
