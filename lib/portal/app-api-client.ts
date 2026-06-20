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

export type ProductionRuntimeHealthResponse = {
  ok: boolean;
  service: 'portal-production-runtime';
  version: 'production-runtime-v0';
  safePublicStatus: true;
  secretsRedacted: true;
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
    providers: Record<'gemini' | 'doubao' | 'chatgpt', ProductionProviderStatus>;
  };
  thirdParty: {
    googleCalendar: ProductionProviderStatus;
    flomo: ProductionProviderStatus;
  };
  summary: {
    providerCount: number;
    enabledProviderCount: number;
    missingProviderCount: number;
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
    | 'provider_not_configured'
    | 'missing_email'
    | 'missing_phone'
    | 'missing_supabase_config'
    | 'supabase_otp_failed'
    | string;
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

export type SecretaryChatProvider = 'gemini' | 'chatgpt' | 'openai' | 'doubao';

export type SecretaryChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type SecretaryChatResponse = {
  text?: string;
  model?: SecretaryChatProvider | 'gemini' | 'chatgpt' | 'doubao' | string;
  error?: string;
  detail?: string;
  hint?: string;
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
  authStart: '/api/auth/start',
  authSession: '/api/auth/session',
  authLogout: '/api/auth/logout',
  cloudProfileSettings: '/api/cloud/profile-settings',
  secretaryChat: '/api/secretary/chat',
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

    sendSecretaryMessage({
      provider,
      message,
      history = [],
      maxTokens = 1200,
      personalLab = true,
    }: {
      provider: SecretaryChatProvider;
      message: string;
      history?: SecretaryChatTurn[];
      maxTokens?: number;
      personalLab?: boolean;
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
        }),
      });
    },
  };
}

export type AppApiClient = ReturnType<typeof createAppApiClient>;
export { APP_API_ENDPOINTS };
