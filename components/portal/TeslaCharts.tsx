'use client';

/**
 * TeslaCharts — 车页上的两块可视化(2026-07-30,用户点名要的图 2 / 图 4)。
 *
 * 用户原话:「特斯拉的 API 是有能源,位置 API 的,目前一直未实现。
 * 如果可以,做成图 2,和 4 这样的可视化,在车的页面。」
 *   · 图 2 = 车在地图上的位置 —— 复用足迹那张 PlaceMap(OSM 瓦片,零依赖),
 *     不为这一处再引一套地图。
 *   · 图 4 = 随时间变化的曲线 —— **两条真数据**:
 *       家里能源产品的按天进出电量(Tesla 的 history?kind=energy,真历史接口),
 *       和车的电量时间线(本机在你看过的时刻攒的,见 lib/portal/tesla-history)。
 *
 * 一条纪律写在这儿:**这两条曲线的稀疏程度不一样,就得分别说清楚**。
 * 能源那条是全天候记录;车那条只有「你打开过这一页的时刻」。
 * 把后者画成平滑折线会让人以为它一直在采样 —— 所以车这条画成**带点的折线**,
 * 点就是真实采样时刻,底下再写一句「按你查看过的时刻画」。
 *
 * 颜色一律走 token(CLAUDE.md 红线),SVG 里也不例外。
 */

import { useMemo } from 'react';
import { L } from '@/lib/portal/i18n';
import PlaceMap, { type MapPoint } from './insights/PlaceMap';
import type { TeslaLogPoint } from '@/lib/portal/tesla-history';

export interface EnergyLive {
  siteId: string;
  siteName?: string;
  solarKw?: number | null;
  loadKw?: number | null;
  gridKw?: number | null;
  batteryKw?: number | null;
  batteryPct?: number | null;
}

export interface EnergyDay {
  siteId: string;
  date: string;
  solarKwh?: number | null;
  fromGridKwh?: number | null;
  toGridKwh?: number | null;
  homeKwh?: number | null;
}

const num = (v: number | null | undefined): number | null =>
  v != null && Number.isFinite(v) ? v : null;

/* ── 图 2:车在哪 ─────────────────────────────────────────────────── */

export function TeslaLocationMap({ vehicles, dict }: {
  vehicles: Array<{ vehicleId: string; name: string; lat?: number | null; lon?: number | null; batteryPct?: number | null; parked: boolean }>;
  dict: string;
}) {
  const points: MapPoint[] = vehicles
    .filter((v) => v.lat != null && v.lon != null)
    .map((v) => ({
      lat: v.lat as number,
      lon: v.lon as number,
      label: v.batteryPct != null ? `${v.name} · ${v.batteryPct}%` : v.name,
      // 停着的画大一点(它会在那儿待着),开着的小一点(这只是一个采样点)
      weightMin: v.parked ? 90 : 20,
      color: 'var(--portal-blue-deep)',
    }));

  if (!points.length) return null;

  return (
    <>
      <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>
        {L(dict, '车现在在这儿', 'Where the car is')}
      </p>
      <PlaceMap points={points} height={200} />
      <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>
        {/* 只读快照 = 同步时的采样点,不是连续轨迹。说清楚,免得被当成实时追踪。 */}
        {L(dict, '这是刚才那一下取到的位置,不是连续轨迹。', 'A single reading from the last sync — not a continuous track.')}
      </p>
    </>
  );
}

/* ── 图 4:随时间变化 ────────────────────────────────────────────── */

/** 家里能源产品:此刻的功率流向。 */
export function EnergyFlowRow({ live, dict }: { live: EnergyLive; dict: string }) {
  const rows: Array<[string, string, number | null, string]> = [
    [L(dict, '太阳能', 'Solar'), 'kW', num(live.solarKw), 'var(--status-gentle)'],
    [L(dict, '家里在用', 'Home'), 'kW', num(live.loadKw), 'var(--portal-blue-deep)'],
    [L(dict, '电网', 'Grid'), 'kW', num(live.gridKw), 'var(--status-calm)'],
    [L(dict, '家用电池', 'Battery'), 'kW', num(live.batteryKw), 'var(--status-go)'],
  ].filter((r) => r[2] != null) as Array<[string, string, number | null, string]>;

  if (!rows.length && live.batteryPct == null) return null;

  return (
    <div style={{
      border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)', marginBottom: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <p style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)', margin: 0 }}>
          {live.siteName || L(dict, '家里的能源', 'Home energy')}
        </p>
        {live.batteryPct != null && (
          <span className="nesio-settings-option-hint">{L(dict, `电池 ${live.batteryPct}%`, `Battery ${live.batteryPct}%`)}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
        {rows.map(([label, unit, v, color]) => (
          <span key={label} style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>
            <span aria-hidden style={{ color }}>● </span>
            {label} <b style={{ color: 'var(--portal-ink)', fontVariantNumeric: 'tabular-nums' }}>{v}</b> {unit}
          </span>
        ))}
      </div>
      {num(live.gridKw) != null && (
        <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-2) 0 0' }}>
          {/* 正负号是这块唯一容易读反的地方,直接把它翻译成人话 */}
          {(live.gridKw as number) >= 0
            ? L(dict, '正在从电网买电。', 'Pulling from the grid right now.')
            : L(dict, '正在往电网卖电。', 'Sending power back to the grid right now.')}
        </p>
      )}
    </div>
  );
}

