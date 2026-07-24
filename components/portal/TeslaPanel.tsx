'use client';

/**
 * TeslaPanel — Tesla 数据视图(纯内容,无外壳)。
 * 被两处复用,不留双实现:
 *   ① TeslaSheet(数据接入 → Tesla 行「数据」)—— 包一层 bottom sheet 外壳;
 *   ② 洞察「车」tab —— 常驻入口,便于长期观察数据到没到、去了哪。
 * 只读 GET /api/portal/tesla 的实时快照;顺手把新鲜快照喂给 refreshTesla,
 * 让停车点/充电站即时进足迹、充电花费进财务(externalId 去重,不重复计)。
 */

import { useCallback, useEffect, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

interface TeslaDrive {
  vehicleId: string;
  displayName?: string;
  at: string;
  shiftState?: string;
  speedMph?: number | null;
  odometerMi?: number | null;
  latitude?: number | null;
  longitude?: number | null;
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
}

type LoadState = 'loading' | 'ready' | 'error';

export default function TeslaPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [state, setState] = useState<LoadState>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [drives, setDrives] = useState<TeslaDrive[]>([]);
  const [charges, setCharges] = useState<TeslaCharge[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/portal/tesla', { cache: 'no-store' });
      const data = await res.json() as { ok?: boolean; error?: string; drives?: TeslaDrive[]; charges?: TeslaCharge[] };
      if (!data.ok) {
        setErrMsg(data.error === 'not_connected' || data.error === 'token_expired'
          ? L(dict, 'Tesla 还没连上(或授权已失效)—— 到「设置 → 数据接入 → Tesla」连接一次。', 'Tesla is not linked yet (or auth expired) — connect it from Settings → Data sources → Tesla.')
          : data.error === 'partner_not_registered'
          ? L(dict, '域名还没在 Tesla 完成注册,刚已自动补交 —— 稍等半分钟再试一次。', 'Domain registration with Tesla was just submitted automatically — wait half a minute and try again.')
          : L(dict, `没取到数据(${data.error || '未知'}),稍后再试一次。`, `Couldn't fetch data (${data.error || 'unknown'}) — try again shortly.`));
        setState('error');
        return;
      }
      setDrives(data.drives || []);
      setCharges(data.charges || []);
      setState('ready');
      // 顺手沉淀:面板刚拉到的新鲜快照复用给足迹/财务/信号管线(externalId 去重,
      // 不会重复计),停车点/充电站即时进地图足迹、充电花费进财务 —— 看一眼车,数据就更新。
      void import('@/lib/portal/connectors')
        .then((m) => m.refreshTesla({ drives: (data.drives || []) as never[], charges: (data.charges || []) as never[] }))
        .catch(() => {});
    } catch {
      setErrMsg(L(dict, '网络没接上,稍后再试一次。', 'Network hiccup — try again shortly.'));
      setState('error');
    }
  }, [dict]);

  useEffect(() => { void load(); }, [load]);

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

  const shiftLabel = (s?: string) =>
    s === 'D' || s === 'R' ? L(dict, '行驶中', 'Driving')
      : s === 'N' ? L(dict, '空档', 'Neutral')
      : L(dict, '停放中', 'Parked');

  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    return dict === 'en'
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  if (state === 'loading') {
    return <p className="nesio-settings-option-hint">{L(dict, '正在向车问好…', 'Checking in with the car…')}</p>;
  }

  if (state === 'error') {
    return (
      <div>
        <p className="nesio-settings-option-hint">{errMsg}</p>
        <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: '0.6rem' }} onClick={() => void load()}>
          {L(dict, '再试一次', 'Try again')}
        </button>
      </div>
    );
  }

  return (
    <>
      {liveByVehicle.size === 0 && history.length === 0 && (
        <p className="nesio-settings-option-hint">
          {L(dict, '还没有拿到车辆数据。车辆深度休眠时 Tesla 可能暂时不回,过一会儿再看。', "No vehicle data yet. Tesla may hold back while the car is in deep sleep — check back in a bit.")}
        </p>
      )}

      {[...liveByVehicle.entries()].map(([vid, v]) => {
        const battery = v.charge?.batteryLevel ?? null;
        const name = v.drive?.displayName || v.charge?.displayName || `Tesla ${vid.slice(-4)}`;
        return (
          <div key={vid} style={{
            border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)', marginBottom: 'var(--space-3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <p style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>{name}</p>
              <span className="nesio-settings-option-hint">{shiftLabel(v.drive?.shiftState)}</span>
            </div>
            {battery != null && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>
                  <span>{L(dict, '电量', 'Battery')} {battery}% · {chargingLabel(v.charge?.chargingState)}</span>
                  {v.charge?.energyAddedKwh ? <span>{L(dict, `本次已充 ${v.charge.energyAddedKwh} kWh`, `+${v.charge.energyAddedKwh} kWh this session`)}</span> : null}
                </div>
                <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent-soft)', marginTop: 'var(--space-2)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${battery}%`, height: '100%', borderRadius: 'var(--radius-pill)',
                    background: battery <= 20 ? 'var(--status-gentle)' : 'var(--status-go)',
                  }} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', flexWrap: 'wrap' }}>
              {v.drive?.odometerMi != null && <span>{L(dict, '总里程', 'Odometer')} {Math.round(v.drive.odometerMi).toLocaleString()} mi</span>}
              {(v.drive?.speedMph ?? null) != null && v.drive?.shiftState === 'D' && <span>{v.drive.speedMph} mph</span>}
              {v.drive?.latitude != null && v.drive?.longitude != null && (
                <span>{L(dict, '位置已记入足迹', 'Location saved to Places')}</span>
              )}
            </div>
          </div>
        );
      })}

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
      {history.length === 0 ? (
        <p className="nesio-settings-option-hint">
          {L(dict, '还没有充电记录 —— 下次充电后这里就有了。', 'No charging sessions yet — they will show up after your next charge.')}
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

      {/* 数据去向:直接回答「连了但数据在哪」——沉淀分散在足迹/财务,这里指路。 */}
      <div style={{
        marginTop: 'var(--space-5)', paddingTop: 'var(--space-4)',
        borderTop: '1px solid var(--portal-line)',
      }}>
        <p className="nesio-settings-section-label">{L(dict, '这些数据去哪了', 'Where this data lives')}</p>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--portal-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.7 }}>
          <li>{L(dict, '充电花费 → 洞察 · 财务(和银行流水并在一起看)', 'Charging spend → Insights · Finance (alongside bank transactions)')}</li>
          <li>{L(dict, '停车 / 充电位置 → 洞察 · 分析 · 地点足迹', 'Parking / charging locations → Insights · Analytics · Place trail')}</li>
          <li>{L(dict, '行驶 / 充电记录 → 问一问、时间线可搜到', 'Drives / charges → searchable in Ask & Timeline')}</li>
        </ul>
      </div>
    </>
  );
}
