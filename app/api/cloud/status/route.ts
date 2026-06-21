import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
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

export async function GET(request: NextRequest) {
  const runtime = buildProductionRuntimeStatus(process.env, {
    requestHost: request.headers.get('host'),
  });
  const cookieStore = cookies();
  const accessCookiePresent = Boolean(cookieStore.get('baohe_auth_access')?.value);
  const refreshCookiePresent = Boolean(cookieStore.get('baohe_auth_refresh')?.value);
  const linkedProvider = cookieStore.get('baohe_auth_provider')?.value || '';

  const cloudDatabaseSetupTask = runtime.setupTaskMatrix.find((task) => task.id === 'cloud_database');
  const cloudStorageSetupTask = runtime.setupTaskMatrix.find((task) => task.id === 'cloud_storage');

  return safeJson({
    ok: true,
    readsCloud: false,
    writesCloud: false,
    service: 'portal-cloud-status',
    version: 'cloud-status-v0',
    endpoints: {
      profileSettingsEndpoint: '/api/cloud/profile-settings',
      inventoryEndpoint: '/api/cloud/inventory',
    },
    tables: {
      profileSettings: 'profile_settings',
      inventoryItems: 'inventory_items',
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
    setupTasks: {
      database: cloudDatabaseSetupTask,
      storage: cloudStorageSetupTask,
    },
    setupTaskMatrix: runtime.setupTaskMatrix.filter((task) => task.category === 'cloud'),
    summary: {
      cloudDatabaseReady: runtime.cloud.database.enabled,
      cloudStorageReady: runtime.cloud.storage.enabled,
      signedInCookiePresent: accessCookiePresent || refreshCookiePresent || linkedProvider === 'wechat',
      canonicalDomainReady: runtime.summary.canonicalDomainReady,
      cloudBlockedReason: cloudDatabaseSetupTask?.blockedReason || null,
    },
  });
}
