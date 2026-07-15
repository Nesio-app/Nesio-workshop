import { NextRequest, NextResponse } from 'next/server';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';
import * as cloudRuntime from '@/lib/portal/cloud-server-runtime';

type ProfileSettings = {
  displayName?: string;
  avatarUrl?: string;
  avatarStoragePath?: string;
  locale?: string;
  displayLanguage?: string;
  coachStyle?: string;
  theme?: string;
  calendarUrl?: string;
  observationPushEnabled?: boolean;
  mirrorProfile?: string;
  // 批次199(P2 跨端银行):指向 cloud/assets 上「学习态 blob」(ranker 训练日志 + 偏好)的
  // 短指针,JSON 字符串 {"path","n","at"}。载荷本身在 assets(不受 2000 字上限),这里只存指针,
  // 让新设备按账号找到并回灌那份「被纠偏的 ranker + 学到的偏好」。
  learningRef?: string;
};

const allowedSettingsKeys = [
  'displayName',
  'avatarUrl',
  'avatarStoragePath',
  'locale',
  'displayLanguage',
  'coachStyle',
  'theme',
  'calendarUrl',
  'mirrorProfile',
  'observationPushEnabled',
] as const;

const stringSettingsKeys = [
  'displayName',
  'avatarUrl',
  'avatarStoragePath',
  'locale',
  'displayLanguage',
  'coachStyle',
  'theme',
  'calendarUrl',
  'mirrorProfile',
  'learningRef',
] as const;

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      ...body,
    },
    { status },
  );
}

function createCloudRuntimeAuditId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `cloud-runtime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logCloudRuntimeAudit(
  event: 'cloud_runtime_request' | 'cloud_runtime_success' | 'cloud_runtime_failure',
  payload: Record<string, string | number | boolean | null>,
) {
  const safePayload = {
    resource: 'profile_settings',
    ...payload,
  };
  if (event === 'cloud_runtime_failure') {
    console.warn(event, safePayload);
    return;
  }
  console.info(event, safePayload);
}

function getCloudConfig() {
  return cloudRuntime.getCloudConfig();
}

function getCloudDatabaseSetupTask(request?: NextRequest) {
  return cloudRuntime.getCloudDatabaseSetupTask(request);
}

function sanitizeSettings(input: unknown): ProfileSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const output: ProfileSettings = {};

  for (const key of stringSettingsKeys) {
    const value = raw[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 2000) continue;
    output[key] = trimmed;
  }
  if (typeof raw.observationPushEnabled === 'boolean') {
    output.observationPushEnabled = raw.observationPushEnabled;
  }

  return output;
}

type CloudUserSession = Awaited<ReturnType<typeof cloudRuntime.getSignedInUser>>;

function setRefreshedAuthCookies(response: NextResponse, session?: CloudUserSession['refreshedSession']) {
  return cloudRuntime.setRefreshedAuthCookies(response, session);
}

async function getSignedInUser(config: ReturnType<typeof getCloudConfig>) {
  return cloudRuntime.getSignedInUser(config);
}

function restHeaders(config: ReturnType<typeof getCloudConfig>) {
  return cloudRuntime.serviceRoleRestHeaders(config);
}

export async function GET(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', { auditId, method: 'GET', readsCloud: true, writesCloud: false });
  const config = getCloudConfig();
  if (!config.configured) {
    const setupTask = getCloudDatabaseSetupTask(request);
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'cloud_not_configured' });
    return safeJson(
      {
        ok: false,
        error: 'cloud_not_configured',
        auditId,
        setupTask,
        readsCloud: false,
        writesCloud: false,
      },
      503,
    );
  }

  const userSession = await getSignedInUser(config);
  const user = userSession.user;
  const cloudIdentity = deriveCloudIdentity(user);
  if (!cloudIdentity) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'not_signed_in' });
    return safeJson(
      {
        ok: false,
        error: 'not_signed_in',
        auditId,
        readsCloud: false,
        writesCloud: false,
      },
      401,
    );
  }

  try {
    const url = new URL('/rest/v1/profile_settings', config.supabaseUrl);
    url.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
    url.searchParams.set('select', 'settings,updated_at');
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString(), {
      headers: restHeaders(config),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase REST read failed: ${response.status}`);
    const rows = (await response.json()) as Array<{ settings?: unknown; updated_at?: string }>;
    const row = rows[0];

    logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'GET', readsCloud: true, writesCloud: false });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      auditId,
      readsCloud: true,
      writesCloud: false,
      settings: sanitizeSettings(row?.settings),
      updatedAt: row?.updated_at || null,
    }), userSession.refreshedSession);
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'cloud_read_failed' });
    return safeJson(
      {
        ok: false,
        error: 'cloud_read_failed',
        auditId,
        readsCloud: false,
        writesCloud: false,
      },
      502,
    );
  }
}

export async function POST(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', { auditId, method: 'POST', readsCloud: false, writesCloud: true });
  const config = getCloudConfig();
  if (!config.configured) {
    const setupTask = getCloudDatabaseSetupTask(request);
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'cloud_not_configured' });
    return safeJson(
      {
        ok: false,
        error: 'cloud_not_configured',
        auditId,
        setupTask,
        readsCloud: false,
        writesCloud: false,
      },
      503,
    );
  }

  const userSession = await getSignedInUser(config);
  const user = userSession.user;
  const cloudIdentity = deriveCloudIdentity(user);
  if (!cloudIdentity) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'not_signed_in' });
    return safeJson(
      {
        ok: false,
        error: 'not_signed_in',
        auditId,
        readsCloud: false,
        writesCloud: false,
      },
      401,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const settings = sanitizeSettings((body as { settings?: unknown })?.settings || body);
  const updatedAt = new Date().toISOString();

  try {
    const url = new URL('/rest/v1/profile_settings', config.supabaseUrl);
    url.searchParams.set('on_conflict', 'user_id');
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        ...restHeaders(config),
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        identity_key: cloudIdentity.identityKey,
        user_id: cloudIdentity.userId,
        settings,
        updated_at: updatedAt,
      }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase REST write failed: ${response.status}`);
    const rows = (await response.json()) as Array<{ settings?: unknown; updated_at?: string }>;
    const row = rows[0];

    logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'POST', readsCloud: false, writesCloud: true });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      auditId,
      readsCloud: false,
      writesCloud: true,
      settings: sanitizeSettings(row?.settings || settings),
      updatedAt: row?.updated_at || updatedAt,
    }), userSession.refreshedSession);
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'cloud_write_failed' });
    return safeJson(
      {
        ok: false,
        error: 'cloud_write_failed',
        auditId,
        readsCloud: false,
        writesCloud: false,
      },
      502,
    );
  }
}
