const CONTRACT_VERSION = 'user-identity-upgrade-contract-v0';

const PROFILE_KINDS = Object.freeze([
  'local_profile',
  'anonymous_profile',
  'apple_sign_in_profile',
]);

const SUPPORTED_AUTH_PROVIDERS = Object.freeze(['email', 'google', 'wechat', 'phone']);
const AUTH_START_ENDPOINT = '/api/auth/start';

const BOUNDARIES = Object.freeze({
  accountSystemEnabled: false,
  realAuthEnabled: false,
  appleSignInEnabled: false,
  oauthEnabled: false,
  cloudIdentityEnabled: false,
  serverUserIdEnabled: false,
  createsUsersTable: false,
  realAccountLinkingEnabled: false,
  cloudSyncEnabled: false,
  writesRealUserData: false,
  realAuthRequiresCeoGate: true,
});

function normalizeRuntimeAuthProvider(providerId, runtimeProvider = {}) {
  return {
    id: providerId,
    configured: Boolean(runtimeProvider.configured),
    enabled: Boolean(runtimeProvider.enabled),
    actionStatus: runtimeProvider.actionStatus || (runtimeProvider.enabled ? 'ready' : 'configure_required'),
    startEndpoint: runtimeProvider.startEndpoint || AUTH_START_ENDPOINT,
    safeUserAction: runtimeProvider.safeUserAction || `start_${providerId}_auth`,
    missingEnvCount: Array.isArray(runtimeProvider.missingEnv) ? runtimeProvider.missingEnv.length : 0,
    secretsRedacted: true,
  };
}

