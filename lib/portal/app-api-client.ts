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
  };
}

export type AppApiClient = ReturnType<typeof createAppApiClient>;
export { APP_API_ENDPOINTS };
