'use client';

/**
 * AdminOpsPanel — 洞察「运营」tab:在 App 内看后台运行情况(workshop 自持实例)。
 * 复用 /admin 的同一把管理密钥(localStorage `nesio_admin_secret`)+ 同一数据源
 * (/api/admin/metrics),做一个手机版精简概览:数据源健康 / KPI / AI 成本 / 聪明度 /
 * 客户端错误 / 规则洞察,底部一键「打开完整面板」直达 /admin。
 * 只读;密钥门未过 → 就地输入密钥(只存本机);失败有可见态(红线)。
 */

import { useCallback, useEffect, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const SECRET_KEY = 'nesio_admin_secret';

interface Metrics {
  ok: boolean;
  error?: string;
  hint?: string;
  generatedAt?: string;
  sampleCapped?: boolean;
  sources?: { telemetryEvents: { ok: boolean; error?: string }; productEvents: { ok: boolean; error?: string } };
  windows?: { today: { events: number; devices: number }; week: { events: number; devices: number }; month: { events: number; devices: number } };
  insights?: Array<{ severity: 'go' | 'gentle' | 'risk'; title: string; detail: string; advice: string }>;
  ai?: { totals: { calls: number; estCostUsd: number; okRate: number | null; avgLatencyMs: number | null }; routes: Array<{ route: string; calls: number; okRate: number; avgLatencyMs: number; estCostUsd: number }> };
  smartness?: { score: number; dims?: Array<{ dim: string; score: number; thin: boolean }> };
  clientErrors?: Array<{ kind: string; message: string; count: number; devices: number; lastAt: string }>;
  deviceList?: Array<{ id: string; events: number; firstAt: string; lastAt: string }>;
  behavior?: { activeDays30: number; activeHours: number[]; topFeatures: Array<{ name: string; count: number }> };
}

const SEV_COLOR: Record<string, string> = { go: 'var(--status-go)', gentle: 'var(--status-gentle)', risk: 'var(--status-risk)' };

// 埋点事件名 → 人话(画像用);没映射的显示原名
const FEATURE_LABEL: Record<string, [string, string]> = {
  app_open: ['打开 App', 'Open app'], mood_open: ['记心情', 'Mood'], capture_voice_open: ['说一句', 'Voice note'],
  chat_send: ['问一问/聊天', 'Chat'], memory_saved: ['存记忆', 'Save memory'], first_memory: ['首条记忆', 'First memory'],
  workout_start: ['开始跟练', 'Workout'], insights_open: ['开洞察', 'Open insights'], inventory_open: ['物品', 'Items'],
  rewards_open: ['奖品商城', 'Rewards'], brief_play: ['听简报', 'Brief'], brief_open: ['简报', 'Brief'],
  freeze_open: ['冷冻仓', 'Vault'], pro_gate_shown: ['碰到 Pro 门', 'Pro gate'], mood_open2: ['心情', 'Mood'],
  capture_camera_open: ['拍一下', 'Camera'], feature_used: ['用功能', 'Feature'],
};
const featLabel = (name: string, en: boolean): string => {
  const m = FEATURE_LABEL[name];
  return m ? (en ? m[1] : m[0]) : name;
};

export default function AdminOpsPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [secret, setSecret] = useState('');
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDims, setShowDims] = useState(false);   // 点聪明度 → 展开五维
  const [showDevices, setShowDevices] = useState(false);
  const en = dict === 'en';

  const load = useCallback(async (withSecret: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/metrics', { headers: withSecret ? { 'x-nesio-admin-secret': withSecret } : {} });
      const json = await res.json() as Metrics;
      setData(json);
      if (json.ok) { try { localStorage.setItem(SECRET_KEY, withSecret); } catch { /* ignore */ } }
    } catch {
      setData({ ok: false, error: 'network_failed' });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let s = '';
    try { s = localStorage.getItem(SECRET_KEY) || ''; } catch { /* ignore */ }
    setSecret(s);
    void load(s);
  }, [load]);

  const card: React.CSSProperties = { borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)', background: 'var(--portal-accent-soft)', padding: 'var(--space-4)' };
  const label: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' };
  const big: React.CSSProperties = { fontSize: 'var(--text-h2)', fontWeight: 'var(--weight-bold)', color: 'var(--portal-ink)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' };
  const sectionLbl: React.CSSProperties = { margin: 'var(--space-5) 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' };

  // ── 密钥门 / 失败态 ──
  if (data && !data.ok) {
    const needSecret = data.error === 'admin_secret_required' || data.error === 'forbidden';
    return (
      <div className="nesio-analytics-tab">
        {needSecret ? (
          <div style={card}>
            <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--portal-ink)' }}>
              {L(dict, '输入管理密钥(NESIO_ADMIN_SECRET)查看后台运行情况,只存本机。', 'Enter the admin secret (NESIO_ADMIN_SECRET) to view backend status — stored only on this device.')}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void load(secret); }}
                placeholder={L(dict, '管理密钥', 'Admin secret')}
                style={{ flex: 1, padding: '0.55rem 0.7rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-ink)', fontSize: 'var(--text-sm)' }} />
              <button type="button" onClick={() => void load(secret)} disabled={loading || !secret.trim()}
                style={{ padding: '0.55rem 1rem', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--portal-accent)', color: 'var(--portal-on-accent, #fff)', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                {loading ? L(dict, '验证中…', '…') : L(dict, '进入', 'Enter')}
              </button>
            </div>
          </div>
        ) : data.error === 'admin_not_configured' ? (
          <p className="nesio-insights-empty" style={{ marginTop: 0 }}>{L(dict, `面板未激活:${data.hint || ''}`, `Not configured: ${data.hint || ''}`)}</p>
        ) : (
          <div style={{ ...card, borderColor: 'transparent', background: 'var(--status-gentle-soft)' }}>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--status-gentle)' }}>{L(dict, `加载失败(${data.error}),稍后重试。`, `Load failed (${data.error}) — try again.`)}</p>
            <button type="button" onClick={() => void load(secret)} style={{ marginTop: 'var(--space-2)', padding: '0.4rem 0.8rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-ink)', fontSize: 'var(--text-xs)', cursor: 'pointer' }}>{L(dict, '重试', 'Retry')}</button>
          </div>
        )}
      </div>
    );
  }

  if (!data) {
    return <div className="nesio-analytics-tab"><p className="nesio-insights-empty" style={{ marginTop: 0 }}>{L(dict, '加载中…', 'Loading…')}</p></div>;
  }

  const srcBad = (data.sources && (!data.sources.telemetryEvents.ok || !data.sources.productEvents.ok));

  return (
    <div className="nesio-analytics-tab">
      {/* 顶部:刷新 + 完整面板 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span style={label}>{data.generatedAt ? L(dict, `更新 ${new Date(data.generatedAt).toLocaleTimeString('zh-CN')}`, `Updated ${new Date(data.generatedAt).toLocaleTimeString('en-US')}`) : ''}</span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" onClick={() => void load(secret)} disabled={loading}
            style={{ padding: '0.3rem 0.7rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-ink)', fontSize: 'var(--text-xs)', cursor: 'pointer' }}>{loading ? '…' : L(dict, '刷新', 'Refresh')}</button>
          <a href="/admin" style={{ padding: '0.3rem 0.7rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-xs)', textDecoration: 'none' }}>{L(dict, '完整面板 ↗', 'Full panel ↗')}</a>
        </div>
      </div>

      {srcBad && (
        <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--status-gentle)', background: 'var(--status-gentle-soft)', padding: '0.4rem 0.6rem', borderRadius: 'var(--radius-sm)' }}>
          {L(dict, '数据源部分不可用 —— 完整面板里看详情。', 'Some data sources unavailable — see full panel.')}
        </p>
      )}

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        <div style={card}><span style={big}>{data.windows?.today.events ?? 0}</span><span style={{ ...label, display: 'block', marginTop: '0.2rem' }}>{L(dict, `今日事件 · ${data.windows?.today.devices ?? 0} 台`, `Events today · ${data.windows?.today.devices ?? 0} devices`)}</span></div>
        <div style={card}><span style={big}>{data.windows?.week.events ?? 0}</span><span style={{ ...label, display: 'block', marginTop: '0.2rem' }}>{L(dict, '7 天事件', 'Events / 7d')}</span></div>
        <button type="button" onClick={() => setShowDevices((v) => !v)} style={{ ...card, textAlign: 'left', cursor: 'pointer' }}>
          <span style={big}>{data.windows?.month.devices ?? 0}</span>
          <span style={{ ...label, display: 'block', marginTop: '0.2rem' }}>{L(dict, '30 天设备 · 点看明细', 'Devices / 30d · tap')}</span>
        </button>
        <button type="button" onClick={() => setShowDims((v) => !v)} style={{ ...card, textAlign: 'left', cursor: 'pointer' }}>
          <span style={{ ...big, color: (data.smartness?.score ?? 0) >= 70 ? 'var(--status-go)' : (data.smartness?.score ?? 0) >= 50 ? 'var(--status-gentle)' : 'var(--status-risk)' }}>{data.smartness?.score ?? '—'}</span>
          <span style={{ ...label, display: 'block', marginTop: '0.2rem' }}>{L(dict, '聪明度 · 点看五维', 'Smartness · tap')}</span>
        </button>
      </div>

      {data.sampleCapped && (
        <p style={{ margin: 'var(--space-2) 0 0', fontSize: '0.62rem', color: 'var(--portal-muted)' }}>
          {L(dict, '事件数为精确值;下方分项(Top/画像/AI)基于最近采样,近似。', 'Event counts are exact; breakdowns below use a recent sample (approximate).')}
        </p>
      )}

      {/* 聪明度五维(点开) */}
      {showDims && (data.smartness?.dims?.length ?? 0) > 0 && (
        <div style={{ ...card, marginTop: 'var(--space-2)' }}>
          <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6 }}>
            {L(dict, '聪明度 = 五维平均(0–100)。样本不足的维度按 50 中性、标·。', 'Smartness = avg of 5 dims (0–100). Thin-sample dims default to 50 (·).')}
          </p>
          {data.smartness!.dims!.map((d) => (
            <div key={d.dim} style={{ margin: '0 0 var(--space-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--portal-ink)', marginBottom: '0.2rem' }}>
                <span>{d.dim}{d.thin ? ' ·' : ''}</span>
                <span style={{ color: 'var(--portal-muted)', fontVariantNumeric: 'tabular-nums' }}>{d.score}</span>
              </div>
              <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent-soft)' }}>
                <div style={{ height: '100%', borderRadius: 'var(--radius-pill)', width: `${d.score}%`, background: d.score >= 70 ? 'var(--status-go)' : d.score >= 50 ? 'var(--status-gentle)' : 'var(--status-risk)' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 设备明细(点 30 天设备卡展开) */}
      {showDevices && (
        <div style={{ ...card, marginTop: 'var(--space-2)' }}>
          {(data.deviceList?.length ?? 0) === 0 ? (
            <p style={label}>{L(dict, '暂无设备记录。', 'No devices yet.')}</p>
          ) : data.deviceList!.map((d) => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', padding: '0.25rem 0', borderTop: '1px solid var(--portal-line)', fontSize: 'var(--text-xs)', color: 'var(--portal-ink)' }}>
              <span style={{ fontFamily: 'monospace' }}>{d.id}…</span>
              <span style={{ color: 'var(--portal-muted)' }}>{L(dict, `${d.events} 事件 · ${d.lastAt.slice(5, 10)} 最近`, `${d.events} events · last ${d.lastAt.slice(5, 10)}`)}</span>
            </div>
          ))}
        </div>
      )}

      {/* 行为画像 */}
      {data.behavior && (data.behavior.topFeatures.length > 0) && (() => {
        const b = data.behavior!;
        const maxFeat = Math.max(1, ...b.topFeatures.map((f) => f.count));
        const maxHour = Math.max(1, ...b.activeHours);
        const peakHour = b.activeHours.indexOf(maxHour);
        return (
          <>
            <p style={sectionLbl}>{L(dict, '行为画像(30 天,你自己)', 'Behavior profile / 30d')}</p>
            <div style={card}>
              <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--portal-ink)', lineHeight: 1.6 }}>
                {L(dict, `活跃 ${b.activeDays30} 天 · 最常用「${featLabel(b.topFeatures[0].name, false)}」· 高峰 ${peakHour}:00(UTC)附近`, `${b.activeDays30} active days · top “${featLabel(b.topFeatures[0].name, true)}” · peak ~${peakHour}:00 UTC`)}
              </p>
              {/* Top 功能 */}
              <p style={{ ...label, margin: 'var(--space-3) 0 var(--space-2)' }}>{L(dict, '最常用', 'Most used')}</p>
              {b.topFeatures.slice(0, 6).map((f) => (
                <div key={f.name} style={{ margin: '0 0 var(--space-2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--portal-ink)', marginBottom: '0.2rem' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{featLabel(f.name, en)}</span>
                    <span style={{ color: 'var(--portal-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{f.count}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent-soft)' }}>
                    <div style={{ height: '100%', borderRadius: 'var(--radius-pill)', width: `${Math.round((f.count / maxFeat) * 100)}%`, background: 'var(--portal-accent)' }} />
                  </div>
                </div>
              ))}
              {/* 活跃时段 24h 小柱 */}
              <p style={{ ...label, margin: 'var(--space-3) 0 var(--space-2)' }}>{L(dict, '活跃时段(0–23 时 · UTC)', 'Active hours (0–23 · UTC)')}</p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 40 }}>
                {b.activeHours.map((h, i) => (
                  <div key={i} title={`${i}:00 · ${h}`} style={{ flex: 1, height: `${Math.max(3, Math.round((h / maxHour) * 100))}%`, background: h > 0 ? 'var(--portal-accent)' : 'var(--portal-line)', borderRadius: '1px 1px 0 0' }} />
                ))}
              </div>
            </div>
          </>
        );
      })()}

      {/* 规则洞察 */}
      {(data.insights?.length ?? 0) > 0 && (
        <>
          <p style={sectionLbl}>{L(dict, '洞察与建议', 'Insights')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {data.insights!.slice(0, 4).map((ins) => (
              <div key={ins.title} style={{ ...card, borderLeft: `3px solid ${SEV_COLOR[ins.severity] || 'var(--portal-line)'}` }}>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>{ins.title}</p>
                <p style={{ margin: '0.2rem 0 0', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6 }}>{ins.detail}{ins.advice ? ` · ${ins.advice}` : ''}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* AI 成本 */}
      <p style={sectionLbl}>
        {L(dict, 'AI 调用与成本(30 天)', 'AI calls & cost / 30d')}
        {data.ai && <span style={{ marginLeft: 6, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-regular)', color: 'var(--portal-muted)' }}>{L(dict, `共 ${data.ai.totals.calls} 次 · ≈$${data.ai.totals.estCostUsd}`, `${data.ai.totals.calls} calls · ≈$${data.ai.totals.estCostUsd}`)}</span>}
      </p>
      {(data.ai?.routes.length ?? 0) === 0 ? (
        <p style={label}>{L(dict, '暂无 AI 调用记录。', 'No AI calls yet.')}</p>
      ) : (
        <div style={{ ...card, padding: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.7fr 0.7fr', fontSize: '0.62rem', color: 'var(--portal-muted)', paddingBottom: '0.3rem' }}>
            <span>{L(dict, '路由', 'Route')}</span><span>{L(dict, '次数', 'Calls')}</span><span>{L(dict, '成功', 'OK')}</span><span>{L(dict, '估算', 'Cost')}</span>
          </div>
          {data.ai!.routes.slice(0, 8).map((r) => (
            <div key={r.route} style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.7fr 0.7fr', fontSize: 'var(--text-xs)', color: 'var(--portal-ink)', padding: '0.25rem 0', borderTop: '1px solid var(--portal-line)', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.route}</span>
              <span>{r.calls}</span>
              <span style={{ color: r.okRate >= 95 ? 'var(--status-go)' : r.okRate >= 85 ? 'var(--status-gentle)' : 'var(--status-risk)' }}>{r.okRate}%</span>
              <span>${r.estCostUsd}</span>
            </div>
          ))}
        </div>
      )}

      {/* 客户端错误 */}
      <p style={sectionLbl}>{L(dict, '客户端错误(30 天)', 'Client errors / 30d')}</p>
      {(data.clientErrors?.length ?? 0) === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--status-go)' }}>✓ {L(dict, '没有错误上报,一切干净。', 'No errors reported — all clean.')}</p>
      ) : (
        <div style={{ ...card, borderColor: 'transparent', background: 'var(--status-risk-soft)' }}>
          {data.clientErrors!.slice(0, 5).map((e) => (
            <div key={`${e.kind}:${e.message}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', padding: '0.25rem 0', fontSize: 'var(--text-xs)' }}>
              <span style={{ color: 'var(--portal-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}><span style={{ color: 'var(--status-risk)', marginRight: 4 }}>{e.kind}</span>{e.message}</span>
              <span style={{ color: 'var(--portal-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>×{e.count} · {e.devices}{L(dict, ' 台', '')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
