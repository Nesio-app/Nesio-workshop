const CONTRACT_VERSION = 'production-activation-v0';

const CEO_APPROVED_AT = '2026-06-19';

const PROVIDERS = Object.freeze([
  {
    id: 'auth_email',
    category: 'account_auth',
    label: 'Email login',
    env: ['BAOHE_AUTH_ENABLED', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'],
    runtimeSurface: 'account_session',
    userVisible: true,
  },
  {
    id: 'auth_google',
    category: 'account_auth',
    label: 'Google login',
    env: ['BAOHE_AUTH_ENABLED', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    runtimeSurface: 'oauth_session',
    userVisible: true,
  },
  {
    id: 'auth_wechat',
    category: 'account_auth',
    label: 'WeChat login',
    env: ['BAOHE_AUTH_ENABLED', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET'],
    runtimeSurface: 'oauth_session',
    userVisible: true,
  },
  {
    id: 'auth_phone',
    category: 'account_auth',
    label: 'Phone login',
    env: ['BAOHE_AUTH_ENABLED', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SMS_PROVIDER', 'SMS_PROVIDER_API_KEY'],
    runtimeSurface: 'otp_session',
    userVisible: true,
  },
  {
    id: 'cloud_database',
    category: 'cloud_database',
    label: 'Cloud database',
    env: ['CLOUD_DB_ENABLED', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    runtimeSurface: 'server_data_store',
    userVisible: false,
  },
  {
    id: 'cloud_storage',
    category: 'cloud_service',
    label: 'Cloud file storage',
    env: ['CLOUD_STORAGE_ENABLED', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET'],
    runtimeSurface: 'server_file_store',
    userVisible: false,
  },
  {
    id: 'ai_openai',
    category: 'ai_provider',
    label: 'OpenAI',
    env: ['BAOHE_AI_PROVIDER_MODE', 'OPENAI_API_KEY'],
    alternateEnv: ['OpenAI_KEY'],
    runtimeSurface: 'secretary_chat',
    userVisible: true,
  },
  {
    id: 'ai_gemini',
    category: 'ai_provider',
    label: 'Gemini',
    env: ['BAOHE_AI_PROVIDER_MODE', 'GEMINI_API_KEY'],
    alternateEnv: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_API_KEY', 'GOOGLE_API_KEY'],
    runtimeSurface: 'secretary_chat',
    userVisible: true,
  },
  {
    id: 'ai_doubao',
    category: 'ai_provider',
    label: 'Doubao',
    env: ['BAOHE_AI_PROVIDER_MODE', 'DOUBAO_KEY'],
    alternateEnv: ['DOUBAO_API_KEY', 'ARK_API_KEY', 'VOLCENGINE_API_KEY'],
    runtimeSurface: 'secretary_chat',
    userVisible: true,
  },
  {
    id: 'ai_anthropic',
    category: 'ai_provider',
    label: 'Claude / Anthropic',
    env: ['BAOHE_AI_PROVIDER_MODE', 'ANTHROPIC_API_KEY'],
    alternateEnv: ['CLAUDE_API_KEY'],
    runtimeSurface: 'secretary_chat',
    userVisible: true,
  },
  {
    id: 'google_calendar',
    category: 'third_party_authorization',
    label: 'Google Calendar',
    env: ['GOOGLE_CALENDAR_ICAL_URL'],
    alternateEnv: ['GOOGLE_CALENDAR_ICS_URL', 'GOOGLE_CALENDAR_ICAL_URLS'],
    runtimeSurface: 'calendar_readonly',
    userVisible: true,
  },
  {
    id: 'flomo',
    category: 'third_party_authorization',
    label: 'Flomo',
    env: ['FLOMO_WEBHOOK_URL', 'FLOMO_API_KEY'],
    alternateEnv: ['FLOMO_API_URL'],
    runtimeSurface: 'note_capture',
    userVisible: true,
  },
]);

const RUNTIME_SWITCHES = Object.freeze([
  {
    key: 'BAOHE_AUTH_ENABLED',
    category: 'account_auth',
    expectedEnabledValue: 'true',
    failClosedWhenMissing: true,
  },
  {
    key: 'CLOUD_DB_ENABLED',
    category: 'cloud_database',
    expectedEnabledValue: 'true',
    failClosedWhenMissing: true,
  },
  {
    key: 'CLOUD_STORAGE_ENABLED',
    category: 'cloud_service',
    expectedEnabledValue: 'true',
    failClosedWhenMissing: true,
  },
  {
    key: 'BAOHE_AI_PROVIDER_MODE',
    category: 'ai_provider',
    expectedEnabledValue: 'production',
    failClosedWhenMissing: true,
  },
]);

function readEnv(name, env) {
  const value = env?.[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function providerHasAnyAlternate(provider, env) {
  return (provider.alternateEnv || []).some((name) => readEnv(name, env));
}

function evaluateProvider(provider, env) {
  const missing = provider.env.filter((name) => !readEnv(name, env));
  const alternateSatisfied = missing.length === 1 && providerHasAnyAlternate(provider, env);
  const missingRequiredEnv = alternateSatisfied ? [] : missing;
  const configured = missingRequiredEnv.length === 0;
  return {
    id: provider.id,
    category: provider.category,
    label: provider.label,
    runtimeSurface: provider.runtimeSurface,
    userVisible: provider.userVisible,
    ceoApproved: true,
    configured,
    runtimeEnabled: configured,
    status: configured ? 'configured' : 'missing_env',
    requiredEnv: [...provider.env],
    alternateEnv: [...(provider.alternateEnv || [])],
    missingEnv: missingRequiredEnv,
    failClosed: !configured,
  };
}

function evaluateSwitch(entry, env) {
  const value = readEnv(entry.key, env);
  const enabled = value.toLowerCase() === entry.expectedEnabledValue;
  return {
    key: entry.key,
    category: entry.category,
    expectedEnabledValue: entry.expectedEnabledValue,
    configuredValuePresent: Boolean(value),
    enabled,
    failClosed: entry.failClosedWhenMissing && !enabled,
  };
}

function summarize(entries, switches) {
  const configuredProviderCount = entries.filter((entry) => entry.configured).length;
  const runtimeEnabledProviderCount = entries.filter((entry) => entry.runtimeEnabled).length;
  const missingEnvProviderCount = entries.filter((entry) => entry.status === 'missing_env').length;
  const enabledSwitchCount = switches.filter((entry) => entry.enabled).length;
  const missingEnvNames = [...new Set(entries.flatMap((entry) => entry.missingEnv))].sort();
  const categories = entries.reduce((acc, entry) => {
    acc[entry.category] = acc[entry.category] || {
      total: 0,
      configured: 0,
      missingEnv: 0,
    };
    acc[entry.category].total += 1;
    if (entry.configured) acc[entry.category].configured += 1;
    if (entry.status === 'missing_env') acc[entry.category].missingEnv += 1;
    return acc;
  }, {});

  return {
    version: CONTRACT_VERSION,
    ceoApproved: true,
    ceoApprovedAt: CEO_APPROVED_AT,
    providerCount: entries.length,
    configuredProviderCount,
    runtimeEnabledProviderCount,
    missingEnvProviderCount,
    runtimeSwitchCount: switches.length,
    enabledSwitchCount,
    missingEnvNames,
    categorySummary: categories,
    productionReady: missingEnvProviderCount === 0 && enabledSwitchCount === switches.length,
  };
}

export function buildProductionActivationContract({ env = process.env } = {}) {
  const providers = PROVIDERS.map((provider) => evaluateProvider(provider, env));
  const runtimeSwitches = RUNTIME_SWITCHES.map((entry) => evaluateSwitch(entry, env));
  const summary = summarize(providers, runtimeSwitches);

  return {
    version: CONTRACT_VERSION,
    implementation: 'guarded-production-readiness',
    ceoGate: {
      status: 'approved',
      approvedAt: CEO_APPROVED_AT,
      approvedScope: [
        'real_account_system',
        'cloud_service',
        'cloud_database',
        'ai_provider_keys',
        'third_party_authorization',
      ],
      secretsMustStayOutOfGit: true,
      providerConsoleSetupStillRequired: true,
    },
    boundaries: {
      readsEnvironmentOnly: true,
      writesEnvironment: false,
      writesSecrets: false,
      callsExternalProvidersDuringReport: false,
      createsCloudResourcesDuringReport: false,
      mutatesUserDataDuringReport: false,
      failClosedWhenMissingConfig: true,
    },
    runtimeSwitches,
    providers,
    actionPlan: [
      {
        step: 'configure_vercel_environment',
        owner: 'Jing/CEO',
        status: summary.missingEnvNames.length ? 'required' : 'done',
        requiredEnv: summary.missingEnvNames,
      },
      {
        step: 'provider_console_callback_setup',
        owner: 'Jing/CEO',
        status: 'required',
        callbackDomain: 'www.nesio.app',
      },
      {
        step: 'qa_auth_cloud_ai_flow',
        owner: 'Ming QA',
        status: summary.productionReady ? 'ready' : 'waiting_for_env',
      },
    ],
    summary,
  };
}

export { CONTRACT_VERSION as PRODUCTION_ACTIVATION_VERSION };
