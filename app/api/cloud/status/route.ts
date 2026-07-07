import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { buildSignalMainFactContract } from '@/lib/life-domain/signal-main-fact-contract';
import { buildCloudSnapshotContract } from '@/lib/portal/cloud-snapshot-contract';
import { buildProductionRuntimeStatus } from '@/lib/portal/production-runtime';

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      cloudStatus: true,
      ...body,
    },
    { status },
  );
}

function buildProductDataBackendMatrix({
  databaseEnabled,
  storageEnabled,
  signedInCookiePresent,
}: {
  databaseEnabled: boolean;
  storageEnabled: boolean;
  signedInCookiePresent: boolean;
}) {
  const databaseBackendStatus = databaseEnabled ? 'cloud_ready' : 'cloud_optional';
  const storageBackendStatus = storageEnabled ? 'cloud_ready' : 'cloud_optional';

  return [
    {
      capabilityKey: 'accountProfile',
      label: 'Cloud account profile',
      endpoint: '/api/cloud/account',
      table: 'user_profiles',
      backendStatus: databaseBackendStatus,
      localFirst: false,
      cloudOptional: false,
      requiresCloudDatabase: true,
      requiresCloudStorage: false,
      supportsCloudRead: true,
      supportsCloudWrite: true,
      explicitUserActionRequired: false,
      signedInCookiePresent,
      anonymousAccess: 'fail_closed',
      realDataBoundary: 'signed_in_profile_only',
    },
    {
      capabilityKey: 'profileSettings',
      label: 'Profile settings',
      endpoint: '/api/cloud/profile-settings',
      table: 'profile_settings',
      backendStatus: databaseBackendStatus,
      localFirst: true,
      cloudOptional: true,
      requiresCloudDatabase: true,
      requiresCloudStorage: false,
      supportsCloudRead: true,
      supportsCloudWrite: true,
      explicitUserActionRequired: true,
      signedInCookiePresent,
      anonymousAccess: 'fail_closed',
      realDataBoundary: 'signed_in_settings_only',
    },
    {
      capabilityKey: 'memoryGraph',
      label: 'Memory / Life Graph',
      endpoint: '/api/cloud/memory',
      table: 'memory_nodes',
      backendStatus: databaseBackendStatus,
      localFirst: true,
      cloudOptional: true,
      requiresCloudDatabase: true,
      requiresCloudStorage: false,
      supportsCloudRead: true,
      supportsCloudWrite: true,
      explicitUserActionRequired: false,
      signedInCookiePresent,
      anonymousAccess: 'fail_closed',
      realDataBoundary: 'signed_in_memory_only',
    },
    {
      capabilityKey: 'assetStorage',
      label: 'Avatar / Memory assets',
      endpoint: '/api/cloud/assets',
      table: 'memory_assets',
      backendStatus: storageBackendStatus,
      localFirst: true,
      cloudOptional: true,
      requiresCloudDatabase: false,
      requiresCloudStorage: true,
      supportsCloudRead: true,
      supportsCloudWrite: true,
      explicitUserActionRequired: true,
      signedInCookiePresent,
      anonymousAccess: 'fail_closed',
      realDataBoundary: 'signed_in_identity_scoped_assets_only',
    },
    {
      capabilityKey: 'productEvents',
      label: 'Product feedback events',
      endpoint: '/api/cloud/events',
      table: 'product_events',
      backendStatus: databaseBackendStatus,
      localFirst: true,
      cloudOptional: true,
      requiresCloudDatabase: true,
      requiresCloudStorage: false,
      supportsCloudRead: true,
      supportsCloudWrite: true,
      explicitUserActionRequired: true,
      signedInCookiePresent,
      anonymousAccess: 'fail_closed',
      realDataBoundary: 'signed_in_product_events_only',
    },
    {
      capabilityKey: 'userDataExport',
      label: 'User data export',
      endpoint: '/api/user-data/export',
      table: 'memory_nodes',
      backendStatus: databaseBackendStatus,
      localFirst: true,
      cloudOptional: true,
      requiresCloudDatabase: true,
      requiresCloudStorage: false,
      supportsCloudRead: true,
      supportsCloudWrite: false,
      explicitUserActionRequired: true,
      signedInCookiePresent,
      anonymousAccess: 'local_contract_only',
      realDataBoundary: 'signed_in_export_only',
    },
    {
      capabilityKey: 'userDataDelete',
      label: 'User data delete',
      endpoint: '/api/user-data/delete',
      table: 'memory_nodes',
      backendStatus: databaseBackendStatus,
      localFirst: true,
      cloudOptional: true,
      requiresCloudDatabase: true,
      requiresCloudStorage: false,
      supportsCloudRead: true,
      supportsCloudWrite: true,
      explicitUserActionRequired: true,
      signedInCookiePresent,
      anonymousAccess: 'dry_run_contract_only',
      realDataBoundary: 'signed_in_explicit_confirmation_only',
    },
  ];
}