function envValue(env = {}, key) {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isAuthEnabled(env = {}) {
  return envValue(env, 'BAOHE_AUTH_ENABLED').toLowerCase() === 'true';
}

function buildRuntimeAuthProviderFromEnv(providerId, env = {}) {
  const authEnabled = isAuthEnabled(env);
  const requiredEnvByProvider = {
    email: ['BAOHE_AUTH_ENABLED', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'],
    google: ['BAOHE_AUTH_ENABLED', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'],
    wechat: ['BAOHE_AUTH_ENABLED', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET'],
    phone: ['BAOHE_AUTH_ENABLED', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'],
  };
  const safeUserActionByProvider = {
    email: 'request_email_otp',
    google: 'redirect_google_oauth',
    wechat: 'redirect_wechat_oauth',
    phone: 'request_phone_otp',
  };
  const missingEnv = (requiredEnvByProvider[providerId] || []).filter((key) => !envValue(env, key));
  const configured = missingEnv.length === 0;
  return {
    id: providerId,
    category: 'account_auth',
    configured,
    enabled: configured && authEnabled,
    actionStatus: configured && authEnabled ? 'ready' : 'configure_required',
    startEndpoint: AUTH_START_ENDPOINT,
    safeUserAction: safeUserActionByProvider[providerId] || `start_${providerId}_auth`,
    missingEnv,
  };
}

function buildRuntimeAuthReadiness(runtime = {}) {
  const matrixById = new Map(
    (runtime.providerActionMatrix || [])
      .filter((provider) => provider?.category === 'account_auth' && provider?.id)
      .map((provider) => [provider.id, provider]),
  );
  const providers = Object.fromEntries(
    SUPPORTED_AUTH_PROVIDERS.map((providerId) => [
      providerId,
      normalizeRuntimeAuthProvider(providerId, matrixById.get(providerId) || runtime.accountAuth?.providers?.[providerId]),
    ]),
  );
  const providerValues = Object.values(providers);
  return {
    providerCount: providerValues.length,
    configuredProviderCount: providerValues.filter((provider) => provider.configured).length,
    enabledProviderCount: providerValues.filter((provider) => provider.enabled).length,
    startEndpoint: AUTH_START_ENDPOINT,
    providers,
  };
}

function buildCurrentIdentity(configIdentity = {}, runtimeAuthReadiness = buildRuntimeAuthReadiness()) {
  const enabledProvider = Object.values(runtimeAuthReadiness.providers).find((provider) => provider.enabled);

  return {
    profileKind: configIdentity.currentProfileKind || 'local_profile',
    localProfileKey: configIdentity.localProfileKey || 'local_profile',
    anonymousProfileSupported: true,
    accountSystemEnabled: runtimeAuthReadiness.enabledProviderCount > 0,
    serverUserId: null,
    serverUserIdEnabled: Boolean(enabledProvider),
    realAuthEnabled: Boolean(enabledProvider),
    authProvider: enabledProvider?.id || 'none',
    sourceOfTruth: enabledProvider ? 'runtime_auth_provider' : 'device_local_storage',
  };
}

export function buildUserIdentityUpgradeContract(config = {}) {
  const productionRuntime = config.productionRuntime || {
    providerActionMatrix: SUPPORTED_AUTH_PROVIDERS.map((providerId) => buildRuntimeAuthProviderFromEnv(providerId, config.env)),
  };
  const runtimeAuthReadiness = buildRuntimeAuthReadiness(productionRuntime);
  const currentIdentity = buildCurrentIdentity(config.identity, runtimeAuthReadiness);
  const accountSystemEnabled = runtimeAuthReadiness.enabledProviderCount > 0;

  return {
    version: CONTRACT_VERSION,
    implementation: 'runtime-aware-contract',
    currentIdentity,
    profileKinds: [...PROFILE_KINDS],
    supportedAuthProviders: [...SUPPORTED_AUTH_PROVIDERS],
    runtimeAuthReadiness,
    boundaries: {
      ...BOUNDARIES,
      accountSystemEnabled,
      realAuthEnabled: accountSystemEnabled,
      oauthEnabled: runtimeAuthReadiness.providers.google.enabled || runtimeAuthReadiness.providers.wechat.enabled,
      cloudIdentityEnabled: accountSystemEnabled,
      serverUserIdEnabled: accountSystemEnabled,
    },
    futureAppleSignIn: {
      provider: 'apple_sign_in',
      status: 'future_ceo_gated',
      enabledNow: false,
      storesAppleSubjectNow: false,
      createsServerUserNow: false,
      requiredBeforeEnable: [
        'CEO Gate',
        'Vera privacy wording review',
        'Ming auth QA plan',
        'account deletion policy',
      ],
    },
    accountLinking: {
      enabledNow: false,
      strategy: 'local_profile_to_account_link_after_ceo_gate',
      linkableSources: ['local_profile', 'anonymous_profile'],
      futureProviders: ['apple_sign_in'],
      conflictPolicy: 'manual_review_before_link',
      storesProviderTokenNow: false,
    },
    localDataMerge: {
      enabledNow: false,
      planKind: 'contract_only_future_merge',
      defaultPolicy: 'manual_review_before_merge',
      mergeRequiresCeoGate: true,
      sourceProfileKinds: ['local_profile', 'anonymous_profile'],
      targetProfileKind: 'apple_sign_in_profile',
      mergeOrder: [
        'export_local_snapshot',
        'create_account_after_ceo_gate',
        'dry_run_merge_plan',
        'user_review',
        'explicit_confirm',
      ],
      neverAutoMergeSensitiveData: true,
    },
    deleteLocalData: {
      enabledNow: true,
      scope: 'device_local_data_only',
      affectsServerAccount: false,
      affectsCloudData: false,
      userVisibleLabel: 'Delete local data',
    },
    deleteAccount: {
      enabledNow: false,
      scope: 'future_server_account_and_cloud_data',
      requiresAuth: true,
      requiresCeoGateBeforeImplementation: true,
      userVisibleLabel: 'Delete account',
    },
    multiDeviceConflict: {
      enabledNow: false,
      defaultResolution: 'manual_review_required',
      conflictSources: ['same_local_profile_on_multiple_devices', 'local_profile_linked_to_existing_account'],
      serverAuthoritativeNow: false,
    },
    identityBoundaryReport: {
      accountSystemEnabled,
      currentUserState: currentIdentity.profileKind,
      hasServerUserId: accountSystemEnabled,
      hasRealLogin: accountSystemEnabled,
      authStartEndpoint: AUTH_START_ENDPOINT,
      supportedAuthProviders: [...SUPPORTED_AUTH_PROVIDERS],
      futureUpgradePathReadable: true,
    },
    summary: {
      accountSystemEnabled,
      currentProfileKind: currentIdentity.profileKind,
      supportedAuthProviderCount: SUPPORTED_AUTH_PROVIDERS.length,
      configuredAuthProviderCount: runtimeAuthReadiness.configuredProviderCount,
      enabledAuthProviderCount: runtimeAuthReadiness.enabledProviderCount,
      serverUserIdEnabled: accountSystemEnabled,
      identityUpgradePathReadable: true,
      realAuthRequiresCeoGate: true,
    },
  };
}
