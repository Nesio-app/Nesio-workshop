import { NextRequest, NextResponse } from 'next/server';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';
import * as cloudRuntime from '@/lib/portal/cloud-server-runtime';

/**
 * 记录级模块同步(根治「换端数据不显示」):健康/足迹/财务/物品 等本机模块**每个一行**存到
 * user_module_data 表(identity_key + module_key 主键,updated_at 定胜负),不再走整包备份大文件。
 * GET 拉本账号全部模块行;POST upsert 若干模块行。data 由客户端存 gz-base64 压缩块,服务端当不透明块存取。
 * 门禁 CLOUD_DB_ENABLED + 已登录;service-role 走 PostgREST,RLS 仅本人可读写(纵深防御)。
 */

const MAX_MODULES_PER_POST = 20;
const MAX_DATA_BYTES = 4 * 1024 * 1024; // 单模块压缩块上限(< Vercel 4.5MB 请求体上限)

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ safePublicStatus: true, secretsRedacted: true, ...body }, { status });
}

function auditId() {
  return cloudRuntime.createCloudRuntimeAuditId('cloud-module-data');
}
function logAudit(
  event: 'cloud_runtime_request' | 'cloud_runtime_success' | 'cloud_runtime_failure',
  payload: Record<string, string | number | boolean | null>,
) {
  cloudRuntime.logCloudRuntimeAudit(event, payload, { resource: 'cloud_module_data' });
}

function getConfig() {
  return cloudRuntime.getCloudConfig();
}

function sanitizeModuleKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // 模块 key 形如 nesio-health-v1 / local-image:xxx —— 收紧字符集,防注入/越界。
  if (!trimmed || trimmed.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(trimmed)) return null;
  return trimmed;
}

export async function GET() {
  const id = auditId();
  logAudit('cloud_runtime_request', { auditId: id, method: 'GET', readsCloud: true, writesCloud: false });
  const config = getConfig();
  if (!config.configured) {
    logAudit('cloud_runtime_failure', { auditId: id, method: 'GET', reason: 'cloud_not_configured' });
    return safeJson({ ok: false, error: 'cloud_not_configured', auditId: id, modules: [] }, 503);
  }
  const userSession = await cloudRuntime.getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) {
    logAudit('cloud_runtime_failure', { auditId: id, method: 'GET', reason: 'not_signed_in' });
    return safeJson({ ok: false, error: 'not_signed_in', auditId: id, modules: [] }, 401);
  }

  try {
    const url = new URL('/rest/v1/user_module_data', config.supabaseUrl);
    url.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
    url.searchParams.set('select', 'module_key,data,updated_at');
    const res = await fetch(url.toString(), {
      headers: cloudRuntime.serviceRoleRestHeaders(config),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`module-data select failed ${res.status}`);
    const rows = (await res.json()) as Array<{ module_key?: string; data?: unknown; updated_at?: string }>;
    const modules = rows
      .filter((r) => typeof r.module_key === 'string')
      .map((r) => ({ moduleKey: r.module_key as string, data: r.data ?? null, updatedAt: r.updated_at ?? null }));
    logAudit('cloud_runtime_success', { auditId: id, method: 'GET', readsCloud: true, writesCloud: false, moduleCount: modules.length });
    return cloudRuntime.setRefreshedAuthCookies(
      safeJson({ ok: true, auditId: id, readsCloud: true, writesCloud: false, modules }),
      userSession.refreshedSession,
    );
  } catch {
    logAudit('cloud_runtime_failure', { auditId: id, method: 'GET', reason: 'module_data_read_failed' });
    return cloudRuntime.setRefreshedAuthCookies(safeJson({ ok: false, error: 'module_data_read_failed', auditId: id, modules: [] }, 502), userSession.refreshedSession);
  }
}

export async function POST(request: NextRequest) {
  const id = auditId();
  logAudit('cloud_runtime_request', { auditId: id, method: 'POST', readsCloud: false, writesCloud: true });
  const config = getConfig();
  if (!config.configured) {
    logAudit('cloud_runtime_failure', { auditId: id, method: 'POST', reason: 'cloud_not_configured' });
    return safeJson({ ok: false, error: 'cloud_not_configured', auditId: id }, 503);
  }
  const userSession = await cloudRuntime.getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) {
    logAudit('cloud_runtime_failure', { auditId: id, method: 'POST', reason: 'not_signed_in' });
    return safeJson({ ok: false, error: 'not_signed_in', auditId: id }, 401);
  }

  let body: { modules?: unknown };
  try {
    body = (await request.json()) as { modules?: unknown };
  } catch {
    return safeJson({ ok: false, error: 'invalid_body', auditId: id }, 400);
  }
  const input = Array.isArray(body.modules) ? body.modules : [];
  const rows: Array<{ identity_key: string; user_id: string | null; module_key: string; data: unknown; updated_at: string }> = [];
  for (const raw of input.slice(0, MAX_MODULES_PER_POST)) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as { moduleKey?: unknown; data?: unknown; updatedAt?: unknown };
    const moduleKey = sanitizeModuleKey(rec.moduleKey);
    if (!moduleKey) continue;
    // data 应是压缩块对象;超限的整块拒收(客户端预检也会拦)。
    let dataBytes = 0;
    try { dataBytes = JSON.stringify(rec.data ?? null).length; } catch { continue; }
    if (dataBytes > MAX_DATA_BYTES) continue;
    const updatedAt = typeof rec.updatedAt === 'string' && rec.updatedAt ? rec.updatedAt : new Date().toISOString();
    rows.push({
      identity_key: cloudIdentity.identityKey,
      user_id: cloudIdentity.userId,
      module_key: moduleKey,
      data: rec.data ?? {},
      updated_at: updatedAt,
    });
  }
  if (!rows.length) return safeJson({ ok: false, error: 'empty_modules', auditId: id }, 400);

  try {
    const url = new URL('/rest/v1/user_module_data', config.supabaseUrl);
    url.searchParams.set('on_conflict', 'identity_key,module_key');
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: cloudRuntime.serviceRoleRestHeaders(config, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`module-data upsert failed ${res.status}`);
    logAudit('cloud_runtime_success', { auditId: id, method: 'POST', readsCloud: false, writesCloud: true, savedCount: rows.length });
    return cloudRuntime.setRefreshedAuthCookies(
      safeJson({ ok: true, auditId: id, readsCloud: false, writesCloud: true, savedCount: rows.length }),
      userSession.refreshedSession,
    );
  } catch {
    logAudit('cloud_runtime_failure', { auditId: id, method: 'POST', reason: 'module_data_write_failed' });
    return cloudRuntime.setRefreshedAuthCookies(safeJson({ ok: false, error: 'module_data_write_failed', auditId: id }, 502), userSession.refreshedSession);
  }
}