export async function GET(request: NextRequest) {
  const runtime = buildProductionRuntimeStatus(process.env, {
    requestHost: request.headers.get('x-forwarded-host') || request.headers.get('host'),
  });
  const cookieStore = await cookies();
  const accessCookiePresent = Boolean(cookieStore.get('baohe_auth_access')?.value);
  const refreshCookiePresent = Boolean(cookieStore.get('baohe_auth_refresh')?.value);
  const linkedProvider = cookieStore.get('baohe_auth_provider')?.value || '';

  const cloudDatabaseSetupTask = runtime.setupTaskMatrix.find((task) => task.id === 'cloud_database');
  const cloudStorageSetupTask = runtime.setupTaskMatrix.find((task) => task.id === 'cloud_storage');
  const signedInCookiePresent = accessCookiePresent || refreshCookiePresent || linkedProvider === 'wechat';

  return safeJson({
    ok: true,
    readsCloud: false,
    writesCloud: false,
    service: 'portal-cloud-status',
    version: 'cloud-status-v0',
    endpoints: {
      cloudAccountEndpoint: '/api/cloud/account',
      profileSettingsEndpoint: '/api/cloud/profile-settings',
      memoryEndpoint: '/api/cloud/memory',
      assetsEndpoint: '/api/cloud/assets',
      eventsEndpoint: '/api/cloud/events',
    },
    tables: {
      userProfiles: 'user_profiles',
      profileSettings: 'profile_settings',
      memoryNodes: 'memory_nodes',
      memoryEdges: 'memory_edges',
      memoryAssets: 'memory_assets',
      productEvents: 'product_events',
      signals: 'signals',
    },
    authSession: {
      accessCookiePresent,
      refreshCookiePresent,
      linkedProvider,
      canAttemptCloudRead: runtime.cloud.database.enabled && (accessCookiePresent || refreshCookiePresent || linkedProvider === 'wechat'),
    },
    cloud: {
      database: runtime.cloud.database,
      storage: runtime.cloud.storage,
    },
    assetStorage: {
      endpoint: '/api/cloud/assets',
      signedReadEndpoint: '/api/cloud/assets?storagePath=...',
      supportsUpload: true,
      supportsSignedRead: true,
      requiresSignedInUser: true,
      identityScopedStoragePath: true,
      bucketConfigured: runtime.cloud.storage.configured,
      enabled: runtime.cloud.storage.enabled,
      readsCloud: false,
      writesCloud: false,
    },
    productDataBackend: {
      version: 'product-data-backend-v1',
      readModelOnly: true,
      readsCloud: false,
      writesCloud: false,
      matrix: buildProductDataBackendMatrix({
        databaseEnabled: runtime.cloud.database.enabled,
        storageEnabled: runtime.cloud.storage.enabled,
        signedInCookiePresent,
      }),
    },
    cloudSnapshot: buildCloudSnapshotContract(),
    signalMainFactTable: buildSignalMainFactContract(),
    setupTasks: {
      database: cloudDatabaseSetupTask,
      storage: cloudStorageSetupTask,
    },
    setupTaskMatrix: runtime.setupTaskMatrix.filter((task) => task.category === 'cloud'),
    summary: {
      cloudDatabaseReady: runtime.cloud.database.enabled,
      cloudStorageReady: runtime.cloud.storage.enabled,
      signedInCookiePresent,
      canonicalDomainReady: runtime.summary.canonicalDomainReady,
      cloudBlockedReason: cloudDatabaseSetupTask?.blockedReason || null,
    },
  });
}
