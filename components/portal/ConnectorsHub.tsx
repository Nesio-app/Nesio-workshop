'use client';

import { useEffect, useRef, useState } from 'react';
import { IconActivity, IconBook, IconBookOpen, IconCalendar, IconCar, IconCheckSquare, IconCloudSun, IconHeartPulse, IconMail, IconNote, IconTimer } from './icons';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { type LifeNode } from '@/lib/portal/life-graph';

interface ConnectorsHubProps { open: boolean; onClose: () => void; }

type ConnMethod = 'oauth' | 'geo' | 'file' | 'server' | 'token' | 'shortcuts';
type NodeInput = Omit<LifeNode, 'id' | 'createdAt'>;

interface ConnectorDef {
  id: string;
  name: string;
  icon: React.ReactNode;
  iconBg: string;
  description: string;
  method: ConnMethod;
  /** token connectors: the API endpoint to POST { token } to */
  syncEndpoint?: string;
  /** token connectors: where to get the token */
  tokenHint?: string;
  /** shortcuts connectors: the source id for /api/portal/ingest */
  ingestSource?: string;
  comingSoon?: boolean;
  dev?: boolean;
}

// dev: true = 还在打磨的接入,收进「开发中」折叠组,不占主列表
const CONNECTORS: ConnectorDef[] = [
  { id: 'calendar', name: 'Google Calendar', icon: <IconCalendar />, iconBg: 'var(--chip-blue)', method: 'oauth', description: '读取日程，生成会议提醒和准备 Brief' },
  { id: 'gmail', name: 'Gmail', icon: <IconMail />, iconBg: 'var(--chip-pink)', method: 'oauth', description: '你授权并选择后，整理可确认的人物、日期、承诺' },
  { id: 'weather', name: '地理位置 · 天气', icon: <IconCloudSun />, iconBg: 'var(--chip-amber)', method: 'geo', description: '基于实时天气生成外出和健康建议' },
  { id: 'flomo', name: 'Flomo', icon: <IconNote />, iconBg: 'var(--chip-indigo)', method: 'server', syncEndpoint: '/api/portal/flomo?limit=30', description: '同步 flomo 笔记，提取想法与记录' },
  { id: 'notion', name: 'Notion', icon: <IconBook />, iconBg: 'var(--chip-gray)', method: 'token', syncEndpoint: '/api/portal/notion', tokenHint: 'notion.so/my-integrations → 新建集成 → 复制 Internal Integration Secret，并把页面共享给它', description: '同步最近编辑的页面，提取项目与想法', dev: true },
  { id: 'toggl', name: 'Toggl Track', icon: <IconTimer />, iconBg: 'var(--chip-red)', method: 'token', syncEndpoint: '/api/portal/toggl', tokenHint: 'track.toggl.com → Profile → API Token', description: '同步时间记录，了解你的专注分布', dev: true },
  { id: 'health', name: 'Apple Health 导出', icon: <IconHeartPulse />, iconBg: 'var(--chip-pink)', method: 'file', description: '上传 export.xml，提取步数、睡眠、心率', dev: true },
  { id: 'reminder', name: 'Apple 提醒事项', icon: <IconCheckSquare />, iconBg: 'var(--chip-amber)', method: 'shortcuts', ingestSource: 'reminder', description: '通过快捷指令推送提醒，自动转为承诺', dev: true },
  { id: 'keep', name: 'Keep 健康', icon: <IconActivity />, iconBg: 'var(--chip-green)', method: 'shortcuts', ingestSource: 'keep', description: '通过快捷指令推送运动数据', dev: true },
  { id: 'wechat_reading', name: '微信读书', icon: <IconBookOpen />, iconBg: 'var(--chip-leaf)', method: 'shortcuts', ingestSource: 'wechat_reading', description: '通过快捷指令推送阅读进度与笔记', dev: true },
  { id: 'tesla', name: 'Tesla', icon: <IconCar />, iconBg: 'var(--chip-green)', method: 'oauth', description: '电量、行程信号，自动提醒充电', comingSoon: true, dev: true },
];

const CONNECTORS_KEY = 'nesio-connectors-v1';
const TOKENS_KEY = 'nesio-connector-tokens-v1';

