'use client';

/**
 * TeslaPanel — Tesla 数据视图(纯内容,无外壳)。
 * 被两处复用,不留双实现:
 *   ① TeslaSheet(数据接入 → Tesla 行「数据」)—— 包一层 bottom sheet 外壳;
 *   ② 洞察「资产 → 车」tab(AssetsPanel)—— 常驻入口,便于长期观察数据到没到、去了哪。
 * 页面真相是本机快照(IDB + 首屏种子)。进页不打 Tesla API —— 休眠唤醒又慢又空。
 * 点「刷新车况」才拉 /api/portal/tesla;顺手把新鲜快照喂给 refreshTesla,
 * 让停车点/充电站即时进足迹、充电花费进财务(externalId 去重,不重复计)。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import LoadingCard from './ui/LoadingCard';
import { fetchWithTimeout } from '@/lib/portal/fetch-timeout';
// #11:「未插枪」和「本次已充 27.2 kWh」不能同屏;「还没有充电记录」也不能跟它同屏
import { chargeEnergyLine, hasAnyChargeRecord } from '@/lib/portal/tesla-charge-copy';
// 2026-07-30 用户点名:「特斯拉的 API 是有能源,位置 API 的,目前一直未实现。
// 如果可以,做成图 2,和 4 这样的可视化,在车的页面。」
import { TeslaLocationMap, EnergyFlowRow, EnergyDaysChart, BatteryTimeline, type EnergyLive, type EnergyDay } from './TeslaCharts';
import { recordTeslaReadings, readTeslaLog, type TeslaLogPoint } from '@/lib/portal/tesla-history';
// 2026-08-01 用户:「如果能做成图 3 和 4 就好」(Tesla 官方那两张 Fleet API 看板)。
// 那是车队看板;一辆车没有「分布」,所以是转译不是照搬 —— 判据都在 tesla-now 里。
import {
  vehicleStatus, statusLabel, statusTone, dataAgeLine, chargeNowLine, rangeLine, healthItems,
} from '@/lib/portal/tesla-now';
import { readPanelCache, writePanelCache, PANEL_CACHE_KEYS } from '@/lib/portal/session-panel-cache';
import {
  readTeslaSnapshot, saveTeslaSnapshot, mergeLastKnownLocation, whenTeslaSnapshotReady,
} from '@/lib/portal/tesla-snapshot-store';

interface TeslaDrive {
  vehicleId: string;
  displayName?: string;
  at: string;
  shiftState?: string;
  speedMph?: number | null;
  odometerMi?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  /** 本次 API 没坐标,用的是 IDB 里上次看到的点 */
  locationStale?: boolean;
  /** 车上那份读数的时刻(毫秒)。和 `at`(我们问它的时刻)不是一回事。 */
  dataAgeMs?: number | null;
}

interface TeslaCharge {
  vehicleId: string;
  displayName?: string;
  at: string;
  batteryLevel?: number | null;
  chargingState?: string;
  costUsd?: number | null;
  energyAddedKwh?: number | null;
  location?: string;
  chargerPowerKw?: number | null;
  rangeMi?: number | null;
  minutesToFull?: number | null;
  chargeLimitPct?: number | null;
}

interface TeslaHealthRow {
  vehicleId: string;
  tirePsi?: { fl: number | null; fr: number | null; rl: number | null; rr: number | null };
  tireSoftWarning?: boolean;
  softwareUpdate?: string;
  carVersion?: string;
  locked?: boolean | null;
  sentryMode?: boolean | null;
  insideTempC?: number | null;
  outsideTempC?: number | null;
}

interface TeslaEnergyPayload {
  live?: EnergyLive[];
  days?: EnergyDay[];
  /** 'scope' = 这枚 token 没有 energy_device_data(要重新授权一次);'fetch' = 这次没取到。 */
  unavailable?: string;
}

type TeslaCachePayload = {
  drives: TeslaDrive[];
  charges: TeslaCharge[];
  health: TeslaHealthRow[];
  energy: TeslaEnergyPayload;
};

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function applyTeslaVehicles(
  onVehicles: ((v: Array<{ vehicleId: string; name: string }>) => void) | undefined,
  drives: TeslaDrive[],
  charges: TeslaCharge[],
) {
  if (!onVehicles) return;
  const seen = new Map<string, string>();
  for (const d of drives) if (d.vehicleId && !seen.has(d.vehicleId)) seen.set(d.vehicleId, d.displayName || `Tesla ${d.vehicleId.slice(-4)}`);
  for (const c of charges) if (c.vehicleId && c.batteryLevel != null && !seen.has(c.vehicleId)) seen.set(c.vehicleId, c.displayName || `Tesla ${c.vehicleId.slice(-4)}`);
  onVehicles([...seen.entries()].map(([vehicleId, name]) => ({ vehicleId, name })));
}

