/**
 * Tesla Fleet API client (server-only) — OAuth + read-only Vehicle Info & Charging.
 *
 * Nesio is read-only. We request `vehicle_device_data` (Vehicle Information /
 * live drive+charge state) + `vehicle_charging_cmds` (charging *history*,
 * including billed amount) — and never call the command endpoints. Read
 * access does NOT need a virtual key or command signing; that is only
 * required to send commands to a vehicle, which we deliberately do not do.
 *
 * Region: defaults to North America / Asia-Pacific. For EU override
 * TESLA_FLEET_API_BASE / TESLA_TOKEN_URL via env.
 *
 * Env:
 *   TESLA_CLIENT_ID / TESLA_CLIENT_SECRET   — from developer.tesla.com
 *   TESLA_REDIRECT_URI                       — https://www.nesio.app/api/portal/tesla/callback
 *   TESLA_PUBLIC_KEY                         — served at /.well-known/... (partner registration)
 *   TESLA_PRIVATE_KEY                        — only needed if we ever send commands (we don't)
 *   TESLA_AUTH_URL / TESLA_TOKEN_URL / TESLA_FLEET_API_BASE / TESLA_AUDIENCE — optional overrides
 */

function envValue(key: string): string {
  const v = process.env[key];
  return typeof v === 'string' ? v.trim() : '';
}

// User-facing login screen (auth.tesla.com hosts the sign-in UI).
export const TESLA_AUTH_URL = envValue('TESLA_AUTH_URL') || 'https://auth.tesla.com/oauth2/v3/authorize';
// Token exchange / refresh / partner (client_credentials) tokens.
export const TESLA_TOKEN_URL = envValue('TESLA_TOKEN_URL') || 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token';
// Regional Fleet API base — NA/APAC default; EU: fleet-api.prd.eu.vn.cloud.tesla.com
export const TESLA_FLEET_BASE = envValue('TESLA_FLEET_API_BASE') || 'https://fleet-api.prd.na.vn.cloud.tesla.com';
// Audience for partner/client tokens = the fleet API base.
export const TESLA_AUDIENCE = envValue('TESLA_AUDIENCE') || TESLA_FLEET_BASE;

// Read-only scopes chosen with the user: Vehicle Information + Charging Management.
// openid + offline_access are required to receive a refresh token.
export const TESLA_SCOPES = 'openid offline_access vehicle_device_data vehicle_charging_cmds';

export function teslaConfigured(): boolean {
  return Boolean(envValue('TESLA_CLIENT_ID') && envValue('TESLA_CLIENT_SECRET'));
}

// ── Tokens ───────────────────────────────────────────────────────────────────

export interface TeslaTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

interface TeslaTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

function toTokens(r: TeslaTokenResponse): TeslaTokens | null {
  if (!r.access_token) return null;
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : undefined,
    scope: r.scope,
  };
}

export async function exchangeTeslaCode(code: string, redirectUri: string): Promise<TeslaTokens | null> {
  const clientId = envValue('TESLA_CLIENT_ID');
  const clientSecret = envValue('TESLA_CLIENT_SECRET');
  if (!clientId || !clientSecret || !code) return null;
  try {
    const res = await fetch(TESLA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        audience: TESLA_AUDIENCE,
      }),
      cache: 'no-store',
    });
    if (!res.ok) { console.warn('tesla_token_exchange_failed', { status: res.status }); return null; }
    return toTokens(await res.json() as TeslaTokenResponse);
  } catch (e) { console.warn('tesla_token_exchange_error', { message: String(e) }); return null; }
}

export async function refreshTeslaToken(refreshToken: string): Promise<TeslaTokens | null> {
  const clientId = envValue('TESLA_CLIENT_ID');
  if (!clientId || !refreshToken) return null;
  try {
    const res = await fetch(TESLA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
      }),
      cache: 'no-store',
    });
    if (!res.ok) { console.warn('tesla_token_refresh_failed', { status: res.status }); return null; }
    const tokens = toTokens(await res.json() as TeslaTokenResponse);
    // Tesla may omit a fresh refresh token on rotation — keep the old one.
    if (tokens && !tokens.refreshToken) tokens.refreshToken = refreshToken;
    return tokens;
  } catch (e) { console.warn('tesla_token_refresh_error', { message: String(e) }); return null; }
}

/** Best-effort revoke at Tesla (Notion/Google-style disconnect闭环). */
export async function revokeTeslaToken(token: string): Promise<boolean> {
  const clientId = envValue('TESLA_CLIENT_ID');
  if (!clientId || !token) return false;
  try {
    const res = await fetch('https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, token }),
      cache: 'no-store',
    });
    return res.ok;
  } catch { return false; }
}

// ── Partner (one-time onboarding) ────────────────────────────────────────────

async function getPartnerToken(): Promise<string | null> {
  const clientId = envValue('TESLA_CLIENT_ID');
  const clientSecret = envValue('TESLA_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch(TESLA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: TESLA_SCOPES,
        audience: TESLA_AUDIENCE,
      }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json() as TeslaTokenResponse;
    return data.access_token || null;
  } catch { return null; }
}

