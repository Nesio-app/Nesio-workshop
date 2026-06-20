import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

type SupabaseUserResponse = {
  id?: string;
  email?: string;
  phone?: string;
};

type CloudInventoryItem = {
  id: string;
  schemaVersion: 'LocalInventoryItem@v1';
  name: string;
  category?: string;
  locationHint?: string;
  notes?: string;
  purchaseMemory?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  mode: 'personal';
};

const LOCAL_INVENTORY_ITEM_SCHEMA_VERSION = 'LocalInventoryItem@v1';

const allowedInventoryItemKeys = [
  'id',
  'schemaVersion',
  'name',
  'category',
  'locationHint',
  'notes',
  'purchaseMemory',
  'createdAt',
  'updatedAt',
  'mode',
] as const;

const allowedPurchaseMemoryKeys = ['purchasedAt', 'reason', 'worthIt', 'memoryNote'] as const;
const forbiddenPurchaseMemoryKeys = [
  'paymentMethod',
  'receiptImport',
  'bankAccount',
  'cardLast4',
  'financialAdvice',
  'merchantAuthorization',
  'budgetRecommendation',
  'creditScore',
] as const;

function envValue(key: string): string {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      cloudInventorySnapshot: true,
      ...body,
    },
    { status },
  );
}

function getCloudConfig() {
  const enabled = envValue('CLOUD_DB_ENABLED').toLowerCase() === 'true';
  const supabaseUrl = envValue('SUPABASE_URL');
  const anonKey = envValue('SUPABASE_ANON_KEY');
  const serviceRoleKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  const configured = enabled && Boolean(supabaseUrl && anonKey && serviceRoleKey);

  return {
    configured,
    enabled,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
  };
}

async function getSignedInUser(config: ReturnType<typeof getCloudConfig>): Promise<SupabaseUserResponse | null> {
  const accessToken = cookies().get('baohe_auth_access')?.value || '';
  if (!accessToken) return null;

  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) return null;
  return response.json() as Promise<SupabaseUserResponse>;
}

function restHeaders(config: ReturnType<typeof getCloudConfig>) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
    accept: 'application/json',
  };
}

function sanitizeString(value: unknown, maxLength = 4000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function sanitizePurchaseMemory(input: unknown): Record<string, string> | null | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;

  for (const key of forbiddenPurchaseMemoryKeys) {
    if (raw[key] !== undefined) return null;
  }

  const output: Record<string, string> = {};
  for (const key of allowedPurchaseMemoryKeys) {
    const value = sanitizeString(raw[key], 1000);
    if (value) output[key] = value;
  }
  return output;
}

function sanitizeInventoryItem(input: unknown): CloudInventoryItem | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<(typeof allowedInventoryItemKeys)[number] | string, unknown>;

  const id = sanitizeString(raw.id, 200);
  const name = sanitizeString(raw.name, 400);
  const mode = sanitizeString(raw.mode, 80);
  if (!id || !name || mode !== 'personal') return null;

  const schemaVersion = sanitizeString(raw.schemaVersion, 80);
  if (schemaVersion && schemaVersion !== LOCAL_INVENTORY_ITEM_SCHEMA_VERSION) return null;

  const purchaseMemory = sanitizePurchaseMemory(raw.purchaseMemory);
  if (purchaseMemory === null) return null;

  const item: CloudInventoryItem = {
    id,
    schemaVersion: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
    name,
    mode: 'personal',
  };

  for (const key of ['category', 'locationHint', 'notes', 'createdAt', 'updatedAt'] as const) {
    const value = sanitizeString(raw[key]);
    if (value) item[key] = value;
  }
  if (purchaseMemory && Object.keys(purchaseMemory).length > 0) item.purchaseMemory = purchaseMemory;

  return item;
}

function sanitizeInventoryItems(input: unknown): { items: CloudInventoryItem[]; rejectedCount: number } {
  const rawItems = Array.isArray(input) ? input : [];
  const items: CloudInventoryItem[] = [];
  let rejectedCount = 0;

  for (const rawItem of rawItems) {
    const item = sanitizeInventoryItem(rawItem);
    if (item) {
      items.push(item);
    } else {
      rejectedCount += 1;
    }
  }

  return { items, rejectedCount };
}

