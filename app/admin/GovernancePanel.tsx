'use client';

/**
 * 治理面板 —— /admin 里的只读治理地图。数据来自 /api/admin/governance
 * (静态 governance-map.mjs + 构建期快照)。让「治理/契约/就绪」层的运行状态可见:
 * 哪些真在跑、哪些算了没人看、哪个已漂移。
 */
import { useCallback, useEffect, useState } from 'react';

type GovStatus = 'enforced' | 'report-only' | 'dormant' | 'drifted' | 'dead';
interface GovStatusMeta { label: string; tone: string; desc: string }
interface GovGroupMeta { title: string; blurb: string }
interface GovSurface {
  id: string; title: string; group: string; status: GovStatus;
  path: string; route?: string; governs: string; consumedBy: string; note?: string;
}

interface GovResponse {
  ok: boolean;
  error?: string;
  generatedAt?: string;
  snapshot?: {
    status?: string;
    summary?: { moduleCount?: number; readyModuleCount?: number; externalLinkCount?: number };
    dataBus?: { dataKeyCount?: number; connectedDataKeyCount?: number; orphanedDataKeyCount?: number };
  };
  summary?: { total: number; byStatus: Record<string, number> };
  statusMeta?: Record<GovStatus, GovStatusMeta>;
  groupMeta?: Record<string, GovGroupMeta>;
  map?: GovSurface[];
}

const STATUS_ORDER: GovStatus[] = ['enforced', 'report-only', 'dormant', 'drifted', 'dead'];
const STATUS_COLOR: Record<GovStatus, string> = {
  enforced: '#2e9e6b', 'report-only': '#c98a1a', dormant: '#6b6f9e', drifted: '#d64545', dead: '#8a8f99',
};

const card: React.CSSProperties = {
  background: 'var(--glass-bg-raised)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-lg)', padding: '1rem 1.1rem', boxShadow: 'var(--shadow-card)',
};
const tnum: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function pill(status: GovStatus, label: string) {
  const c = STATUS_COLOR[status];
  return (
    <span style={{
      fontSize: '0.66rem', fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
      color: c, background: `color-mix(in srgb, ${c} 15%, transparent)`,
    }}>{label}</span>
  );
}

