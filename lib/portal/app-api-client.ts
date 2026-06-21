export type AppApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type AppApiBoundary = {
  implementation: string;
  dataSource: 'mock-local-fixture' | string;
  readsRealUserData: boolean;
  writesRealUserData: boolean;
  usesRealAuth: boolean;
  writesCloud: boolean;
  writesNotion: boolean;
  authorizesExternalServices: boolean;
  productionDataAccess: boolean;
};

export type LocalProfile = {
  profileId: string;
  profileKind: 'local_profile';
  displayName: string;
  authProvider: 'none';
  source: 'local-fixture';
};

export type AppApiEnvelope = {
  ok: boolean;
  endpoint: string;
  generatedAt: string;
  contract: 'api-contract-v0';
  boundaries: AppApiBoundary;
};

export type ModuleRecord = {
  moduleId: string;
  name: string;
  status: 'enabled' | 'gated' | string;
  aiEnabled: boolean;
  dataScope: string;
};

export type InventoryMode = 'demo' | 'personal';

export type InventoryItemRecord = {
  id: string;
  moduleId?: string;
  name: string;
  category?: string;
  quantity?: number;
  source?: string;
  demoOnly?: boolean;
  [key: string]: unknown;
};

export type EntitlementRecord = {
  entitlementId: string;
  profileId: string;
  moduleId: string;
  planKey: string;
  status: 'active' | 'inactive' | string;
  source: 'local-fixture' | string;
};

export type ModulesResponse = AppApiEnvelope & {
  profile: LocalProfile;
  modules: ModuleRecord[];
};

export type InventoryResponse = AppApiEnvelope & {
  mode: InventoryMode;
  profile: LocalProfile;
  items: InventoryItemRecord[];
  personalDataRead: false;
};

export type EntitlementsResponse = AppApiEnvelope & {
  profile: LocalProfile;
  entitlements: EntitlementRecord[];
};

export type UserDataExportResponse = AppApiEnvelope & {
  exportKind: 'mock-local-export';
  profile: LocalProfile;
  includesRealUserData: false;
  payload: unknown;
};

export type UserDataDeleteResponse = AppApiEnvelope & {
  deleteKind: 'mock-local-delete';
  dryRun: boolean;
  profile: LocalProfile;
  deletesRealUserData: false;
  deletesCloudData: false;
  deleted: string[];
  wouldDelete: string[];
};

export type ProductionProviderStatus = {
  id: string;
  label: string;
  configured: boolean;
  enabled: boolean;
  missingEnv: string[];
};

