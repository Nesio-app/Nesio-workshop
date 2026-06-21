export type ProductionRuntimeProviderStatus = {
  id: string;
  label: string;
  configured: boolean;
  enabled: boolean;
  missingEnv: string[];
};

export type ProductionRuntimeProviderAction = ProductionRuntimeProviderStatus & {
  category: 'account_auth' | 'cloud' | 'ai' | 'third_party';
  actionStatus: 'ready' | 'server_ready' | 'configure_required';
  startEndpoint: string | null;
  safeUserAction: string;
  serverOnly: boolean;
};

export type ProductionRuntimeSetupTask = ProductionRuntimeProviderAction & {
  blockedReason: 'missing_env' | 'canonical_domain_mismatch' | 'provider_disabled' | null;
  requiresCanonicalDomain: boolean;
};

type EnvMap = Record<string, string | undefined>;

function envValue(env: EnvMap, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function envAny(env: EnvMap, keys: string[]): boolean {
  return keys.some((key) => Boolean(envValue(env, key)));
}

function hasAiProviderKey(env: EnvMap): boolean {
  return envAny(env, [
    'OPENAI_API_KEY',
    'OpenAI_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'GOOGLE_AI_API_KEY',
    'GOOGLE_API_KEY',
    'DOUBAO_KEY',
    'DOUBAO_API_KEY',
    'ARK_API_KEY',
    'VOLCENGINE_API_KEY',
    'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY',
  ]);
}

function status(
  env: EnvMap,
  entry: {
    id: string;
    label: string;
    requiredEnv: string[];
    alternateGroups?: string[][];
    enabledWhen?: boolean;
  },
): ProductionRuntimeProviderStatus {
  const missingEnv = entry.requiredEnv.filter((key) => !envValue(env, key));
  const alternateMissing = (entry.alternateGroups || [])
    .filter((keys) => !envAny(env, keys))
    .map((keys) => keys.join('|'));
  const allMissing = [...missingEnv, ...alternateMissing];
  const configured = allMissing.length === 0;
  return {
    id: entry.id,
    label: entry.label,
    configured,
    enabled: configured && (entry.enabledWhen ?? true),
    missingEnv: allMissing,
  };
}

function action(
  provider: ProductionRuntimeProviderStatus,
  entry: {
    category: ProductionRuntimeProviderAction['category'];
    startEndpoint: string | null;
    safeUserAction: string;
    serverOnly?: boolean;
  },
): ProductionRuntimeProviderAction {
  const serverOnly = entry.serverOnly ?? false;
  return {
    ...provider,
    category: entry.category,
    actionStatus: provider.enabled ? (serverOnly ? 'server_ready' : 'ready') : 'configure_required',
    startEndpoint: entry.startEndpoint,
    safeUserAction: entry.safeUserAction,
    serverOnly,
  };
}

function requiresCanonicalDomain(provider: ProductionRuntimeProviderAction): boolean {
  return provider.category === 'account_auth' ||
    provider.safeUserAction === 'authorize_google_calendar_readonly';
}

function setupTask(
  provider: ProductionRuntimeProviderAction,
  context: { canonicalDomainMatchesRequestHost: boolean },
): ProductionRuntimeSetupTask {
  const needsCanonicalDomain = requiresCanonicalDomain(provider);
  const blockedReason = provider.missingEnv.length > 0
    ? 'missing_env'
    : needsCanonicalDomain && !context.canonicalDomainMatchesRequestHost
      ? 'canonical_domain_mismatch'
      : !provider.enabled && !provider.serverOnly
        ? 'provider_disabled'
        : null;

  return {
    ...provider,
    blockedReason,
    requiresCanonicalDomain: needsCanonicalDomain,
  };
}

export function buildProductionRuntimeStatus(
  env: EnvMap = process.env,
  context: { requestHost?: string | null } = {},
) {
  const canonicalDomain = envValue(env, 'BAOHE_CANONICAL_DOMAIN') || 'www.nesio.app';
  const requestHost = (context.requestHost || '').split(':')[0].toLowerCase();
  const canonicalHost = canonicalDomain.split(':')[0].toLowerCase();
  const canonicalDomainMatchesRequestHost = Boolean(requestHost) && requestHost === canonicalHost;
  const authEnabled = envValue(env, 'BAOHE_AUTH_ENABLED').toLowerCase() === 'true';
  const cloudDbEnabled = envValue(env, 'CLOUD_DB_ENABLED').toLowerCase() === 'true';
  const cloudStorageEnabled = envValue(env, 'CLOUD_STORAGE_ENABLED').toLowerCase() === 'true';
  const launchIsolationDisabled = envValue(env, 'NEXT_PUBLIC_BAOHE_FIRST_LAUNCH_RISK_ISOLATION').toLowerCase() === 'off';
  const aiModeEnabled = envValue(env, 'BAOHE_AI_PROVIDER_MODE').toLowerCase() === 'production';
  const aiProviderConfigured = hasAiProviderKey(env);
  const aiEnabled = aiProviderConfigured && (aiModeEnabled || launchIsolationDisabled);

  const accountAuth = {
    enabled: authEnabled,
    providers: {
      email: status(env, {
        id: 'email',
        label: 'Email login',
        requiredEnv: ['BAOHE_AUTH_ENABLED', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'],
        enabledWhen: authEnabled,
      }),
      google: status(env, {
        id: 'google',
        label: 'Google login',
        requiredEnv: [
          'BAOHE_AUTH_ENABLED',
          'SUPABASE_URL',
          'SUPABASE_ANON_KEY',
          'GOOGLE_CLIENT_ID',
          'GOOGLE_CLIENT_SECRET',
        ],
        enabledWhen: authEnabled,
      }),
      wechat: status(env, {
        id: 'wechat',
        label: 'WeChat login',
        requiredEnv: ['BAOHE_AUTH_ENABLED', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET'],
        enabledWhen: authEnabled,
      }),
      phone: status(env, {
        id: 'phone',
        label: 'Phone login',
        requiredEnv: ['BAOHE_AUTH_ENABLED', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SMS_PROVIDER', 'SMS_PROVIDER_API_KEY'],
        enabledWhen: authEnabled,
      }),
    },
  };

  const cloud = {
    database: status(env, {
      id: 'cloud_database',
      label: 'Cloud database',
      requiredEnv: ['CLOUD_DB_ENABLED', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      enabledWhen: cloudDbEnabled,
    }),
    storage: status(env, {
      id: 'cloud_storage',
      label: 'Cloud file storage',
      requiredEnv: ['CLOUD_STORAGE_ENABLED', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET'],
      enabledWhen: cloudStorageEnabled,
    }),
  };

  const ai = {
    enabled: aiEnabled,
    providers: {
      gemini: status(env, {
        id: 'gemini',
        label: 'Gemini',
        requiredEnv: [],
        alternateGroups: [['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_API_KEY', 'GOOGLE_API_KEY']],
        enabledWhen: aiEnabled,
      }),
      doubao: status(env, {
        id: 'doubao',
        label: 'Doubao',
        requiredEnv: [],
        alternateGroups: [['DOUBAO_KEY', 'DOUBAO_API_KEY', 'ARK_API_KEY', 'VOLCENGINE_API_KEY']],
        enabledWhen: aiEnabled,
      }),
      chatgpt: status(env, {
        id: 'chatgpt',
        label: 'ChatGPT',
        requiredEnv: [],
        alternateGroups: [['OPENAI_API_KEY', 'OpenAI_KEY']],
        enabledWhen: aiEnabled,
      }),
      claude: status(env, {
        id: 'claude',
        label: 'Claude',
        requiredEnv: [],
        alternateGroups: [['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']],
        enabledWhen: aiEnabled,
      }),
    },
  };

  const thirdParty = {
    googleCalendar: status(env, {
      id: 'google_calendar',
      label: 'Google Calendar',
      requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    }),
    flomo: status(env, {
      id: 'flomo',
      label: 'Flomo',
      requiredEnv: [],
      alternateGroups: [['FLOMO_WEBHOOK_URL', 'FLOMO_API_URL']],
    }),
  };

  const allProviders = [
    ...Object.values(accountAuth.providers),
    cloud.database,
    cloud.storage,
    ...Object.values(ai.providers),
    ...Object.values(thirdParty),
  ];

  const providerActionMatrix = [
    action(accountAuth.providers.email, {
      category: 'account_auth',
      startEndpoint: '/api/auth/start',
      safeUserAction: 'request_email_otp',
    }),
    action(accountAuth.providers.google, {
      category: 'account_auth',
      startEndpoint: '/api/auth/start',
      safeUserAction: 'redirect_google_oauth',
    }),
    action(accountAuth.providers.wechat, {
      category: 'account_auth',
      startEndpoint: '/api/auth/start',
      safeUserAction: 'redirect_wechat_oauth',
    }),
    action(accountAuth.providers.phone, {
      category: 'account_auth',
      startEndpoint: '/api/auth/start',
      safeUserAction: 'request_phone_otp',
    }),
    action(cloud.database, {
      category: 'cloud',
      startEndpoint: null,
      safeUserAction: 'server_data_store_only',
      serverOnly: true,
    }),
    action(cloud.storage, {
      category: 'cloud',
      startEndpoint: null,
      safeUserAction: 'server_file_store_only',
      serverOnly: true,
    }),
    action(ai.providers.gemini, {
      category: 'ai',
      startEndpoint: '/api/secretary/chat',
      safeUserAction: 'send_secretary_message_to_gemini',
    }),
    action(ai.providers.chatgpt, {
      category: 'ai',
      startEndpoint: '/api/secretary/chat',
      safeUserAction: 'send_secretary_message_to_chatgpt',
    }),
    action(ai.providers.doubao, {
      category: 'ai',
      startEndpoint: '/api/secretary/chat',
      safeUserAction: 'send_secretary_message_to_doubao',
    }),
    action(ai.providers.claude, {
      category: 'ai',
      startEndpoint: '/api/secretary/chat',
      safeUserAction: 'send_secretary_message_to_claude',
    }),
    action(thirdParty.googleCalendar, {
      category: 'third_party',
      startEndpoint: '/api/portal/calendar/connect',
      safeUserAction: 'authorize_google_calendar_readonly',
    }),
    action(thirdParty.flomo, {
      category: 'third_party',
      startEndpoint: '/api/portal/flomo',
      safeUserAction: 'capture_note_when_flomo_configured',
      serverOnly: true,
    }),
  ];
  const setupTaskMatrix = providerActionMatrix.map((provider) => setupTask(provider, {
    canonicalDomainMatchesRequestHost,
  }));

  return {
    version: 'production-runtime-v0',
    safePublicStatus: true,
    secretsRedacted: true,
    canonicalDomain,
    requestHost,
    canonicalDomainMatchesRequestHost,
    accountAuth,
    cloud,
    ai,
    thirdParty,
    providerActionMatrix,
    setupTaskMatrix,
    summary: {
      providerCount: allProviders.length,
      enabledProviderCount: allProviders.filter((provider) => provider.enabled).length,
      missingProviderCount: allProviders.filter((provider) => !provider.configured).length,
      actionableProviderCount: providerActionMatrix.filter((provider) => provider.actionStatus === 'ready').length,
      blockedProviderCount: providerActionMatrix.filter((provider) => provider.actionStatus === 'configure_required').length,
      setupTaskCount: setupTaskMatrix.length,
      blockedSetupTaskCount: setupTaskMatrix.filter((task) => task.blockedReason).length,
      canonicalDomainReady: canonicalDomainMatchesRequestHost,
      productionRuntimeReady: allProviders.every((provider) => provider.enabled),
    },
  };
}

export function getAuthRedirectUrl(requestUrl: string, env: EnvMap = process.env): string {
  const configured = envValue(env, 'BAOHE_AUTH_REDIRECT_URL');
  if (configured) return configured;
  const url = new URL(requestUrl);
  return `${url.origin}/api/auth/callback`;
}

export function getSupabaseAuthorizeUrl(provider: string, redirectTo: string, env: EnvMap = process.env): string {
  const supabaseUrl = envValue(env, 'SUPABASE_URL');
  const url = new URL('/auth/v1/authorize', supabaseUrl);
  url.searchParams.set('provider', provider);
  url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

export function getWechatAuthorizeUrl(redirectTo: string, env: EnvMap = process.env): string {
  const appId = envValue(env, 'WECHAT_APP_ID');
  const redirect = new URL(envValue(env, 'WECHAT_REDIRECT_URI') || redirectTo);
  redirect.searchParams.set('provider', 'wechat');
  const url = new URL('https://open.weixin.qq.com/connect/qrconnect');
  url.searchParams.set('appid', appId);
  url.searchParams.set('redirect_uri', redirect.toString());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', envValue(env, 'WECHAT_OAUTH_SCOPE') || 'snsapi_login');
  url.searchParams.set('state', 'nesio');
  return `${url.toString()}#wechat_redirect`;
}