export function GovernancePanel({ secret }: { secret: string }) {
  const [data, setData] = useState<GovResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/governance', { headers: s ? { 'x-nesio-admin-secret': s } : {} });
      setData(await res.json() as GovResponse);
    } catch {
      setData({ ok: false, error: 'network' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(secret); }, [load, secret]);

  if (!data) return <section style={{ ...card, marginTop: '0.9rem' }}>{loading ? '加载治理地图…' : ''}</section>;
  if (!data.ok) {
    return <section style={{ ...card, marginTop: '0.9rem', borderColor: 'var(--status-risk)' }}>
      治理数据读取失败{data.error ? `(${data.error})` : ''}。
    </section>;
  }

  const { snapshot, summary, statusMeta, groupMeta, map } = data;
  const counts = summary?.byStatus ?? {};
  const total = summary?.total ?? (map?.length ?? 0);
  const risky = (map ?? []).filter((e) => e.status === 'drifted' || e.status === 'dead');

  const kpis: Array<[string, string, string]> = [
    ['治理面总数', String(total), '跨 7 层'],
    ['就绪模块', `${snapshot?.summary?.readyModuleCount ?? '—'} / ${snapshot?.summary?.moduleCount ?? '—'}`, `${snapshot?.summary?.externalLinkCount ?? '—'} 个外部链接`],
    ['数据总线·孤立键', `${snapshot?.dataBus?.orphanedDataKeyCount ?? '—'} / ${snapshot?.dataBus?.dataKeyCount ?? '—'}`, `仅 ${snapshot?.dataBus?.connectedDataKeyCount ?? '—'} 个已连接`],
  ];

  return (
    <section style={{ marginTop: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
        <h2 style={{ fontSize: '1rem', margin: 0, color: 'var(--portal-ink)' }}>软件治理地图</h2>
        <span style={{ fontSize: '0.7rem', color: 'var(--portal-muted)' }}>
          聚合状态 <b style={{ color: STATUS_COLOR.drifted }}>{snapshot?.status ?? '—'}</b>
          {data.generatedAt ? ` · 快照 ${data.generatedAt.slice(0, 10)}` : ''}
        </span>
      </div>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.7rem' }}>
        {kpis.map(([label, val, foot]) => (
          <div key={label} style={card}>
            <div style={{ fontSize: '0.68rem', color: 'var(--portal-muted)' }}>{label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--portal-ink)', marginTop: 4, ...tnum }}>{val}</div>
            <div style={{ fontSize: '0.66rem', color: 'var(--portal-muted)', marginTop: 2 }}>{foot}</div>
          </div>
        ))}
      </div>

      {/* 分布条 */}
      <div style={card}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--portal-ink)', marginBottom: 2 }}>治理健康度</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', marginBottom: 12 }}>
          {total} 个治理面按运行状态分布。绿=真在跑,黄=算了没人看,红=需动手。
        </div>
        <div style={{ display: 'flex', height: 28, borderRadius: 8, overflow: 'hidden', ...tnum }}>
          {STATUS_ORDER.map((s) => {
            const n = counts[s] || 0;
            if (!n) return null;
            return (
              <div key={s} title={`${statusMeta?.[s]?.label ?? s} ${n}`} style={{
                flex: n, background: STATUS_COLOR[s], color: '#fff', fontSize: '0.7rem', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 24,
              }}>{n}</div>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 12 }}>
          {STATUS_ORDER.map((s) => (
            <div key={s} style={{ fontSize: '0.68rem', color: 'var(--portal-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: STATUS_COLOR[s] }} />
              {statusMeta?.[s]?.label ?? s} · {statusMeta?.[s]?.desc ?? ''}
            </div>
          ))}
        </div>
      </div>

      {/* 需要动手 */}
      {risky.length > 0 && (
        <div style={{ ...card, borderColor: 'var(--status-risk)' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--status-risk)', marginBottom: 6 }}>
            需要动手 · {risky.length} 项
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {risky.map((e) => (
              <div key={e.id} style={{ fontSize: '0.75rem', color: 'var(--portal-muted)' }}>
                {pill(e.status, statusMeta?.[e.status]?.label ?? e.status)}
                <b style={{ color: 'var(--portal-ink)', margin: '0 6px' }}>{e.title}</b>
                <span style={{ fontFamily: mono, fontSize: '0.68rem' }}>{e.path}</span>
                {e.note ? <div style={{ marginTop: 3 }}>{e.note}</div> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 分组表 */}
      {Object.entries(groupMeta ?? {}).map(([gk, g]) => {
        const rows = (map ?? []).filter((e) => e.group === gk);
        if (!rows.length) return null;
        return (
          <div key={gk} style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 650, color: 'var(--portal-ink)' }}>{g.title}</span>
              <span style={{ fontSize: '0.68rem', color: 'var(--portal-muted)' }}>{g.blurb}</span>
              <span style={{ fontSize: '0.66rem', color: 'var(--portal-muted)', marginLeft: 'auto', ...tnum }}>{rows.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.map((e) => (
                <div key={e.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 10px', alignItems: 'start',
                  padding: '8px 10px', borderRadius: 9,
                  background: (e.status === 'drifted' || e.status === 'dead') ? 'color-mix(in srgb, var(--status-risk) 8%, transparent)' : 'var(--glass-bg)',
                }}>
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--portal-ink)' }}>{e.title}</div>
                    <div style={{ fontFamily: mono, fontSize: '0.64rem', color: 'var(--portal-muted)', wordBreak: 'break-all' }}>{e.path}</div>
                  </div>
                  <div style={{ justifySelf: 'end' }}>{pill(e.status, statusMeta?.[e.status]?.label ?? e.status)}</div>
                  <div style={{ gridColumn: '1 / -1', fontSize: '0.7rem', color: 'var(--portal-muted)', marginTop: 4 }}>
                    <b style={{ color: 'var(--portal-ink)' }}>治理</b> {e.governs} · <b style={{ color: 'var(--portal-ink)' }}>消费方</b> {e.consumedBy}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