/** 家里能源产品:按天的进出电量(真历史接口,不是把此刻这一个点重复画成一条线)。 */
export function EnergyDaysChart({ days, dict }: { days: EnergyDay[]; dict: string }) {
  const rows = useMemo(() => {
    const byDate = new Map<string, { date: string; solar: number; grid: number }>();
    for (const d of days) {
      const cur = byDate.get(d.date) || { date: d.date, solar: 0, grid: 0 };
      cur.solar += num(d.solarKwh) ?? 0;
      cur.grid += num(d.fromGridKwh) ?? 0;
      byDate.set(d.date, cur);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  }, [days]);

  if (rows.length < 2) return null;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.solar, r.grid)));

  return (
    <>
      <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>
        {L(dict, `近 ${rows.length} 天 · 太阳能发了多少 / 从电网买了多少`, `Last ${rows.length} days · solar generated vs. bought from grid`)}
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 96 }}>
        {rows.map((r) => (
          <div key={r.date} title={`${r.date} · ${L(dict, '太阳能', 'Solar')} ${r.solar.toFixed(1)} kWh · ${L(dict, '买电', 'From grid')} ${r.grid.toFixed(1)} kWh`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 1, minWidth: 0 }}>
            <div style={{ height: `${(r.solar / max) * 68}px`, background: 'var(--status-gentle)', borderRadius: '2px 2px 0 0' }} />
            <div style={{ height: `${(r.grid / max) * 68}px`, background: 'var(--status-calm)', borderRadius: '0 0 2px 2px' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-1)' }}>
        <span className="nesio-settings-option-hint">{rows[0].date.slice(5)}</span>
        <span className="nesio-settings-option-hint">
          <span aria-hidden style={{ color: 'var(--status-gentle)' }}>■</span> {L(dict, '太阳能', 'Solar')}
          {'  '}
          <span aria-hidden style={{ color: 'var(--status-calm)' }}>■</span> {L(dict, '买电', 'From grid')}
        </span>
        <span className="nesio-settings-option-hint">{rows[rows.length - 1].date.slice(5)}</span>
      </div>
    </>
  );
}

/**
 * 车的电量时间线。
 * **画成带点的折线**:点就是真实采样时刻。平滑折线会让人以为它一直在采样,
 * 而这条线只有「你打开过这一页的那些时刻」。
 */
export function BatteryTimeline({ log, dict }: { log: TeslaLogPoint[]; dict: string }) {
  const pts = useMemo(
    () => log
      .filter((p) => p.batteryPct != null && Number.isFinite(Date.parse(p.at)))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    [log],
  );
  if (pts.length < 2) return null;

  const W = 320, H = 90, PAD = 6;
  const t0 = Date.parse(pts[0].at);
  const t1 = Date.parse(pts[pts.length - 1].at);
  const span = Math.max(1, t1 - t0);
  const x = (p: TeslaLogPoint) => PAD + ((Date.parse(p.at) - t0) / span) * (W - PAD * 2);
  const y = (p: TeslaLogPoint) => PAD + (1 - (p.batteryPct as number) / 100) * (H - PAD * 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(' ');

  const days = Math.max(1, Math.round(span / 86_400_000));
  const fmt = (iso: string) => {
    const dt = new Date(iso);
    return dict === 'en'
      ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : `${dt.getMonth() + 1}/${dt.getDate()}`;
  };

  return (
    <>
      <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>
        {L(dict, `电量 · 近 ${days} 天`, `Battery · last ${days} days`)}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
        aria-label={L(dict, '电量随时间变化', 'Battery level over time')}>
        <path d={d} fill="none" stroke="var(--status-go)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p) => (
          <circle key={p.at + p.vehicleId} cx={x(p)} cy={y(p)} r="2.5" fill="var(--status-go)" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="nesio-settings-option-hint">{fmt(pts[0].at)}</span>
        <span className="nesio-settings-option-hint">{fmt(pts[pts.length - 1].at)}</span>
      </div>
      <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>
        {/* 稀疏就说稀疏 —— 否则这条线看起来像全天候记录,而它不是 */}
        {L(dict, '按你查看过的时刻画的 —— 车的接口只回「此刻」,没有历史。',
          'Plotted from the moments you checked in — the vehicle API only returns “now”, with no history.')}
      </p>
    </>
  );
}
