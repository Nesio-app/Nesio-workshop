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

// Read-only scopes chosen with the user: Vehicle Information + Location + Charging.
// openid + offline_access are required to receive a refresh token.
// vehicle_location 是**独立**权限:没有它,drive_state 的经纬度一律返回 null ——
// 停车/充电位置进不了足迹(用户实锤「地址页没有」的根因)。加上后需重新授权一次生效。
// energy_device_data:用户的授权页里「Energy Product Information」本来就是勾上的,
// 可 scope 串里一直没有它 —— 于是家里那套能源产品(太阳能 / Powerwall)的数据
// 一次都没取过。用户原话:「特斯拉的 API 是有能源,位置 API 的,目前一直未实现」。
// 加上之后需要**重新授权一次**才生效(scope 是发 token 时定死的)。
export const TESLA_SCOPES = 'openid offline_access vehicle_device_data vehicle_location vehicle_charging_cmds energy_device_data';

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
  /**
   * 车上那份数据的时间戳(毫秒)。**和 `at` 不是一回事**:`at` 是我们问它的时刻,
   * 这个是车最后一次上报的时刻。车深度休眠时两者能差几个小时 ——
   * 不分开的话界面会把一份几小时前的读数说成「刚刚」。
   */
  dataAgeMs?: number | null;
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
  /** kW,正在充多少。0/null = 没在充。 */
  chargerPowerKw?: number | null;
  /** 估算续航(英里)。电量百分比回答不了「还能开多远」。 */
  rangeMi?: number | null;
  /** 充满还要多少分钟。0 = 不在充或已满。 */
  minutesToFull?: number | null;
  /** 充电上限(%)。80% 上限时「44%」的含义和 100% 上限时不一样。 */
  chargeLimitPct?: number | null;
}

/**
 * 车况:图 4 那张「Vehicle Health」在单车上的对应物。
 *
 * 原图是**车队**看板(79 辆车的告警分布),一辆车没有「分布」——
 * 硬套会做出一个 100% 单色的环形图,那是装饰不是信息。
 * 单车上真正拿得到、也真正有人关心的是这几样:胎压、有没有待装的软件更新、
 * 锁没锁、哨兵模式开着没有。
 */
export interface TeslaHealth {
  vehicleId: string;
  at: string;
  /** psi。四个轮胎,取不到就 null。 */
  tirePsi?: { fl: number | null; fr: number | null; rl: number | null; rr: number | null };
  /** 有任何一个轮胎报了低压警告。 */
  tireSoftWarning?: boolean;
  /** 待装的软件更新版本;空 = 没有。 */
  softwareUpdate?: string;
  /** 当前车机版本。 */
  carVersion?: string;
  locked?: boolean | null;
  sentryMode?: boolean | null;
  insideTempC?: number | null;
  outsideTempC?: number | null;
}

/** 能源产品(太阳能 / Powerwall)的**此刻**:功率流向 + 电池电量。 */
export interface TeslaEnergyLive {
  siteId: string;
  siteName?: string;
  at: string;
  /** kW。太阳能发了多少。 */
  solarKw?: number | null;
  /** kW。家里在用多少。 */
  loadKw?: number | null;
  /** kW。正 = 从电网买,负 = 往电网卖。 */
  gridKw?: number | null;
  /** kW。正 = 电池在放电,负 = 在充电。 */
  batteryKw?: number | null;
  /** %。家用电池剩多少。 */
  batteryPct?: number | null;
}