export type ProductionRuntimeProviderAction = ProductionProviderStatus & {
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

export type ProductionRuntimeHealthResponse = {
  ok: boolean;
  service: 'portal-production-runtime';
  version: 'production-runtime-v0';
  safePublicStatus: true;
  secretsRedacted: true;
  canonicalDomain: string;
  requestHost: string;
  canonicalDomainMatchesRequestHost: boolean;
  accountAuth: {
    enabled: boolean;
    providers: Record<'email' | 'google' | 'wechat' | 'phone', ProductionProviderStatus>;
  };
  cloud: {
    database: ProductionProviderStatus;
    storage: ProductionProviderStatus;
  };
  ai: {
    enabled: boolean;
    providers: Record<'gemini' | 'doubao' | 'chatgpt' | 'claude', ProductionProviderStatus>;
  };
  thirdParty: {
    googleCalendar: ProductionProviderStatus;
    flomo: ProductionProviderStatus;
  };
  providerActionMatrix: ProductionRuntimeProviderAction[];
  setupTaskMatrix: ProductionRuntimeSetupTask[];
  summary: {
    providerCount: number;
    enabledProviderCount: number;
    missingProviderCount: number;
    actionableProviderCount: number;
    blockedProviderCount: number;
    setupTaskCount: number;
    blockedSetupTaskCount: number;
    categoryReadinessSummary: Record<
      ProductionRuntimeProviderAction['category'],
      {
        total: number;
        ready: number;
        serverReady: number;
        blocked: number;
      }
    >;
    canonicalDomainReady: boolean;
    productionRuntimeReady: boolean;
  };
};

export type ProductionActivationChecklistEntry = {
  id: string;
  label: string;
  category: ProductionRuntimeProviderAction['category'];
  configured: boolean;
  enabled: boolean;
  actionStatus: ProductionRuntimeProviderAction['actionStatus'];
  startEndpoint: string | null;
  safeUserAction: string;
  serverOnly: boolean;
  missingEnv: string[];
  blockedReason: ProductionRuntimeSetupTask['blockedReason'];
  requiresCanonicalDomain: boolean;
  nextAction:
    | 'ready_for_user_action'
    | 'ready_server_side'
    | 'set_missing_environment_variables'
    | 'verify_canonical_domain_or_allowed_runtime_host'
    | 'enable_provider_runtime_switch'
    | 'review_provider_configuration'
    | string;
};

export type ProductionActivationChecklistResponse = {
  ok: boolean;
  service: 'portal-production-activation-checklist';
  version: 'production-activation-checklist-v0';
  safePublicStatus: true;
  secretsRedacted: true;
  canonicalDomain: string;
  requestHost: string;
  canonicalDomainMatchesRequestHost: boolean;
  categorySummary: ProductionRuntimeHealthResponse['summary']['categoryReadinessSummary'];
  activationChecklist: ProductionActivationChecklistEntry[];
  readyActions: ProductionActivationChecklistEntry[];
  blockedActions: ProductionActivationChecklistEntry[];
  nextSetupActions: Array<Pick<
    ProductionActivationChecklistEntry,
    'id' | 'label' | 'category' | 'blockedReason' | 'missingEnv' | 'requiresCanonicalDomain' | 'nextAction'
  >>;
  summary: {
    providerCount: number;
    readyActionCount: number;
    blockedActionCount: number;
    canonicalDomainReady: boolean;
    productionRuntimeReady: boolean;
  };
};

export type AuthStartProvider = 'email' | 'google' | 'wechat' | 'phone';

export type AuthStartResponse = {
  safePublicStatus: true;
  secretsRedacted: true;
  ok: boolean;
  provider?: AuthStartProvider;
  action?: 'redirect' | 'otp_sent';
  url?: string;
  status?: ProductionProviderStatus;
  error?:
    | 'invalid_json'
    | 'unsupported_provider'
    | 'canonical_domain_mismatch'
    | 'provider_not_configured'
    | 'missing_email'
    | 'missing_phone'
    | 'missing_supabase_config'
    | 'supabase_otp_failed'
    | string;
  setupTask?: ProductionRuntimeSetupTask;
  supportedProviders?: AuthStartProvider[];
};

export type AuthSessionUser = {
  id: string;
  email: string;
  phone: string;
  provider: string;
  providers: string[];
};

export type AuthSessionResponse = {
  safePublicStatus: true;
  secretsRedacted: true;
  ok: boolean;
  loggedIn: boolean;
  hasRefreshToken: boolean;
  status: 'signed_out' | 'signed_in' | 'session_unverified' | string;
  user?: AuthSessionUser;
};

export type AuthLogoutResponse = {
  safePublicStatus: true;
  secretsRedacted: true;
  ok: boolean;
  signedOut: boolean;
  supabaseRevoked?: boolean;
};

export type CloudProfileSettings = {
  displayName?: string;
  avatarUrl?: string;
  locale?: string;
  displayLanguage?: string;
  coachStyle?: string;
  theme?: string;
  calendarUrl?: string;
  observationPushEnabled?: boolean;
};

export type CloudProfileSettingsResponse = {
  safePublicStatus: true;
  secretsRedacted: true;
  ok: boolean;
  readsCloud: boolean;
  writesCloud: boolean;
  settings?: CloudProfileSettings;
  updatedAt?: string | null;
  error?: 'cloud_not_configured' | 'not_signed_in' | 'cloud_read_failed' | 'cloud_write_failed' | string;
};

export type CloudStatusResponse = {
  safePublicStatus: true;
  secretsRedacted: true;
  cloudStatus: true;
  ok: boolean;
  readsCloud: false;
  writesCloud: false;
  service: 'portal-cloud-status';
  version: 'cloud-status-v0';
  endpoints: {
    profileSettingsEndpoint: '/api/cloud/profile-settings';
    inventoryEndpoint: '/api/cloud/inventory';
  };
  tables: {
    profileSettings: 'profile_settings';
    inventoryItems: 'inventory_items';
  };
  authSession: {
    accessCookiePresent: boolean;
    refreshCookiePresent: boolean;
    linkedProvider: string;
    canAttemptCloudRead: boolean;
  };
  cloud: ProductionRuntimeHealthResponse['cloud'];
  setupTasks: {
    database?: ProductionRuntimeSetupTask;
    storage?: ProductionRuntimeSetupTask;
  };
  setupTaskMatrix: ProductionRuntimeSetupTask[];
  summary: {
    cloudDatabaseReady: boolean;
    cloudStorageReady: boolean;
    signedInCookiePresent: boolean;
    canonicalDomainReady: boolean;
    cloudBlockedReason: ProductionRuntimeSetupTask['blockedReason'];
  };
};

export type CloudInventorySnapshotItem = InventoryItemRecord & {
  schemaVersion?: 'LocalInventoryItem@v1' | string;
  locationHint?: string;
  notes?: string;
  purchaseMemory?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  mode?: InventoryMode;
};

export type CloudInventorySnapshotResponse = {
  safePublicStatus: true;
  secretsRedacted: true;
  ok: boolean;
  cloudInventorySnapshot: true;
  readsCloud: boolean;
  writesCloud: boolean;
  items?: CloudInventorySnapshotItem[];
  itemCount?: number;
  savedCount?: number;
  rejectedCount?: number;
  deletedMissingCount?: number;
  updatedAt?: string | null;
  error?:
    | 'cloud_not_configured'
    | 'not_signed_in'
    | 'cloud_read_failed'
    | 'cloud_write_failed'
    | 'invalid_json'
    | string;
};

export type SecretaryChatProvider = 'gemini' | 'chatgpt' | 'openai' | 'doubao' | 'claude' | 'anthropic';

export type SecretaryChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type SecretaryChatResponse = {
  text?: string;
  model?: SecretaryChatProvider | string;
  error?: string;
  detail?: string;
  hint?: string;
};

export type SecretaryHealthResponse = {
  ok: boolean;
  service: 'secretary';
  status?: 'ready' | string;
  behaviorEnabled?: boolean;
  gemini: boolean;
  doubao: boolean;
  chatgpt: boolean;
  claude: boolean;
  model?: string | null;
  doubaoModel?: string | null;
  openaiModel?: string | null;
  claudeModel?: string | null;
  defaultProvider?: 'gemini' | 'chatgpt' | 'claude' | 'doubao' | null;
  chatEndpoint?: '/api/secretary/chat' | string;
  providerMatrix?: Array<{
    provider: 'gemini' | 'chatgpt' | 'claude' | 'doubao' | string;
    label: string;
    nativeConfigured: boolean;
    fallbackProvider: 'gemini' | string | null;
    runtimeAvailable: boolean;
    chatEndpoint: '/api/secretary/chat' | string;
    model: string | null;
  }>;
  productionActivation?: {
    aiProviderMode: string;
    aiRuntimeEnabled: boolean;
    defaultProvider?: 'gemini' | 'chatgpt' | 'claude' | 'doubao' | null;
    chatEndpoint?: '/api/secretary/chat' | string;
    configuredProviders: {
      gemini: boolean;
      doubao: boolean;
      chatgpt: boolean;
      claude: boolean;
    };
  };
  reason?: string;
  statusCode?: number;
  message?: string;
};

type ClientOptions = {
  fetcher?: AppApiFetch;
  baseUrl?: string;
};

const APP_API_ENDPOINTS = {
  modules: '/api/modules',
  inventory: '/api/inventory',
  entitlements: '/api/entitlements',
  userDataExport: '/api/user-data/export',
  userDataDelete: '/api/user-data/delete',
  productionRuntimeHealth: '/api/portal/production/health',
  productionActivationChecklist: '/api/portal/production/activation-checklist',
  authStart: '/api/auth/start',
  authSession: '/api/auth/session',
  authLogout: '/api/auth/logout',
  cloudStatus: '/api/cloud/status',
  cloudProfileSettings: '/api/cloud/profile-settings',
  cloudInventory: '/api/cloud/inventory',
  secretaryChat: '/api/secretary/chat',
  secretaryHealth: '/api/secretary/health',
} as const;

function buildUrl(baseUrl: string, path: string, params?: Record<string, string | number | boolean | undefined>) {
  const prefix = baseUrl.replace(/\/$/, '');
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return `${prefix}${path}${query ? `?${query}` : ''}`;
}

async function readJson<T>(fetcher: AppApiFetch, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`App API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function readJsonAllowError<T>(fetcher: AppApiFetch, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...init?.headers,
    },
  });

  return response.json() as Promise<T>;
}

export function createAppApiClient(options: ClientOptions = {}) {
  const fetcher = options.fetcher || fetch;
  const baseUrl = options.baseUrl || '';

  return {
    endpoints: APP_API_ENDPOINTS,

    fetchModules(): Promise<ModulesResponse> {
      return readJson(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.modules));
    },

    fetchInventory(mode: InventoryMode = 'demo'): Promise<InventoryResponse> {
      return readJson(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.inventory, { mode }));
    },

    fetchEntitlements(): Promise<EntitlementsResponse> {
      return readJson(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.entitlements));
    },

    exportUserData(): Promise<UserDataExportResponse> {
      return readJson(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.userDataExport));
    },

    deleteUserData({ dryRun = true }: { dryRun?: boolean } = {}): Promise<UserDataDeleteResponse> {
      return readJson(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.userDataDelete, { dryRun: dryRun ? 1 : 0 }), {
        method: 'POST',
      });
    },

    fetchProductionRuntimeHealth(): Promise<ProductionRuntimeHealthResponse> {
      return readJson(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.productionRuntimeHealth));
    },

    fetchProductionActivationChecklist(): Promise<ProductionActivationChecklistResponse> {
      return readJson(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.productionActivationChecklist));
    },

    fetchAuthSession(): Promise<AuthSessionResponse> {
      return readJsonAllowError(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.authSession));
    },

    startAuth({
      provider,
      email,
      phone,
      redirectTo,
    }: {
      provider: AuthStartProvider;
      email?: string;
      phone?: string;
      redirectTo?: string;
    }): Promise<AuthStartResponse> {
      return readJsonAllowError(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.authStart), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider,
          email,
          phone,
          redirectTo,
        }),
      });
    },

    logoutAuth(): Promise<AuthLogoutResponse> {
      return readJsonAllowError(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.authLogout), {
        method: 'POST',
      });
    },

    fetchCloudStatus(): Promise<CloudStatusResponse> {
      return readJsonAllowError(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.cloudStatus));
    },

    fetchCloudProfileSettings(): Promise<CloudProfileSettingsResponse> {
      return readJsonAllowError(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.cloudProfileSettings));
    },

    saveCloudProfileSettings(settings: CloudProfileSettings): Promise<CloudProfileSettingsResponse> {
      return readJsonAllowError(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.cloudProfileSettings), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ settings }),
      });
    },

    fetchCloudInventorySnapshot(): Promise<CloudInventorySnapshotResponse> {
      return readJsonAllowError(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.cloudInventory));
    },

    saveCloudInventorySnapshot({
      items,
      deleteMissing = false,
    }: {
      items: CloudInventorySnapshotItem[];
      deleteMissing?: boolean;
    }): Promise<CloudInventorySnapshotResponse> {
      return readJsonAllowError(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.cloudInventory), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ items, deleteMissing }),
      });
    },

    fetchSecretaryHealth({ personalLab = true }: { personalLab?: boolean } = {}): Promise<SecretaryHealthResponse> {
      return readJsonAllowError(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.secretaryHealth), {
        headers: {
          ...(personalLab ? { 'x-baohe-access-mode': 'personal_lab' } : {}),
        },
      });
    },

    sendSecretaryMessage({
      provider,
      message,
      history = [],
      maxTokens = 1200,
      personalLab = true,
      locale,
    }: {
      provider: SecretaryChatProvider;
      message: string;
      history?: SecretaryChatTurn[];
      maxTokens?: number;
      personalLab?: boolean;
      locale?: string;
    }): Promise<SecretaryChatResponse> {
      return readJsonAllowError(fetcher, buildUrl(baseUrl, APP_API_ENDPOINTS.secretaryChat), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(personalLab ? { 'x-baohe-access-mode': 'personal_lab' } : {}),
        },
        body: JSON.stringify({
          model: provider,
          message,
          history,
          maxTokens,
          locale,
        }),
      });
    },
  };
}

export type AppApiClient = ReturnType<typeof createAppApiClient>;
export { APP_API_ENDPOINTS };