/**
 * One-time: register this partner (domain) so the hosted public key is
 * associated with the app. Idempotent — safe to call repeatedly. The domain
 * must serve the public key at /.well-known/appspecific/com.tesla.3p.public-key.pem.
 */
export async function registerPartnerAccount(domain: string): Promise<boolean> {
  const token = await getPartnerToken();
  if (!token) return false;
  try {
    const res = await fetch(`${TESLA_FLEET_BASE}/api/1/partner_accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
      cache: 'no-store',
    });
    return res.ok;
  } catch { return false; }
}

// ── Data (read-only) ─────────────────────────────────────────────────────────

export interface TeslaDrive {
  vehicleId: string;
  displayName?: string;
  at: string;
  shiftState?: string;
  speedMph?: number | null;
  odometerMi?: number | null;
  // drive_state 本来就返回经纬度;之前丢了,足迹时间线拿不到位置。只读快照 = 同步时的
  // 采样点(非连续轨迹),但配上充电站点已足够把「今天车去过哪」画进足迹。
  latitude?: number | null;
  longitude?: number | null;
}

export interface TeslaCharge {
  vehicleId: string;
  displayName?: string;
  at: string;
  batteryLevel?: number | null;
  chargingState?: string;
  costUsd?: number | null;
  energyAddedKwh?: number | null;
  location?: string;
}

interface TeslaGetResult { status: number; data: unknown }

async function teslaGet(path: string, accessToken: string): Promise<TeslaGetResult> {
  try {
    const res = await fetch(`${TESLA_FLEET_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, data };
  } catch { return { status: 0, data: null }; }
}

type VehicleRow = { id?: string | number; id_s?: string; display_name?: string; vin?: string };

/**
 * Collect a read-only snapshot: latest drive/charge state per vehicle + recent
 * charging history (with billed cost). Returns status 401 so the caller can
 * refresh the token and retry.
 */
export async function collectTeslaData(accessToken: string): Promise<{ status: number; drives: TeslaDrive[]; charges: TeslaCharge[] }> {
  const vehiclesRes = await teslaGet('/api/1/vehicles', accessToken);
  if (vehiclesRes.status === 401) return { status: 401, drives: [], charges: [] };
  const vehicles = ((vehiclesRes.data as { response?: VehicleRow[] })?.response) || [];

  const drives: TeslaDrive[] = [];
  const charges: TeslaCharge[] = [];

  for (const v of vehicles) {
    const vehicleId = String(v.id_s || v.id || '');
    if (!vehicleId) continue;
    const displayName = v.display_name || undefined;

    // Live drive + charge state. Uses vehicle_device_data scope. vehicle_state 带上
    // 是为了拿 odometer(在 vehicle_state 里,不在 drive_state)——不然里程永远是 null。
    const vd = await teslaGet(`/api/1/vehicles/${vehicleId}/vehicle_data?endpoints=${encodeURIComponent('drive_state;charge_state;vehicle_state')}`, accessToken);
    if (vd.status === 401) return { status: 401, drives, charges };
    const resp = (vd.data as { response?: { drive_state?: Record<string, unknown>; charge_state?: Record<string, unknown>; vehicle_state?: Record<string, unknown> } })?.response;
    const ds = resp?.drive_state;
    const cs = resp?.charge_state;
    const vs = resp?.vehicle_state;
    const at = new Date().toISOString();

    if (ds) {
      drives.push({
        vehicleId,
        displayName,
        at,
        shiftState: (ds.shift_state as string) || undefined,
        speedMph: (ds.speed as number | null) ?? null,
        odometerMi: (vs?.odometer as number | null) ?? null,
        latitude: (ds.latitude as number | null) ?? null,
        longitude: (ds.longitude as number | null) ?? null,
      });
    }
    if (cs) {
      charges.push({
        vehicleId,
        displayName,
        at,
        batteryLevel: (cs.battery_level as number | null) ?? null,
        chargingState: (cs.charging_state as string) || undefined,
        energyAddedKwh: (cs.charge_energy_added as number | null) ?? null,
        costUsd: null,
      });
    }
  }

  // Charging history (billed amount). Schema mapped defensively — Tesla returns
  // session rows under response.data; field names have shifted over versions,
  // so keep this tolerant and adjust against live output.
  const hist = await teslaGet('/api/1/dx/charging/history', accessToken);
  if (hist.status === 401) return { status: 401, drives, charges };
  const sessions = ((hist.data as { response?: { data?: unknown[] } })?.response?.data) || [];
  for (const raw of sessions as Array<Record<string, unknown>>) {
    const fees = (raw.fees as Array<Record<string, unknown>>) || [];
    const totalDue = fees.reduce((sum, f) => sum + (typeof f.totalDue === 'number' ? f.totalDue as number : 0), 0);
    const at = (raw.chargeStartDateTime as string) || (raw.unlatchDateTime as string) || new Date().toISOString();
    charges.push({
      vehicleId: String(raw.vin || 'history'),
      at: new Date(at).toISOString(),
      costUsd: totalDue > 0 ? totalDue : null,
      energyAddedKwh: (raw.energyAddedInKwh as number | null) ?? null,
      location: (raw.siteLocationName as string) || '',
    });
  }

  return { status: 200, drives, charges };
}