export default function TeslaPanel({ onVehicles, boundIds }: {
  /** #10:把认到的车报给上层(资产页据此让手动录的车认到同一辆上)。 */
  onVehicles?: (v: Array<{ vehicleId: string; name: string }>) => void;
  /** 已经被某件手动资产绑走的车 —— 在这块上标一句,免得用户以为它俩没关系。 */
  boundIds?: string[];
} = {}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const durable = typeof window !== 'undefined' ? readTeslaSnapshot() : null;
  const cached = durable
    ? { drives: durable.drives, charges: durable.charges, health: (durable.health || []) as TeslaHealthRow[], energy: (durable.energy || {}) as TeslaEnergyPayload }
    : readPanelCache<TeslaCachePayload>(PANEL_CACHE_KEYS.tesla);
  const [state, setState] = useState<LoadState>(cached ? 'ready' : 'idle');
  const [errMsg, setErrMsg] = useState('');
  const [drives, setDrives] = useState<TeslaDrive[]>(() => cached?.drives ?? []);
  const [charges, setCharges] = useState<TeslaCharge[]>(() => cached?.charges ?? []);
  const [energy, setEnergy] = useState<TeslaEnergyPayload>(() => cached?.energy ?? {});
  const [health, setHealth] = useState<TeslaHealthRow[]>(() => cached?.health ?? []);
  /**
   * 车停在哪儿的**地名**(图 3 卡片上那行「345 Almaden Dr, San Jose」)。
   * 一对经纬度对人是没有意义的 —— 地图上那个点告诉你「在这儿」,
   * 但说不出「在公司」还是「在家」。反解一次,按坐标缓存。
   */
  const [placeByVehicle, setPlaceByVehicle] = useState<Record<string, string>>(() => durable?.placeByVehicle ?? {});
  /** 地址反解失败可见态(红线:异步必须有失败 UI + 重试,不可静默吞)。 */
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoRetryToken, setGeoRetryToken] = useState(0);
  const [log, setLog] = useState<TeslaLogPoint[]>([]);
  /** 没坐标时的原因:scope / asleep / unknown —— 不许一律说「没授权」。 */
  const [locationHint, setLocationHint] = useState<'ok' | 'scope' | 'asleep' | 'unknown'>('ok');
  const [lowBattRows, setLowBattRows] = useState<Array<{ vehicleId: string; displayName?: string; batteryLevel: number }>>([]);
  const [refreshing, setRefreshing] = useState(false);

  // 2026-07-29(用户标注「车页卡死在『正在向车问好…』」的真因):这条 fetch 原本没有超时。
  // 车在深度休眠时 Tesla 侧可能几十秒不回,连接半挂时浏览器更是无限等 ——
  // 于是 setState('ready'|'error') 都执行不到,页面就永远停在「正在向车问好…」。
  // 15s 到点主动 abort → 走下面的 catch → 显式失败态 + 再试一次(CLAUDE.md 红线)。
  // #12(2026-07-30 真机:「正在向车问好…」这条加载条一直不消失):
  // 上一轮已经给 fetch 加了超时,但那是**数据层**的一道闸。真机上还会有两种漏法:
  //   ① abort 没能生效(标签页被挂起、AbortSignal 被 polyfill 吃掉)→ 谁也不来收尾;
  //   ② 语言切换让 load 重建、effect 重跑,**两个请求在飞**;先发的后回,
  //      把已经 ready 的界面又推回 loading / 覆盖成旧结果。
  // 所以这里补两样:一个请求序号(只认最后一次的结果),
  // 和 LoadingCard 自己的 timeoutMs 兜底 —— 等待态必须**有尽头**(CLAUDE.md 红线)。
  const reqRef = useRef(0);
  const hasDataRef = useRef(Boolean(cached));

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    const seq = ++reqRef.current;
    const mine = () => reqRef.current === seq;
    // 已有固定数据时绝不整页换成「向车问好」—— 那是当场拉 API 的形状。
    if (!opts.silent && !hasDataRef.current) setState('loading');
    else setRefreshing(true);
    try {
      const res = await fetchWithTimeout('/api/portal/tesla', { cache: 'no-store' }, 45_000);
      const data = await res.json() as {
        ok?: boolean; error?: string;
        drives?: TeslaDrive[]; charges?: TeslaCharge[]; health?: TeslaHealthRow[];
        energy?: TeslaEnergyPayload;
        locationHint?: 'ok' | 'scope' | 'asleep' | 'unknown';
      };
      if (!mine()) return;   // 已经有更新的一趟在飞,旧结果一律丢弃
      setRefreshing(false);
      if (!data.ok) {
        // 已有画面 → 保留旧数据,失败写在横幅,不踢成 error 整页空白。
        if (hasDataRef.current) {
          setErrMsg(data.error === 'not_connected' || data.error === 'token_expired'
            ? L(dict, 'Tesla 还没连上(或授权已失效)—— 到「设置 → 数据接入 → Tesla」连接一次。', 'Tesla is not linked yet (or auth expired) — connect it from Settings → Data sources → Tesla.')
            : L(dict, `没取到新数据(${data.error || '未知'}),下面仍是上次存下的。`, `Couldn't refresh (${data.error || 'unknown'}) — showing the last saved snapshot.`));
          return;
        }
        setErrMsg(data.error === 'not_connected' || data.error === 'token_expired'
          ? L(dict, 'Tesla 还没连上(或授权已失效)—— 到「设置 → 数据接入 → Tesla」连接一次。', 'Tesla is not linked yet (or auth expired) — connect it from Settings → Data sources → Tesla.')
          : data.error === 'partner_not_registered'
          ? L(dict, '域名还没在 Tesla 完成注册,刚已自动补交 —— 稍等半分钟再试一次。', 'Domain registration with Tesla was just submitted automatically — wait half a minute and try again.')
          : L(dict, `没取到数据(${data.error || '未知'}),稍后再试一次。`, `Couldn't fetch data (${data.error || 'unknown'}) — try again shortly.`));
        setState('error');
        return;
      }
      const lastSnap = readTeslaSnapshot();
      const nextDrives = mergeLastKnownLocation(data.drives || [], lastSnap?.drives);
      const nextCharges = (data.charges || []).length ? data.charges || [] : lastSnap?.charges || [];
      const nextHealth = data.health || [];
      const nextEnergy = data.energy || {};
      setDrives(nextDrives);
      setCharges(nextCharges);
      setEnergy(nextEnergy);
      setHealth(nextHealth);
      setLocationHint(data.locationHint || 'ok');
      setErrMsg('');
      setState('ready');
      hasDataRef.current = true;
      writePanelCache(PANEL_CACHE_KEYS.tesla, {
        drives: nextDrives, charges: nextCharges, health: nextHealth, energy: nextEnergy,
      });
      saveTeslaSnapshot({
        at: new Date().toISOString(),
        drives: nextDrives,
        charges: nextCharges,
        health: nextHealth,
        energy: nextEnergy,
        locationHint: data.locationHint || 'ok',
      });
      // #10:把车报上去。用 name 而不是 id 展示 —— 用户认得的是「JingBell」,不是一串数字。
      applyTeslaVehicles(onVehicles, nextDrives, nextCharges);
      // 低电量:页内横幅 + 壳内系统通知(一天一车一次)
      try {
        const { listLowBatteryVehicles, notifyTeslaLowBattery } = await import('@/lib/portal/tesla-low-battery');
        const low = listLowBatteryVehicles(
          nextCharges
            .filter((c) => c.batteryLevel != null)
            .map((c) => ({
              vehicleId: c.vehicleId,
              displayName: c.displayName,
              batteryLevel: c.batteryLevel as number,
              chargingState: c.chargingState,
            })),
        );
        setLowBattRows(low.map((r) => ({ vehicleId: r.vehicleId, displayName: r.displayName, batteryLevel: r.batteryLevel })));
        void notifyTeslaLowBattery(low, { zh: dict !== 'en' });
      } catch { setLowBattRows([]); }
      // 车的接口只回「此刻」——图 4 那条曲线只能在**看过的时刻**攒。
      // 攒完立刻重读:这一次的点也要出现在图上,不用等下次开页面。
      try {
        const byVehicle = new Map<string, { vehicleId: string; batteryPct?: number | null; odometerMi?: number | null; chargingState?: string }>();
        for (const d of nextDrives) {
          byVehicle.set(d.vehicleId, {
            vehicleId: d.vehicleId,
            odometerMi: d.odometerMi ?? null,
            latitude: d.latitude ?? null,
            longitude: d.longitude ?? null,
          });
        }
        for (const c of nextCharges) {
          if (c.batteryLevel == null) continue;
          byVehicle.set(c.vehicleId, { ...byVehicle.get(c.vehicleId), vehicleId: c.vehicleId, batteryPct: c.batteryLevel, chargingState: c.chargingState });
        }
        recordTeslaReadings([...byVehicle.values()]);
      } catch { /* 攒失败不影响看车;写失败已在 recordTeslaReadings 里上报 */ }
      setLog(readTeslaLog());
      // 顺手沉淀:面板刚拉到的新鲜快照复用给足迹/财务/信号管线(externalId 去重,
      // 不会重复计),停车点/充电站即时进地图足迹、充电花费进财务 —— 看一眼车,数据就更新。
      void import('@/lib/portal/connectors')
        .then((m) => m.refreshTesla({ drives: nextDrives as never[], charges: nextCharges as never[] }))
        .catch(() => {});
    } catch {
      if (!mine()) return;
      setRefreshing(false);
      if (hasDataRef.current) {
        setErrMsg(L(dict, '这次没等到车的回应 —— 下面仍是上次存下的。', 'The car did not answer — still showing the last saved snapshot.'));
        return;
      }
      setErrMsg(L(dict, '这次没等到车的回应 —— 它可能在深度休眠。稍后再试一次。', 'The car did not answer this time — it may be in deep sleep. Try again shortly.'));
      setState('error');
    }
  }, [dict, onVehicles]);

  useEffect(() => {
    let stop = false;
    void (async () => {
      await whenTeslaSnapshotReady();
      if (stop) return;
      const snap = readTeslaSnapshot();
      if (snap) {
        const drives = snap.drives || [];
        const charges = snap.charges || [];
        const health = (snap.health || []) as TeslaHealthRow[];
        const energy = (snap.energy || {}) as TeslaEnergyPayload;
        setDrives(drives);
        setCharges(charges);
        setHealth(health);
        setEnergy(energy);
        setPlaceByVehicle(snap.placeByVehicle ?? {});
        if (snap.locationHint) setLocationHint(snap.locationHint);
        setState('ready');
        hasDataRef.current = true;
        applyTeslaVehicles(onVehicles, drives, charges);
        try { setLog(readTeslaLog()); } catch { /* 日志缺不影响看车 */ }
        return;
      }
      // 本机还没有存过 → 才当场问一次车。
      void load();
    })();
    return () => { stop = true; };
    // 只在挂载时决定要不要拉;语言/onVehicles 变化不该整页重 Loading。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 把车所在的坐标反解成一个人能读的地名。
   *
   * **先走客户端 Open-Meteo / BigDataCloud**(与天气同源,不经 guardAiRoute)——
   * 以前先打 /api/portal/geocode,401/额度失败时会误报「要先登录」,而电量/能源
   * 明明已经能看。服务端 Foursquare 作补充,解出店名更好。
   */
  const geoKeyRef = useRef('');
  useEffect(() => {
    const withCoords = drives.filter((d) => d.latitude != null && d.longitude != null);
    if (!withCoords.length) { setGeoErr(null); return; }
    const key = withCoords.map((d) => `${d.vehicleId}:${d.latitude!.toFixed(4)},${d.longitude!.toFixed(4)}`).join('|');
    const runKey = `${key}#${geoRetryToken}`;
    if (runKey === geoKeyRef.current) return;
    geoKeyRef.current = runKey;
    let alive = true;
    setGeoBusy(true);
    setGeoErr(null);
    void (async () => {
      const next: Record<string, string> = {};
      let failKind: 'http' | 'empty' | 'net' | null = null;
      const { reverseGeocode } = await import('@/lib/portal/providers/weather');
      for (const d of withCoords) {
        try {
          const g = await reverseGeocode(d.latitude!, d.longitude!);
          if (g.label) {
            next[d.vehicleId] = g.label;
            // 有坐标就先落地;服务端再试一次换更贴的店名(失败不抹掉客户端结果)
            try {
              const res = await fetchWithTimeout('/api/portal/geocode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat: d.latitude, lon: d.longitude }),
                cache: 'no-store',
              }, 8_000);
              if (res.ok) {
                const j = await res.json().catch(() => null) as { ok?: boolean; name?: string; city?: string } | null;
                if (j?.ok) {
                  const label = [String(j.name || '').trim(), String(j.city || '').trim()].filter(Boolean).join(' · ');
                  if (label) next[d.vehicleId] = label;
                }
              }
            } catch { /* 客户端已有 label */ }
            continue;
          }
          failKind = failKind || 'empty';
        } catch {
          failKind = failKind || 'net';
        }
      }
      if (!alive) return;
      setGeoBusy(false);
      if (Object.keys(next).length) {
        setPlaceByVehicle((prev) => {
          const merged = { ...prev, ...next };
          const snap = readTeslaSnapshot();
          if (snap) saveTeslaSnapshot({ ...snap, placeByVehicle: merged });
          return merged;
        });
        setGeoErr(null);
        return;
      }
      setGeoErr(
        failKind === 'net'
          ? L(dict, '地址反解没连上,稍后再试一次。', "Couldn't reach geocode — try again shortly.")
          : L(dict, '这次没解出地名。地图上的点还在,点重试再问一次。', "Couldn't resolve a place name. The map pin is still there — tap retry."),
      );
    })();
    return () => { alive = false; };
  }, [drives, geoRetryToken, dict]);

  const healthByVehicle = new Map(health.map((h) => [h.vehicleId, h]));

  // 实时行(有电量)按车归组;历史行(有站点/花费、无电量)按时间倒序。
  const liveByVehicle = new Map<string, { drive?: TeslaDrive; charge?: TeslaCharge }>();
  for (const d of drives) {
    liveByVehicle.set(d.vehicleId, { ...liveByVehicle.get(d.vehicleId), drive: d });
  }
  for (const c of charges) {
    if (c.batteryLevel == null) continue;
    liveByVehicle.set(c.vehicleId, { ...liveByVehicle.get(c.vehicleId), charge: c });
  }
  const history = charges
    .filter((c) => c.batteryLevel == null)
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  // 有车但一个坐标都没回 = 多半没授权 vehicle_location(独立权限)→ 位置进不了足迹。
  const hasVehicle = liveByVehicle.size > 0;
  const hasAnyLocation = drives.some((d) => d.latitude != null && d.longitude != null);
  const hasStaleLocation = drives.some((d) => d.locationStale);

  const anyChargeRecord = hasAnyChargeRecord(
    history.length,
    [...liveByVehicle.values()].map((v) => v.charge?.energyAddedKwh),
  );

  const monthAgo = Date.now() - 30 * 86_400_000;
  const recent = history.filter((c) => new Date(c.at).getTime() >= monthAgo);
  const recentCost = recent.reduce((s, c) => s + (c.costUsd || 0), 0);
  const recentKwh = recent.reduce((s, c) => s + (c.energyAddedKwh || 0), 0);

  const chargingLabel = (s?: string) =>
    s === 'Charging' ? L(dict, '充电中', 'Charging')
      : s === 'Complete' ? L(dict, '充满了', 'Charged')
      : s === 'Stopped' ? L(dict, '已暂停', 'Paused')
      : s === 'Disconnected' ? L(dict, '未插枪', 'Unplugged')
      : s || L(dict, '未知', 'Unknown');

  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    return dict === 'en'
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  if (state === 'idle') return null;

  if (state === 'loading') {
    return (
      <LoadingCard
        label={L(dict, '正在向车问好…', 'Checking in with the car…')}
        lines={3}
        timeoutMs={50_000}
        onTimeout={() => {
          reqRef.current += 1;   // 迟到的响应不许再把界面推回去
          setErrMsg(L(dict, '这次没等到车的回应 —— 它可能在深度休眠。稍后再试一次。', 'The car did not answer this time — it may be in deep sleep. Try again shortly.'));
          setState('error');
        }}
      />
    );
  }

  if (state === 'error') {
    return (
      <div style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)', background: 'var(--portal-accent-soft)', padding: 'var(--space-4)' }}>
        <p className="nesio-settings-option-hint" style={{ margin: 0 }}>{errMsg}</p>
        <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-2)' }} onClick={() => void load()}>
          {L(dict, '再试一次', 'Try again')}
        </button>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <p className="nesio-settings-option-hint" style={{ margin: 0 }}>
          {refreshing
            ? L(dict, '正在更新上次存下的车况…', 'Updating the saved snapshot…')
            : L(dict, '下面是上次存下的车况,不会进页就问车。', 'This is the last saved snapshot — opening the page does not wake the car.')}
        </p>
        <button type="button" className="nesio-ob-primary-btn" style={{ flexShrink: 0 }} disabled={refreshing} onClick={() => void load({ silent: true })}>
          {refreshing ? L(dict, '更新中…', 'Updating…') : L(dict, '刷新车况', 'Refresh')}
        </button>
      </div>
      {errMsg && state === 'ready' && (
        <p className="nesio-settings-option-hint" role="status" style={{ margin: '0 0 var(--space-3)' }}>{errMsg}</p>
      )}
      {liveByVehicle.size === 0 && history.length === 0 && (
        <p className="nesio-settings-option-hint">
          {L(dict, '还没有拿到车辆数据。车辆深度休眠时 Tesla 可能暂时不回,过一会儿再看。', "No vehicle data yet. Tesla may hold back while the car is in deep sleep — check back in a bit.")}
        </p>
      )}

      {[...liveByVehicle.entries()].map(([vid, v]) => {
        const battery = v.charge?.batteryLevel ?? null;
        const name = v.drive?.displayName || v.charge?.displayName || `Tesla ${vid.slice(-4)}`;
        // 图 3 那张卡的三样:一个明确的状态、这份读数多旧、车停在哪个地名。
        const status = vehicleStatus({
          shiftState: v.drive?.shiftState,
          chargingState: v.charge?.chargingState,
          dataAgeMs: v.drive?.dataAgeMs ?? null,
        });
        const zh = dict !== 'en';
        const age = dataAgeLine(v.drive?.dataAgeMs ?? null, zh);
        const place = placeByVehicle[vid] || '';
        const charging = chargeNowLine({
          chargingState: v.charge?.chargingState,
          chargerPowerKw: v.charge?.chargerPowerKw ?? null,
          minutesToFull: v.charge?.minutesToFull ?? null,
          chargeLimitPct: v.charge?.chargeLimitPct ?? null,
          batteryLevel: battery,
        }, zh);
        const range = rangeLine(v.charge?.rangeMi ?? null, zh);
        const hItems = healthItems(healthByVehicle.get(vid), zh);
        return (
          <div key={vid} style={{
            border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)', marginBottom: 'var(--space-3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
              <p style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)', margin: 0 }}>{name}</p>
              {/* 图 3 的图例(在开 / 停放 / 离线)在单车上收成一个带色点的状态。
                  「联系不上」用温和色而不是风险色 —— 车在睡觉不是故障。 */}
              <span className={`nesio-tesla-status is-${statusTone(status)}`}>
                <span className="nesio-tesla-dot" aria-hidden />
                {statusLabel(status, dict !== 'en')}
              </span>
            </div>
            {/* 这一行是这张卡上最要紧的一句:**这份读数多旧**。
                Tesla 回的是车上最后一次上报的值,深度休眠时能是几小时前的 ——
                不说出来,一个昨晚的电量就会被当成此刻,而用户会照着它决定要不要出门。 */}
            <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>
              {age}{place ? ` · ${place}` : ''}
            </p>
            {/* #10:这辆车已经和下面某件手动记的车认成同一辆了 —— 说一句,
                免得「JingBell」和「Model Y」看起来还是两台互不相干的车。 */}
            {(boundIds || []).includes(vid) && (
              <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>
                {L(dict, '下面那条车产记录说的就是它。', 'The car asset below refers to this one.')}
              </p>
            )}
            {battery != null && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>
                  <span>{L(dict, '电量', 'Battery')} {battery}% · {chargingLabel(v.charge?.chargingState)}</span>
                  {/* #11:charge_energy_added 断枪后仍保留上一段的读数。不问状态就冠上
                      「本次」,就成了「未插枪」和「本次已充 27.2 kWh」同屏。
                      「本次」这个词是有前提的 —— 得真的在这一段里。 */}
                  {(() => {
                    const line = chargeEnergyLine(v.charge?.chargingState, v.charge?.energyAddedKwh);
                    return line ? <span>{L(dict, line.zh, line.en)}</span> : null;
                  })()}
                </div>
                <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent-soft)', marginTop: 'var(--space-2)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${battery}%`, height: '100%', borderRadius: 'var(--radius-pill)',
                    background: battery <= 20 ? 'var(--status-gentle)' : 'var(--status-go)',
                  }} />
                </div>
                {/* 「还能开多远」是百分比回答不了的 —— 充电上限不是 100% 时尤其如此。
                    正在充的时候再加一句「还要多久到 80%」。 */}
                {(range || charging) && (
                  <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-2) 0 0' }}>
                    {[range, charging].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', flexWrap: 'wrap' }}>
              {v.drive?.odometerMi != null && <span>{L(dict, '总里程', 'Odometer')} {Math.round(v.drive.odometerMi).toLocaleString()} mi</span>}
              {(v.drive?.speedMph ?? null) != null && v.drive?.shiftState === 'D' && <span>{v.drive.speedMph} mph</span>}
              {v.drive?.latitude != null && v.drive?.longitude != null && (
                <span>{L(dict, '位置已记入足迹', 'Location saved to Places')}</span>
              )}
            </div>

            {/* 图 4 的「Vehicle Health」在单车上的对应物。原图是 79 辆车的告警分布 ——
                一辆车没有分布,硬做成环形图只会是一个 100% 单色的装饰。
                真正拿得到、也真有人关心的是这几样。**取不到的项一个都不显示**:
                一行「胎压 —」不是信息,它只是把「我们没拿到」伪装成一条数据。 */}
            {hItems.length > 0 && (
              <div className="nesio-tesla-health">
                {hItems.map((it) => (
                  <div key={it.key} className={`nesio-tesla-health-cell is-${it.tone}`}>
                    <span className="nesio-tesla-health-label">{it.label}</span>
                    <span className="nesio-tesla-health-value">{it.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* 低电量提醒横幅(<40% 且未在充) */}
      {lowBattRows.length > 0 && (
        <div style={{
          borderRadius: 'var(--radius-md)', border: '1px solid var(--status-gentle)',
          background: 'var(--status-gentle-soft)', padding: 'var(--space-3)', marginBottom: 'var(--space-3)',
        }} role="status">
          {lowBattRows.map((r) => (
            <p key={r.vehicleId} className="nesio-settings-option-hint" style={{ margin: 0, color: 'var(--portal-ink)' }}>
              {L(
                dict,
                `${r.displayName || 'Tesla'} 电量 ${Math.round(r.batteryLevel)}% —— 低于 40%,找个地方充一下更安心。`,
                `${r.displayName || 'Tesla'} is at ${Math.round(r.batteryLevel)}% — under 40%. A charge would help.`,
              )}
            </p>
          ))}
        </div>
      )}

      {/* 没坐标时按真实原因说,不许一律「没授权」(能量/电量正常 ≠ 位置字段有值;
          休眠会抹坐标;token 若真缺 vehicle_location 才提示重连)。 */}
      {hasAnyLocation && hasStaleLocation && (
        <p className="nesio-settings-option-hint" style={{ margin: '0 0 var(--space-2)' }}>
          {L(dict, '地图是上次看到的停车点 —— 车这会儿没回坐标(多半在休眠)。点刷新会再问一次。', 'Map shows the last known parking spot — the car did not send coordinates this time (often asleep). Tap refresh to ask again.')}
        </p>
      )}
      {hasVehicle && !hasAnyLocation && (
        <div style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
          <p className="nesio-settings-option-hint" style={{ margin: 0 }}>
            {locationHint === 'scope'
              ? L(dict, '这枚授权里还没有 Vehicle Location —— 到设置 → 数据接入里重连一次 Tesla,勾上位置即可。', 'This grant is missing Vehicle Location — reconnect Tesla in Settings → Data sources and allow location.')
              : locationHint === 'asleep'
                ? L(dict, '车可能在休眠,位置这一下没带上来。点下面刷新会试着唤醒再问一次。', 'The car may be asleep, so location did not come through. Tap refresh below to wake it and ask again.')
                : L(dict, '这次没拿到停车坐标(电量正常也不代表位置字段有值)。点刷新再问一次。', 'No parking coordinates this time (battery can work without location). Tap refresh to ask again.')}
          </p>
          <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-2)' }} onClick={() => void load()}>
            {L(dict, '刷新位置', 'Refresh location')}
          </button>
        </div>
      )}

      {/* 地址反解失败态(红线):有坐标但地名没解出来时可见 + 可重试 */}
      {hasAnyLocation && geoErr && (
        <div style={{
          borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)',
          background: 'var(--status-gentle-soft)', padding: 'var(--space-3)', marginBottom: 'var(--space-3)',
        }}>
          <p className="nesio-settings-option-hint" style={{ margin: 0 }}>{geoErr}</p>
          <button
            type="button"
            className="nesio-ob-primary-btn"
            style={{ width: '100%', marginTop: 'var(--space-2)' }}
            disabled={geoBusy}
            onClick={() => {
              geoKeyRef.current = '';
              setGeoRetryToken((n) => n + 1);
            }}
          >
            {geoBusy ? L(dict, '正在重试…', 'Retrying…') : L(dict, '重试地址', 'Retry address')}
          </button>
        </div>
      )}

      {/* 图 2:车在地图上的位置。复用足迹那张 PlaceMap(OSM 瓦片,零依赖),
          不为这一处再引一套地图。没坐标时它自己返回 null。 */}
      <TeslaLocationMap dict={dict} vehicles={[...liveByVehicle.entries()].map(([vid, v]) => ({
        vehicleId: vid,
        name: v.drive?.displayName || v.charge?.displayName || `Tesla ${vid.slice(-4)}`,
        lat: v.drive?.latitude ?? null,
        lon: v.drive?.longitude ?? null,
        batteryPct: v.charge?.batteryLevel ?? null,
        parked: v.drive?.shiftState !== 'D' && v.drive?.shiftState !== 'R',
      }))} />

      {/* 图 4 的第一条:车的电量随时间。点少于 2 个时自己返回 null —— 一个点连不成线,
          硬画一条平线会让人以为「电量一直没变」。 */}
      <BatteryTimeline log={log} dict={dict} />

      {/* 家里的能源产品(太阳能 / Powerwall)。授权里没勾 energy_device_data 时如实说 ——
          直接显示「没有能源产品」会把「没授权」说成「你家没有」,那是两回事。 */}
      {(energy.live?.length ?? 0) > 0 && (
        <>
          <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>
            {L(dict, '家里的能源', 'Home energy')}
          </p>
          {energy.live!.map((e) => <EnergyFlowRow key={e.siteId} live={e} dict={dict} />)}
        </>
      )}
      <EnergyDaysChart days={energy.days || []} dict={dict} />
      {energy.unavailable === 'scope' && (
        <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-3)' }}>
          {L(dict, '家里的能源数据还没授权 —— 到设置 → 数据接入里重连一次 Tesla 就有了(授权页勾上 Energy Product Information)。',
            'Home energy is not authorized yet — reconnect Tesla in Settings → Data sources and allow Energy Product Information.')}
        </p>
      )}

      <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>
        {L(dict, '充电', 'Charging')}
      </p>
      {recent.length > 0 && (
        <p className="nesio-settings-option-hint" style={{ marginBottom: 'var(--space-2)' }}>
          {L(dict,
            `近 30 天:${recent.length} 次 · ${recentKwh.toFixed(1)} kWh${recentCost > 0 ? ` · 共 $${recentCost.toFixed(2)}(已入财务)` : ''}`,
            `Last 30 days: ${recent.length} sessions · ${recentKwh.toFixed(1)} kWh${recentCost > 0 ? ` · $${recentCost.toFixed(2)} total (tracked in Finance)` : ''}`)}
        </p>
      )}
      {/* #11:原判据是 `history.length === 0`,而 history 只收**没有电量字段的历史行** ——
          那条带电量的实时行根本不在里面。于是「上面写着 27.2 kWh」和
          「还没有充电记录」可以同时为真。空态的判据必须是「这一屏一个充电数字都没有」。 */}
      {history.length === 0 ? (
        <p className="nesio-settings-option-hint">
          {anyChargeRecord
            ? L(dict, '这一段的读数在上面 —— 整段完成后会落成一条记录。', 'The reading above is from the current session — it becomes a record once the session closes.')
            : L(dict, '还没有充电记录 —— 下次充电后这里就有了。', 'No charging sessions yet — they will show up after your next charge.')}
        </p>
      ) : history.slice(0, 20).map((c, i) => (
        <div key={`${c.at}-${i}`} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          padding: 'var(--space-2) 0', borderBottom: '1px solid var(--portal-line)',
          fontSize: 'var(--text-sm)',
        }}>
          <div style={{ minWidth: 0 }}>
            <span style={{ color: 'var(--portal-ink)' }}>{fmtDay(c.at)}</span>
            {c.location ? <span style={{ color: 'var(--portal-muted)', marginLeft: 'var(--space-2)' }}>{c.location}</span> : null}
          </div>
          <div style={{ flexShrink: 0, color: 'var(--portal-muted)' }}>
            {c.energyAddedKwh ? `${c.energyAddedKwh} kWh` : ''}
            {c.costUsd ? <span style={{ color: 'var(--portal-ink)', marginLeft: 'var(--space-2)' }}>${c.costUsd.toFixed(2)}</span> : null}
          </div>
        </div>
      ))}

      {/* Bug4 图24:「这些数据去哪了」那三行指路入口删掉 —— 车 tab 现在是资产页里的一块,
          它该显示的是这辆车现在什么样(状态 / 里程 / 充电 / 能耗),不是一张站内地图。
          充电花费本来就已经进了财务、位置进了足迹,那两个板块自己在导航里。 */}
    </>
  );
}
