export type ProductionRuntimeProviderStatus = {
  id: string;
  label: string;
  configured: boolean;
  enabled: boolean;
  missingEnv: string[];
};

type EnvMap = Record<string, string | undefined>;

function envValue(env: EnvMap, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function envAny(env: EnvMap, keys: string[]): boolean {
  return keys.some((key) => Boolean(envValue(env, key)));
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

export function buildProductionRuntimeStatus(env: EnvMap = process.env) {
  const authEnabled = envValue(env, 'BAOHE_AUTH_ENABLED').toLowerCase() === 'true';
  const cloudDbEnabled = envValue(env, 'CLOUD_DB_ENABLED').toLowerCase() === 'true';
  const cloudStorageEnabled = envValue(env, 'CLOUD_STORAGE_ENABLED').toLowerCase() === 'true';
  const aiEnabled = envValue(env, 'BAOHE_AI_PROVIDER_MODE').toLowerCase() === 'production';

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
        requiredEnv: ['BAOHE_AI_PROVIDER_MODE'],
        alternateGroups: [['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_API_KEY', 'GOOGLE_API_KEY']],
        enabledWhen: aiEnabled,
      }),
      doubao: status(env, {
        id: 'doubao',
        label: 'Doubao',
        requiredEnv: ['BAOHE_AI_PROVIDER_MODE'],
        alternateGroups: [['DOUBAO_KEY', 'DOUBAO_API_KEY', 'ARK_API_KEY', 'VOLCENGINE_API_KEY']],
        enabledWhen: aiEnabled,
      }),
      chatgpt: status(env, {
        id: 'chatgpt',
        label: 'ChatGPT',
        requiredEnv: ['BAOHE_AI_PROVIDER_MODE'],
        alternateGroups: [['OPENAI_API_KEY', 'OpenAI_KEY']],
        enabledWhen: aiEnabled,
      }),
      claude: status(env, {
        id: 'claude',
        label: 'Claude',
        requiredEnv: ['BAOHE_AI_PROVIDER_MODE'],
        alternateGroups: [['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']],
        enabledWhen: aiEnabled,
      }),
    },
  };

  const thirdParty = {
    googleCalendar: status(env, {
      id: 'google_calendar',
      label: 'Google Calendar',
      requiredEnv: [],
      alternateGroups: [['GOOGLE_CALENDAR_ICAL_URL', 'GOOGLE_CALENDAR_ICS_URL', 'GOOGLE_CALENDAR_ICAL_URLS']],
    }),
    flomo: status(env, {
      id: 'flomo',
      label: 'Flomo',
      requiredEnv: ['FLOMO_API_KEY'],
    }),
  };

  const allProviders = [
    ...Object.values(accountAuth.providers),
    cloud.database,
    cloud.storage,
    ...Object.values(ai.providers),
    ...Object.values(thirdParty),
  ];

  return {
    version: 'production-runtime-v0',
    safePublicStatus: true,
    secretsRedacted: true,
    accountAuth,
    cloud,
    ai,
    thirdParty,
    summary: {
      providerCount: allProviders.length,
      enabledProviderCount: allProviders.filter((provider) => provider.enabled).length,
      missingProviderCount: allProviders.filter((provider) => !provider.configured).length,
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
  const redirect = envValue(env, 'WECHAT_REDIRECT_URI') || redirectTo;
  const url = new URL('https://open.weixin.qq.com/connect/qrconnect');
  url.searchParams.set('appid', appId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', envValue(env, 'WECHAT_OAUTH_SCOPE') || 'snsapi_login');
  url.searchParams.set('state', 'baohe');
  return `${url.toString()}#wechat_redirect`;
}