/** 能源产品的**这些天**:按天的进出电量(kWh)。 */
export interface TeslaEnergyDay {
  siteId: string;
  /** YYYY-MM-DD(本地日,Tesla 按站点时区给) */
  date: string;
  solarKwh?: number | null;
  fromGridKwh?: number | null;
  toGridKwh?: number | null;
  homeKwh?: number | null;
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

async function teslaPost(path: string, accessToken: string): Promise<TeslaGetResult> {
  try {
    const res = await fetch(`${TESLA_FLEET_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, data };
  } catch { return { status: 0, data: null }; }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * drive_state 坐标:优先 latitude/longitude,空则退 native_*。
 * 0 当作缺(Tesla 无权限时常填 0,不是真在几内亚湾)。
 */
export function pickTeslaCoords(ds: Record<string, unknown> | null | undefined): { lat: number | null; lon: number | null } {
  if (!ds) return { lat: null, lon: null };
  const one = (v: unknown): number | null => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return null;
    return v;
  };
  const lat = one(ds.latitude) ?? one(ds.native_latitude);
  const lon = one(ds.longitude) ?? one(ds.native_longitude);
  return { lat, lon };
}

/** 休眠车唤醒后再读(位置字段休眠时常被抹成 null)。最多等 ~12s,失败不抛。 */
async function wakeVehicleIfNeeded(vehicleId: string, accessToken: string, state: string | undefined): Promise<boolean> {
  if (state === 'online') return false;
  const w = await teslaPost(`/api/1/vehicles/${vehicleId}/wake_up`, accessToken);
  if (w.status === 401) return false;
  for (let i = 0; i < 6; i++) {
    await sleep(2_000);
    const list = await teslaGet('/api/1/vehicles', accessToken);
    if (list.status === 401) return false;
    const rows = ((list.data as { response?: Array<{ id_s?: string; id?: string | number; state?: string }> })?.response) || [];
    const row = rows.find((r) => String(r.id_s || r.id || '') === vehicleId);
    if (row?.state === 'online') return true;
  }
  return false;
}

type VehicleRow = { id?: string | number; id_s?: string; display_name?: string; vin?: string; state?: string };

export type TeslaLocationHint = 'ok' | 'scope' | 'asleep' | 'unknown';

/**
 * Collect a read-only snapshot: latest drive/charge state per vehicle + recent
 * charging history (with billed cost). Returns status 401 so the caller can
 * refresh the token and retry.
 *
 * `locationHint`:有车有电却没坐标时的原因猜测 —— UI 不许一律说「没授权」。
 * `tokenScope`:OAuth 发 token 时的 scope 串(可能为空=老记录没存)。
 */
export async function collectTeslaData(
  accessToken: string,
  opts?: { tokenScope?: string },
): Promise<{
  status: number;
  drives: TeslaDrive[];
  charges: TeslaCharge[];
  health: TeslaHealth[];
  vehiclesStatus?: number;
  locationHint?: TeslaLocationHint;
}> {
  const vehiclesRes = await teslaGet('/api/1/vehicles', accessToken);
  if (vehiclesRes.status === 401) return { status: 401, drives: [], charges: [], health: [] };
  // 412 = 合作方域名未注册(Fleet API 前置条件)。以前被静默当成「没有车」,
  // UI 只能显示空态 —— 把状态带出去,路由侧可就地补注册并重试。
  if (vehiclesRes.status !== 200) {
    return { status: 200, drives: [], charges: [], health: [], vehiclesStatus: vehiclesRes.status };
  }
  const vehicles = ((vehiclesRes.data as { response?: VehicleRow[] })?.response) || [];

  const drives: TeslaDrive[] = [];
  const charges: TeslaCharge[] = [];
  const health: TeslaHealth[] = [];
  let sawAsleep = false;

  for (const v of vehicles) {
    const vehicleId = String(v.id_s || v.id || '');
    if (!vehicleId) continue;
    const displayName = v.display_name || undefined;
    if (v.state === 'asleep' || v.state === 'offline') sawAsleep = true;

    // Live drive + charge state. Uses vehicle_device_data scope. vehicle_state 带上
    // 是为了拿 odometer(在 vehicle_state 里,不在 drive_state)——不然里程永远是 null。
    // climate_state 是 2026-08-01 加的:车内/车外温度。同一次请求里带上,不多一趟往返。
    let vd = await teslaGet(`/api/1/vehicles/${vehicleId}/vehicle_data?endpoints=${encodeURIComponent('drive_state;charge_state;vehicle_state;climate_state')}`, accessToken);
    if (vd.status === 401) return { status: 401, drives, charges, health };
    // 408/请求空 + 车在睡 → 唤醒再读一次(位置字段休眠时常被抹掉,电量却还能从缓存出)
    let resp = (vd.data as { response?: { drive_state?: Record<string, unknown>; charge_state?: Record<string, unknown>; vehicle_state?: Record<string, unknown>; climate_state?: Record<string, unknown> } })?.response;
    let coords = pickTeslaCoords(resp?.drive_state);
    if (coords.lat == null && (v.state !== 'online' || vd.status === 408 || !resp)) {
      const woke = await wakeVehicleIfNeeded(vehicleId, accessToken, v.state);
      if (woke || v.state !== 'online') {
        vd = await teslaGet(`/api/1/vehicles/${vehicleId}/vehicle_data?endpoints=${encodeURIComponent('drive_state;charge_state;vehicle_state;climate_state')}`, accessToken);
        if (vd.status === 401) return { status: 401, drives, charges, health };
        resp = (vd.data as { response?: { drive_state?: Record<string, unknown>; charge_state?: Record<string, unknown>; vehicle_state?: Record<string, unknown>; climate_state?: Record<string, unknown> } })?.response;
        coords = pickTeslaCoords(resp?.drive_state);
      }
    }
    const ds = resp?.drive_state;
    const cs = resp?.charge_state;
    const vs = resp?.vehicle_state;
    const cl = resp?.climate_state;
    const at = new Date().toISOString();

    if (ds) {
      drives.push({
        vehicleId,
        displayName,
        at,
        shiftState: (ds.shift_state as string) || undefined,
        speedMph: (ds.speed as number | null) ?? null,
        odometerMi: (vs?.odometer as number | null) ?? null,
        latitude: coords.lat,
        longitude: coords.lon,
        // drive_state.timestamp 是**车上**那份读数的时刻(毫秒)。深度休眠时它可能是
        // 几小时前的 —— 界面必须能说出「这是 3 小时前的读数」,而不是把它当成此刻。
        dataAgeMs: typeof ds.timestamp === 'number' ? (ds.timestamp as number) : null,
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
        chargerPowerKw: (cs.charger_power as number | null) ?? null,
        // est_battery_range 是按最近开法估的,比 battery_range(理论值)更贴实际;
        // 取不到才退回理论值。
        rangeMi: (cs.est_battery_range as number | null) ?? (cs.battery_range as number | null) ?? null,
        minutesToFull: (cs.minutes_to_full_charge as number | null) ?? null,
        chargeLimitPct: (cs.charge_limit_soc as number | null) ?? null,
      });
    }
    if (vs || cl) {
      const su = (vs?.software_update as Record<string, unknown> | undefined) || {};
      const psi = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v * 14.5038 * 10) / 10 : null);  // bar → psi
      health.push({
        vehicleId,
        at,
        tirePsi: {
          fl: psi(vs?.tpms_pressure_fl), fr: psi(vs?.tpms_pressure_fr),
          rl: psi(vs?.tpms_pressure_rl), rr: psi(vs?.tpms_pressure_rr),
        },
        tireSoftWarning: Boolean(
          vs?.tpms_soft_warning_fl || vs?.tpms_soft_warning_fr
          || vs?.tpms_soft_warning_rl || vs?.tpms_soft_warning_rr,
        ),
        // status 为 'available'/'downloading'/'installing' 时才算「有待装的更新」;
        // 空字符串是常态(没有更新),不该显示成一条告警。
        softwareUpdate: su.status && su.status !== '' ? String(su.version || su.status) : '',
        carVersion: vs?.car_version ? String(vs.car_version).split(' ')[0] : '',
        locked: (vs?.locked as boolean | null) ?? null,
        sentryMode: (vs?.sentry_mode as boolean | null) ?? null,
        insideTempC: (cl?.inside_temp as number | null) ?? null,
        outsideTempC: (cl?.outside_temp as number | null) ?? null,
      });
    }
  }

  // Charging history (billed amount). Schema mapped defensively — Tesla returns
  // session rows under response.data; field names have shifted over versions,
  // so keep this tolerant and adjust against live output.
  const hist = await teslaGet('/api/1/dx/charging/history', accessToken);
  if (hist.status === 401) return { status: 401, drives, charges, health };
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

  const hasCoords = drives.some((d) => d.latitude != null && d.longitude != null);
  const scope = opts?.tokenScope || '';
  const scopeKnownMissing = scope.length > 0 && !/\bvehicle_location\b/.test(scope);
  let locationHint: TeslaLocationHint = 'ok';
  if (!hasCoords && (drives.length > 0 || charges.some((c) => c.batteryLevel != null))) {
    if (scopeKnownMissing) locationHint = 'scope';
    else if (sawAsleep) locationHint = 'asleep';
    else locationHint = 'unknown';
  }

  return { status: 200, drives, charges, health, locationHint };
}

/**
 * 能源产品快照(2026-07-30,用户点名要的那半边)。
 *
 * 与车辆分开取、**分开失败**:家里没有太阳能/Powerwall 的人,这里天然是空的,
 * 不能因此把车辆数据也拖没了。所以路由那边 best-effort 调它,
 * 任何非 200 都只让 energy 为空,不影响 drives/charges。
 *
 * 两样东西:
 *   · live_status —— 此刻的功率流向(太阳能 / 家用 / 电网 / 电池)+ 电池电量;
 *   · history?kind=energy&period=day —— 按天的进出电量,给曲线用。
 *     曲线必须来自**真的历史接口**,不是把此刻这一个点重复画成一条线。
 */
export async function collectTeslaEnergy(accessToken: string): Promise<{
  status: number; live: TeslaEnergyLive[]; days: TeslaEnergyDay[];
}> {
  const productsRes = await teslaGet('/api/1/products', accessToken);
  if (productsRes.status === 401) return { status: 401, live: [], days: [] };
  if (productsRes.status !== 200) return { status: productsRes.status, live: [], days: [] };

  const products = ((productsRes.data as { response?: Array<Record<string, unknown>> })?.response) || [];
  // 能源站点才有 energy_site_id;车辆行没有,直接跳过。
  const sites = products
    .map((p) => ({
      siteId: String(p.energy_site_id ?? ''),
      siteName: (p.site_name as string) || undefined,
    }))
    .filter((s) => s.siteId && s.siteId !== 'undefined');

  const live: TeslaEnergyLive[] = [];
  const days: TeslaEnergyDay[] = [];

  for (const s of sites) {
    const at = new Date().toISOString();
    const ls = await teslaGet(`/api/1/energy_sites/${s.siteId}/live_status`, accessToken);
    if (ls.status === 401) return { status: 401, live, days };
    const r = (ls.data as { response?: Record<string, unknown> })?.response;
    if (r) {
      const w = (k: string) => (typeof r[k] === 'number' ? Math.round((r[k] as number) / 10) / 100 : null);  // W → kW,两位
      live.push({
        siteId: s.siteId,
        siteName: s.siteName,
        at,
        solarKw: w('solar_power'),
        loadKw: w('load_power'),
        gridKw: w('grid_power'),
        batteryKw: w('battery_power'),
        batteryPct: typeof r.percentage_charged === 'number' ? Math.round(r.percentage_charged as number) : null,
      });
    }

    const hist = await teslaGet(`/api/1/energy_sites/${s.siteId}/history?kind=energy&period=day`, accessToken);
    if (hist.status === 401) return { status: 401, live, days };
    const rows = ((hist.data as { response?: { time_series?: Array<Record<string, unknown>> } })?.response?.time_series) || [];
    for (const row of rows) {
      const stamp = typeof row.timestamp === 'string' ? row.timestamp : '';
      if (!stamp) continue;
      const kwh = (k: string) => (typeof row[k] === 'number' ? Math.round((row[k] as number) / 10) / 100 : null);
      days.push({
        siteId: s.siteId,
        date: stamp.slice(0, 10),
        solarKwh: kwh('solar_energy_exported'),
        fromGridKwh: kwh('grid_energy_imported'),
        toGridKwh: kwh('grid_energy_exported_from_solar'),
        homeKwh: kwh('consumer_energy_imported_from_grid'),
      });
    }
  }

  return { status: 200, live, days };
}