async function readExistingLocalIds(config: ReturnType<typeof getCloudConfig>, userId: string): Promise<string[]> {
  const url = new URL('/rest/v1/inventory_items', config.supabaseUrl);
  url.searchParams.set('user_id', `eq.${userId}`);
  url.searchParams.set('deleted_at', 'is.null');
  url.searchParams.set('select', 'local_id');

  const response = await fetch(url.toString(), {
    headers: restHeaders(config),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Supabase REST existing inventory read failed: ${response.status}`);
  const rows = (await response.json()) as Array<{ local_id?: string }>;
  return rows.map((row) => row.local_id).filter((value): value is string => Boolean(value));
}

export async function GET() {
  const config = getCloudConfig();
  if (!config.configured) {
    return safeJson(
      {
        ok: false,
        error: 'cloud_not_configured',
        readsCloud: false,
        writesCloud: false,
      },
      503,
    );
  }

  const user = await getSignedInUser(config);
  if (!user?.id) {
    return safeJson(
      {
        ok: false,
        error: 'not_signed_in',
        readsCloud: false,
        writesCloud: false,
      },
      401,
    );
  }

  try {
    const url = new URL('/rest/v1/inventory_items', config.supabaseUrl);
    url.searchParams.set('user_id', `eq.${user.id}`);
    url.searchParams.set('deleted_at', 'is.null');
    url.searchParams.set('select', 'local_id,item,updated_at');
    url.searchParams.set('order', 'updated_at.desc');

    const response = await fetch(url.toString(), {
      headers: restHeaders(config),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase REST inventory read failed: ${response.status}`);
    const rows = (await response.json()) as Array<{ item?: unknown; updated_at?: string }>;
    const items = rows.map((row) => sanitizeInventoryItem(row.item)).filter((item): item is CloudInventoryItem => Boolean(item));

    return safeJson({
      ok: true,
      readsCloud: true,
      writesCloud: false,
      items,
      itemCount: items.length,
      updatedAt: rows[0]?.updated_at || null,
    });
  } catch {
    return safeJson(
      {
        ok: false,
        error: 'cloud_read_failed',
        readsCloud: false,
        writesCloud: false,
      },
      502,
    );
  }
}

export async function POST(request: NextRequest) {
  const config = getCloudConfig();
  if (!config.configured) {
    return safeJson(
      {
        ok: false,
        error: 'cloud_not_configured',
        readsCloud: false,
        writesCloud: false,
      },
      503,
    );
  }

  const user = await getSignedInUser(config);
  if (!user?.id) {
    return safeJson(
      {
        ok: false,
        error: 'not_signed_in',
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
    return safeJson(
      {
        ok: false,
        error: 'invalid_json',
        readsCloud: false,
        writesCloud: false,
      },
      400,
    );
  }

  const rawBody = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const { items, rejectedCount } = sanitizeInventoryItems(rawBody.items);
  const updatedAt = new Date().toISOString();

  try {
    if (items.length > 0) {
      const url = new URL('/rest/v1/inventory_items', config.supabaseUrl);
      url.searchParams.set('on_conflict', 'user_id,local_id');
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          ...restHeaders(config),
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(
          items.map((item) => ({
            user_id: user.id,
            local_id: item.id,
            schema_version: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
            item: {
              ...item,
              updatedAt: item.updatedAt || updatedAt,
            },
            updated_at: item.updatedAt || updatedAt,
            deleted_at: null,
          })),
        ),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Supabase REST inventory write failed: ${response.status}`);
    }

    let deletedMissingCount = 0;
    if (rawBody.deleteMissing === true) {
      const existingLocalIds = await readExistingLocalIds(config, user.id);
      const keptLocalIds = new Set(items.map((item) => item.id));
      const missingLocalIds = existingLocalIds.filter((localId) => !keptLocalIds.has(localId));
      for (const localId of missingLocalIds) {
        const url = new URL('/rest/v1/inventory_items', config.supabaseUrl);
        url.searchParams.set('user_id', `eq.${user.id}`);
        url.searchParams.set('local_id', `eq.${localId}`);
        const response = await fetch(url.toString(), {
          method: 'PATCH',
          headers: restHeaders(config),
          body: JSON.stringify({
            updated_at: updatedAt,
            deleted_at: updatedAt,
          }),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Supabase REST inventory delete-missing failed: ${response.status}`);
      }
      deletedMissingCount = missingLocalIds.length;
    }

    return safeJson({
      ok: true,
      readsCloud: rawBody.deleteMissing === true,
      writesCloud: true,
      savedCount: items.length,
      rejectedCount,
      deletedMissingCount,
      updatedAt,
    });
  } catch {
    return safeJson(
      {
        ok: false,
        error: 'cloud_write_failed',
        readsCloud: false,
        writesCloud: false,
      },
      502,
    );
  }
}