function loadConnectors(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(CONNECTORS_KEY) || '{}'); } catch { return {}; }
}
function saveConnectorState(id: string, connected: boolean) {
  const saved = loadConnectors();
  if (connected) saved[id] = true; else delete saved[id];
  try { localStorage.setItem(CONNECTORS_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
}
function loadToken(id: string): string {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}')[id] || ''; } catch { return ''; }
}
function saveToken(id: string, token: string) {
  try {
    const all = JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}');
    if (token) all[id] = token; else delete all[id];
    localStorage.setItem(TOKENS_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

interface SyncResult { ok: boolean; msg: string; detail?: string; needsReauth?: boolean }

export default function ConnectorsHub({ open, onClose }: ConnectorsHubProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [tokenInputFor, setTokenInputFor] = useState<string | null>(null);
  const [tokenValue, setTokenValue] = useState('');
  const [shortcutsFor, setShortcutsFor] = useState<string | null>(null);
  const [ingestUrl, setIngestUrl] = useState('');
  const [oauthSyncResult, setOauthSyncResult] = useState<Record<string, SyncResult>>({});

  useEffect(() => {
    if (!open) return;
    setConnected(loadConnectors());
    setIngestUrl(`${window.location.origin}/api/portal/ingest`);
    // Check OAuth callback
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) showToast(`连接失败：${err}`, false);
  }, [open]);


  // 开发中的接入:只展示,不给操作按钮(不做假交互)
  function renderDevRow(c: ConnectorDef) {
    return (
      <div key={c.id} className="nesio-connector-row" style={{ opacity: 0.75 }}>
        <span className="nesio-connector-icon" style={{ background: c.iconBg }}>{c.icon}</span>
        <div className="nesio-connector-body">
          <p className="nesio-connector-name">
            {c.name}
            <span className="nesio-connector-soon">{c.comingSoon ? '即将上线' : '开发中'}</span>
          </p>
          <p className="nesio-connector-desc">{c.description}</p>
        </div>
      </div>
    );
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  function saveNodes(nodes: Array<Omit<NodeInput, 'source'>>, source: LifeNode['source']) {
    nodes.forEach((n) => ingestLifeNode({ ...n, source } as NodeInput));
    window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
  }

  // ── Token-based sync (Notion, Toggl) ──
  async function syncToken(c: ConnectorDef) {
    const token = loadToken(c.id);
    if (!token) { setTokenInputFor(c.id); setTokenValue(''); return; }
    setSyncing(c.id);
    try {
      const res = await fetch(c.syncEndpoint!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json() as { ok?: boolean; nodes?: NodeInput[]; error?: string };
      if (!data.ok) {
        if (data.error === 'invalid_token') { saveToken(c.id, ''); setTokenInputFor(c.id); setTokenValue(''); showToast('Token 无效，请重新输入', false); }
        else showToast(`同步失败：${data.error || '未知'}`, false);
        setSyncing(null);
        return;
      }
      const n = data.nodes || [];
      saveNodes(n, c.id === 'toggl' ? 'system' : 'manual');
      saveConnectorState(c.id, true);
      setConnected((p) => ({ ...p, [c.id]: true }));
      setCounts((p) => ({ ...p, [c.id]: n.length }));
      showToast(`已提取 ${n.length} 个节点`, true);
    } catch { showToast('网络错误', false); }
    setSyncing(null);
  }

  function submitToken(c: ConnectorDef) {
    if (!tokenValue.trim()) return;
    saveToken(c.id, tokenValue.trim());
    setTokenInputFor(null);
    syncToken(c);
  }

  // ── Server-configured sync (Flomo) ──
  async function syncFlomo(c: ConnectorDef) {
    setSyncing(c.id);
    try {
      const res = await fetch(c.syncEndpoint!);
      const data = await res.json() as { ok?: boolean; memos?: Array<{ content: string; created_at: string; tags: string[] }>; error?: string };
      if (!data.ok) { showToast(`Flomo 未配置或同步失败`, false); setSyncing(null); return; }
      const memos = data.memos || [];
      const nodes: Array<Omit<NodeInput, 'source'>> = memos.slice(0, 20).map((m) => ({
        type: 'preference' as const,
        name: m.content.replace(/<[^>]+>/g, '').slice(0, 40),
        attributes: { source: 'Flomo', created: m.created_at },
        relations: [],
        tags: ['Flomo', ...(m.tags || [])],
        confidence: 0.9,
        rawInput: m.content.replace(/<[^>]+>/g, '').slice(0, 200),
      }));
      saveNodes(nodes, 'manual');
      saveConnectorState(c.id, true);
      setConnected((p) => ({ ...p, [c.id]: true }));
      setCounts((p) => ({ ...p, [c.id]: nodes.length }));
      showToast(`已同步 ${nodes.length} 条 flomo 笔记`, true);
    } catch { showToast('网络错误', false); }
    setSyncing(null);
  }

  // ── OAuth sync (Gmail / Calendar) ──
  async function syncOAuth(c: ConnectorDef) {
    setSyncing(c.id);
    setOauthSyncResult((p) => ({ ...p, [c.id]: { ok: true, msg: '同步中…' } }));
    try {
      if (c.id === 'gmail') {
        const res = await fetch('/api/portal/gmail?includeBody=true&analyze=true');
        const data = await res.json() as {
          ok?: boolean; nodes?: NodeInput[]; error?: string;
          emailCount?: number; count?: number; messages?: unknown[];
        };
        if (!data.ok) {
          const isNotConnected = data.error === 'not_connected' || data.error === 'token_expired';
          const detail = isNotConnected
            ? 'OAuth token 已失效，请重新授权'
            : `error: ${data.error || '未知'} | HTTP ${res.status}`;
          setOauthSyncResult((p) => ({ ...p, gmail: { ok: false, msg: isNotConnected ? '需要重新授权' : '同步失败', detail, needsReauth: isNotConnected } as SyncResult }));
          showToast(isNotConnected ? 'Gmail token 已失效，点击重新授权' : `Gmail 同步失败：${data.error || '未知'}`, false);
        } else {
          const nodeCount = data.nodes?.length ?? 0;
          const emailCount = data.emailCount ?? data.messages?.length ?? 0;
          if (nodeCount > 0) {
            const { addLifeNode } = await import('@/lib/portal/life-graph');
            data.nodes!.forEach((n) => ingestLifeNode({ ...n, source: 'email' } as Parameters<typeof addLifeNode>[0]));
            localStorage.setItem('nesio-gmail-last-sync', String(Date.now()));
            window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
          }
          setCounts((p) => ({ ...p, gmail: nodeCount }));
          const detail = `读取 ${emailCount} 封邮件 · 提取 ${nodeCount} 个节点`;
          setOauthSyncResult((p) => ({ ...p, gmail: { ok: true, msg: '同步成功', detail } }));
          showToast(detail, true);
        }
      } else if (c.id === 'calendar') {
        const res = await fetch('/api/portal/calendar', { cache: 'no-store' });
        const data = await res.json() as {
          ok?: boolean; events?: Array<Record<string, unknown>>; feeds?: Array<{ label: string; ok: boolean; count: number; error?: string }>;
          error?: string; message?: string; provider?: string;
        };
        const feedSummary = data.feeds?.map((f) => f.label + ': ' + (f.ok ? f.count + '条' : '失败(' + (f.error || '?') + ')')).join(' · ') || '';
        if (!data.ok || !data.events?.length) {
          const detail = [
            `HTTP ${res.status}`,
            data.message || data.error || '',
            feedSummary,
          ].filter(Boolean).join(' | ');
          setOauthSyncResult((p) => ({ ...p, calendar: { ok: false, msg: `无日历数据`, detail } }));
          showToast(`日历这次没同步上，稍后再试。（${data.message || data.error || '无事件'}）`, false);
        } else {
          const count = data.events.length;
          const { saveCalendarToLocal } = await import('@/lib/portal/calendar-local-store');
          const calEvents = data.events as Parameters<typeof saveCalendarToLocal>[0];
          saveCalendarToLocal(calEvents);

          // Also save upcoming events to LifeGraph so Memory tab reflects the sync
          const { getLifeGraph } = await import('@/lib/portal/life-graph');
          const now = Date.now();
          const windowEnd = now + 60 * 86_400_000;
          const existingCalIds = new Set(
            getLifeGraph().filter((n) => n.source === 'calendar')
              .map((n) => n.attributes.calendarId as string).filter(Boolean),
          );
          let lifeGraphAdded = 0;
          calEvents.forEach((ev) => {
            const evAny = ev as Record<string, unknown>;
            const start = evAny.start as string | undefined;
            const title = evAny.title as string | undefined;
            if (!start || !title) return;
            const t = new Date(start).getTime();
            if (t < now - 86_400_000 || t > windowEnd) return;
            const calId = (evAny.id as string) || `${title}-${start}`;
            if (existingCalIds.has(calId)) return;
            ingestLifeNode({
              name: title,
              type: 'event',
              source: 'calendar',
              confidence: 1,
              rawInput: title,
              tags: [(evAny.calendarName as string) || '日历'].filter(Boolean),
              attributes: {
                start,
                ...(evAny.end ? { end: evAny.end as string } : {}),
                ...(evAny.url ? { url: evAny.url as string } : {}),
                ...(evAny.location ? { location: evAny.location as string } : {}),
                ...(evAny.description ? { note: (evAny.description as string).slice(0, 300) } : {}),
                calendarId: calId,
                calendarName: (evAny.calendarName as string) || '',
              },
              relations: [],
            });
            lifeGraphAdded++;
          });

          setCounts((p) => ({ ...p, calendar: count }));
          const detail = `${feedSummary || `来源: ${data.provider || '?'}`} · ${count} 条事件${lifeGraphAdded > 0 ? ` · ${lifeGraphAdded} 条加入记忆` : ''}`;
          setOauthSyncResult((p) => ({ ...p, calendar: { ok: true, msg: '同步成功', detail } }));
          showToast(`日历同步成功：${count} 条事件`, true);
          window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
          window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络错误';
      setOauthSyncResult((p) => ({ ...p, [c.id]: { ok: false, msg: '同步失败', detail: msg } }));
      showToast(`这次没同步上（${msg}）。稍后再试一次就好。`, false);
    }
    setSyncing(null);
  }

  // ── OAuth / Geo / File ──
  function handleConnect(c: ConnectorDef) {
    if (c.comingSoon) return;
    if (c.id === 'gmail') { window.location.href = '/api/portal/gmail/connect'; return; }
    if (c.id === 'calendar') { window.location.href = '/api/portal/calendar/connect'; return; }
    if (c.method === 'geo') {
      setSyncing(c.id);
      navigator.geolocation.getCurrentPosition(
        () => { saveConnectorState('weather', true); setConnected((p) => ({ ...p, weather: true })); setSyncing(null); window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed')); showToast('位置已授权', true); },
        () => { setSyncing(null); showToast('位置权限被拒绝', false); },
        { timeout: 8000 },
      );
      return;
    }
    if (c.id === 'health') { fileRef.current?.click(); return; }
    if (c.method === 'token') { syncToken(c); return; }
    if (c.method === 'server') { syncFlomo(c); return; }
    if (c.method === 'shortcuts') { setShortcutsFor(c.id); return; }
  }

  async function handleHealthFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.name.endsWith('.zip')) { showToast('请先解压 zip，上传里面的 export.xml', false); return; }
    setSyncing('health');
    try {
      const text = await file.text();
      const res = await fetch('/api/portal/health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xml: text }) });
      const data = await res.json() as { ok?: boolean; nodes?: NodeInput[]; count?: number };
      if (data.ok && data.nodes?.length) {
        saveNodes(data.nodes, 'system');
        saveConnectorState('health', true);
        setConnected((p) => ({ ...p, health: true }));
        setCounts((p) => ({ ...p, health: data.count || 0 }));
        showToast(`已提取 ${data.count} 个健康节点`, true);
      } else showToast('未识别到健康数据', false);
    } catch { showToast('解析失败', false); }
    setSyncing(null);
  }

  function disconnect(id: string) {
    saveConnectorState(id, false);
    saveToken(id, '');
    setConnected((p) => ({ ...p, [id]: false }));

    // Google connectors share one OAuth consent — really revoke it at
    // Google and clear the HTTP-only token cookies (both providers).
    if (id === 'gmail' || id === 'calendar') {
      const other = id === 'gmail' ? 'calendar' : 'gmail';
      saveConnectorState(other, false);
      setConnected((p) => ({ ...p, [other]: false }));
      void fetch('/api/portal/oauth/disconnect', { method: 'POST' })
        .then((r) => r.json() as Promise<{ ok?: boolean; revoked?: boolean }>)
        .then((d) => {
          showToast(d.revoked
            ? '已断开并撤销 Google 授权（邮件与日历共用授权，已一并断开）'
            : '已断开并清除本地 token（邮件与日历一并断开）', true);
        })
        .catch(() => showToast('已断开本地连接，撤销请求失败——可在 Google 账号安全页手动移除', false));
    }
  }

  function copyIngestUrl() {
    navigator.clipboard?.writeText(ingestUrl).then(() => showToast('接入地址已复制', true)).catch(() => {});
  }

  if (!open) return null;

  const def = (id: string) => CONNECTORS.find((c) => c.id === id)!;

  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label="数据接入">
      <input ref={fileRef} type="file" accept=".xml,.zip" style={{ display: 'none' }} onChange={handleHealthFile} />
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">数据接入</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>
        <p className="nesio-settings-sheet-desc">连接外部信号源，让 Today Feed 出现真实数据驱动的建议。</p>

        {toast && (
          <div style={{ background: toast.ok ? 'var(--status-go-soft)' : 'var(--status-risk-soft)', border: `1px solid ${toast.ok ? 'var(--status-go)' : 'var(--status-risk)'}`, borderRadius: '0.75rem', padding: '0.65rem 0.85rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: toast.ok ? 'var(--status-go)' : 'var(--status-risk)' }}>
            {toast.ok ? '✓ ' : ''}{toast.msg}
          </div>
        )}

        <div className="nesio-settings-sheet-body">
          {CONNECTORS.filter((c) => !c.dev).map((c) => {
            const isConn = connected[c.id];
            const isSync = syncing === c.id;
            const cnt = counts[c.id];
            return (
              <div key={c.id}>
                <div className="nesio-connector-row">
                  <span className="nesio-connector-icon" style={{ background: c.iconBg }}>{c.icon}</span>
                  <div className="nesio-connector-body">
                    <p className="nesio-connector-name">
                      {c.name}
                      {c.comingSoon && <span className="nesio-connector-soon">即将上线</span>}
                      {c.method === 'shortcuts' && !c.comingSoon && <span className="nesio-connector-soon" style={{ background: 'rgba(88,140,227,0.12)', color: 'var(--portal-blue-deep)' }}>快捷指令</span>}
                    </p>
                    <p className="nesio-connector-desc">{c.description}</p>
                    {isConn && !oauthSyncResult[c.id] && <p className="nesio-connector-sync">{isSync ? '同步中…' : '已连接'}{cnt ? `  ·  ${cnt} 个节点` : ''}</p>}
                    {oauthSyncResult[c.id] && (
                      <p className="nesio-connector-sync" style={{ color: oauthSyncResult[c.id].ok ? 'var(--status-go)' : 'var(--status-risk)', fontSize: '0.68rem', lineHeight: 1.4 }}>
                        {oauthSyncResult[c.id].msg}
                        {oauthSyncResult[c.id].detail && <><br /><span style={{ opacity: 0.8 }}>{oauthSyncResult[c.id].detail}</span></>}
                        {oauthSyncResult[c.id].needsReauth && (
                          <><br /><button type="button" style={{ marginTop: '0.25rem', fontSize: '0.68rem', color: 'var(--portal-blue-deep)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }} onClick={() => handleConnect(c)}>点击重新授权 →</button></>
                        )}
                      </p>
                    )}
                  </div>

                  {c.comingSoon ? (
                    <span style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', flexShrink: 0 }}>敬请期待</span>
                  ) : c.method === 'shortcuts' ? (
                    <button type="button" className="nesio-connector-connect" onClick={() => setShortcutsFor(shortcutsFor === c.id ? null : c.id)} style={{ flexShrink: 0 }}>
                      {shortcutsFor === c.id ? '收起' : '设置'}
                    </button>
                  ) : isConn && (c.method === 'token' || c.method === 'server') ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flexShrink: 0 }}>
                      <button type="button" className="nesio-connector-connect" onClick={() => c.method === 'server' ? syncFlomo(c) : syncToken(c)} disabled={isSync}>{isSync ? '…' : '同步'}</button>
                      <button type="button" className="nesio-connector-disconnect" onClick={() => disconnect(c.id)}>断开</button>
                    </div>
                  ) : isConn && c.method === 'oauth' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flexShrink: 0 }}>
                      <button type="button" className="nesio-connector-connect" onClick={() => syncOAuth(c)} disabled={isSync}>{isSync ? '…' : '同步'}</button>
                      <button type="button" className="nesio-connector-disconnect" onClick={() => disconnect(c.id)}>断开</button>
                    </div>
                  ) : isConn ? (
                    <button type="button" className="nesio-connector-disconnect" onClick={() => disconnect(c.id)} style={{ flexShrink: 0 }}>断开</button>
                  ) : (
                    <button type="button" className="nesio-connector-connect" onClick={() => handleConnect(c)} disabled={isSync} style={{ flexShrink: 0 }}>
                      {isSync ? '…' : c.method === 'file' ? '上传' : c.method === 'token' || c.method === 'server' ? '接入' : '接入'}
                    </button>
                  )}
                </div>

                {/* Token input */}
                {tokenInputFor === c.id && (
                  <div className="nesio-connector-token-box">
                    <p style={{ fontSize: '0.72rem', color: 'var(--portal-muted)', marginBottom: '0.5rem', lineHeight: 1.5 }}>{c.tokenHint}</p>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input className="nesio-ob-input" style={{ marginBottom: 0, flex: 1, fontSize: '0.8rem' }} type="password" placeholder="粘贴 Token…" value={tokenValue} onChange={(e) => setTokenValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitToken(c); }} autoFocus />
                      <button type="button" className="nesio-connector-connect" onClick={() => submitToken(c)} disabled={!tokenValue.trim()}>连接</button>
                    </div>
                  </div>
                )}

                {/* Shortcuts setup */}
                {shortcutsFor === c.id && (
                  <div className="nesio-connector-token-box">
                    <p style={{ fontSize: '0.75rem', color: 'var(--portal-ink)', fontWeight: 600, marginBottom: '0.4rem' }}>通过 iOS 快捷指令接入</p>
                    <ol style={{ fontSize: '0.72rem', color: 'var(--portal-muted)', lineHeight: 1.7, paddingLeft: '1.1rem', marginBottom: '0.6rem' }}>
                      <li>打开「快捷指令」App，新建快捷指令</li>
                      <li>添加动作「获取 URL 内容」</li>
                      <li>URL 填下方地址，方法选 <strong>POST</strong></li>
                      <li>请求体 JSON：<code style={{ fontSize: '0.68rem' }}>{`{"source":"${c.ingestSource}","content":"数据内容"}`}</code></li>
                      <li>可设为自动化，定时推送</li>
                    </ol>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <code style={{ flex: 1, fontSize: '0.68rem', background: 'rgba(88,140,227,0.08)', padding: '0.4rem 0.6rem', borderRadius: '0.5rem', wordBreak: 'break-all', color: 'var(--portal-ink)' }}>{ingestUrl}</code>
                      <button type="button" className="nesio-connector-connect" onClick={copyIngestUrl} style={{ flexShrink: 0 }}>复制</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* ── 开发中 · 折叠二级(以后慢慢开发的接入不占主列表) ── */}
          <details className="nesio-conn-dev-group" style={{ marginTop: '0.9rem', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', padding: '0.15rem 0.75rem' }}>
            <summary style={{ cursor: 'pointer', padding: '0.6rem 0', fontSize: '0.82rem', color: 'var(--portal-muted)', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <span style={{ color: 'var(--portal-ink)', fontWeight: 600 }}>开发中 · 抢先看</span>
                <span style={{ marginLeft: 8, fontSize: '0.7rem' }}>{CONNECTORS.filter((c) => c.dev).length} 项在打磨</span>
              </span>
              <span aria-hidden>▾</span>
            </summary>
            {CONNECTORS.filter((c) => c.dev).map((c) => renderDevRow(c))}
          </details>

          <div style={{ marginTop: '1rem', fontSize: '0.72rem', color: 'var(--portal-muted)', textAlign: 'center', lineHeight: 1.6 }}>
            有 API 的（Gmail / Calendar / Notion / Toggl / Flomo）直接连接；<br />
            没有公开 API 的（提醒事项 / Keep / 微信读书）通过快捷指令推送。<br />
            所有数据仅在你的设备上处理和存储。
          </div>
        </div>
      </div>
    </div>
  );
}
